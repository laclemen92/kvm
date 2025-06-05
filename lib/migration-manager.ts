/**
 * Migration manager for executing and tracking schema migrations
 */

import { MigrationStorage } from "./migration-storage.ts";
import { KVMMigrationUtils } from "./migration-utils.ts";
import type {
  Migration,
  MigrationOptions,
  MigrationResult,
  MigrationExecutionResult,
  MigrationStatus,
  AppliedMigration,
  MigrationStorageConfig,
} from "./migration-types.ts";
import {
  MigrationError,
  MigrationStateError,
} from "./migration-types.ts";

/**
 * Manages the execution and tracking of database migrations
 */
export class MigrationManager {
  private storage: MigrationStorage;
  private utils: KVMMigrationUtils;

  constructor(
    private kv: Deno.Kv,
    storageConfig?: MigrationStorageConfig,
  ) {
    this.storage = new MigrationStorage(kv, storageConfig);
    this.utils = new KVMMigrationUtils(kv);
  }

  /**
   * Initialize the migration system
   */
  async initialize(): Promise<void> {
    await this.storage.initialize();
  }

  /**
   * Load migrations from a directory or array
   */
  async loadMigrations(
    migrationsPath: string | Migration[],
  ): Promise<Migration[]> {
    if (Array.isArray(migrationsPath)) {
      return this.validateMigrations(migrationsPath);
    }

    // Load from directory
    const migrations: Migration[] = [];
    
    try {
      for await (const dirEntry of Deno.readDir(migrationsPath)) {
        if (dirEntry.isFile && dirEntry.name.endsWith('.ts')) {
          const migrationPath = `${migrationsPath}/${dirEntry.name}`;
          
          try {
            const module = await import(migrationPath);
            const migration = module.default as Migration;
            
            if (!migration || typeof migration !== 'object') {
              console.warn(`Migration file ${dirEntry.name} does not export a default migration object`);
              continue;
            }
            
            migrations.push(migration);
          } catch (error) {
            console.warn(`Failed to load migration ${dirEntry.name}:`, error);
          }
        }
      }
    } catch (error) {
      throw new MigrationError(
        `Failed to read migrations directory: ${migrationsPath}`,
        undefined,
        error as Error,
      );
    }

    return this.validateMigrations(migrations);
  }

  /**
   * Validate migration array for consistency
   */
  private validateMigrations(migrations: Migration[]): Migration[] {
    const sortedMigrations = migrations.sort((a, b) => a.version - b.version);
    const versions = new Set<number>();

    for (const migration of sortedMigrations) {
      // Check for required properties
      if (!migration.version || !migration.description || !migration.up || !migration.down) {
        throw new MigrationError(
          `Invalid migration: missing required properties (version, description, up, down)`,
          migration,
        );
      }

      // Check for duplicate versions
      if (versions.has(migration.version)) {
        throw new MigrationError(
          `Duplicate migration version: ${migration.version}`,
          migration,
        );
      }
      
      versions.add(migration.version);

      // Check version is positive integer
      if (!Number.isInteger(migration.version) || migration.version <= 0) {
        throw new MigrationError(
          `Migration version must be a positive integer: ${migration.version}`,
          migration,
        );
      }
    }

    // Check for gaps in version sequence
    for (let i = 1; i < sortedMigrations.length; i++) {
      const current = sortedMigrations[i];
      const previous = sortedMigrations[i - 1];
      
      if (current.version !== previous.version + 1) {
        throw new MigrationError(
          `Gap in migration sequence: version ${previous.version} followed by ${current.version}`,
          current,
        );
      }
    }

    return sortedMigrations;
  }

  /**
   * Run migrations up to a specific version
   */
  async up(options: MigrationOptions = {}): Promise<MigrationResult> {
    const migrations = await this.loadMigrations(
      options.migrationsPath ?? "./migrations",
    );
    
    const currentVersion = await this.storage.getCurrentVersion();
    const appliedMigrations = await this.storage.getAppliedMigrations();
    const appliedVersions = new Set(appliedMigrations.map(m => m.version));

    // Determine which migrations to run
    const targetVersion = options.toVersion ?? Math.max(...migrations.map(m => m.version), 0);
    const pendingMigrations = migrations.filter(m => 
      m.version <= targetVersion && !appliedVersions.has(m.version)
    );

    const result: MigrationResult = {
      success: true,
      previousVersion: currentVersion,
      currentVersion: currentVersion,
      executedMigrations: [],
      failedMigrations: [],
      totalDuration: 0,
      errors: [],
    };

    const startTime = Date.now();

    try {
      // Execute migrations in order
      for (const migration of pendingMigrations) {
        if (options.onBeforeMigration) {
          await options.onBeforeMigration(migration);
        }

        const executionResult = await this.executeMigration(migration, "up", options.dryRun);
        
        if (executionResult.success) {
          result.executedMigrations.push(executionResult);
          result.currentVersion = migration.version;
          
          if (!options.dryRun) {
            // Record migration as applied
            const appliedMigration: AppliedMigration = {
              version: migration.version,
              description: migration.description,
              appliedAt: new Date(),
              duration: executionResult.duration,
            };
            
            await this.storage.applyMigration(
              currentVersion,
              migration.version,
              appliedMigration,
            );
          }
        } else {
          result.failedMigrations.push(executionResult);
          result.errors.push(executionResult.error!);
          result.success = false;
          
          if (!options.continueOnError) {
            break;
          }
        }

        if (options.onAfterMigration) {
          await options.onAfterMigration(migration, executionResult);
        }
      }
    } catch (error) {
      result.success = false;
      result.errors.push(error as Error);
    }

    result.totalDuration = Date.now() - startTime;
    return result;
  }

  /**
   * Rollback migrations to a specific version
   */
  async down(toVersion?: number, migrations?: Migration[]): Promise<MigrationResult> {
    const currentVersion = await this.storage.getCurrentVersion();
    const appliedMigrations = await this.storage.getAppliedMigrations();
    
    const finalToVersion = toVersion ?? 0;
    
    if (finalToVersion >= currentVersion) {
      throw new MigrationStateError(
        `Cannot rollback to version ${finalToVersion}: current version is ${currentVersion}`,
        currentVersion,
        finalToVersion,
      );
    }

    // Load all migrations to get rollback functions
    let allMigrations: Migration[] = [];
    if (migrations) {
      allMigrations = this.validateMigrations(migrations);
    } else {
      try {
        allMigrations = await this.loadMigrations("./migrations");
      } catch {
        // If we can't load from directory, we need the migrations to be provided
        throw new MigrationError(
          "Cannot rollback: migration definitions not available. " +
          "Provide migrations array or ensure migration files are accessible.",
        );
      }
    }
    const migrationMap = new Map(allMigrations.map(m => [m.version, m]));

    // Get migrations to rollback (in reverse order)
    const migrationsToRollback = appliedMigrations
      .filter(m => m.version > finalToVersion)
      .sort((a, b) => b.version - a.version);

    const result: MigrationResult = {
      success: true,
      previousVersion: currentVersion,
      currentVersion,
      executedMigrations: [],
      failedMigrations: [],
      totalDuration: 0,
      errors: [],
    };

    const startTime = Date.now();

    try {
      for (const appliedMigration of migrationsToRollback) {
        const migration = migrationMap.get(appliedMigration.version);
        
        if (!migration) {
          const error = new MigrationError(
            `Cannot rollback migration ${appliedMigration.version}: migration definition not found`,
          );
          result.errors.push(error);
          result.success = false;
          break;
        }

        const executionResult = await this.executeMigration(migration, "down");
        
        if (executionResult.success) {
          result.executedMigrations.push(executionResult);
          result.currentVersion = appliedMigration.version - 1;
          
          // Remove migration from applied list
          await this.storage.rollbackMigration(
            currentVersion,
            result.currentVersion,
            appliedMigration.version,
          );
        } else {
          result.failedMigrations.push(executionResult);
          result.errors.push(executionResult.error!);
          result.success = false;
          break;
        }
      }
    } catch (error) {
      result.success = false;
      result.errors.push(error as Error);
    }

    result.totalDuration = Date.now() - startTime;
    return result;
  }

  /**
   * Get current migration status
   */
  async getStatus(migrationsPath?: string | Migration[]): Promise<MigrationStatus> {
    const currentVersion = await this.storage.getCurrentVersion();
    const appliedMigrations = await this.storage.getAppliedMigrations();
    const availableMigrations = await this.loadMigrations(migrationsPath ?? "./migrations");
    
    const appliedVersions = new Set(appliedMigrations.map(m => m.version));
    const pendingMigrations = availableMigrations.filter(m => !appliedVersions.has(m.version));
    
    const isUpToDate = pendingMigrations.length === 0 && 
      (availableMigrations.length === 0 || currentVersion === Math.max(...availableMigrations.map(m => m.version)));

    return {
      currentVersion,
      availableMigrations,
      appliedMigrations,
      pendingMigrations,
      isUpToDate,
    };
  }

  /**
   * Execute a single migration
   */
  private async executeMigration(
    migration: Migration,
    direction: "up" | "down",
    dryRun: boolean = false,
  ): Promise<MigrationExecutionResult> {
    const startTime = Date.now();
    const result: MigrationExecutionResult = {
      migration,
      success: false,
      direction,
      duration: 0,
      executedAt: new Date(),
    };

    try {
      if (dryRun) {
        // For dry run, just validate the migration function exists and is callable
        if (typeof migration[direction] !== 'function') {
          throw new Error(`Migration ${direction} function is not callable`);
        }
        result.success = true;
        result.metadata = { dryRun: true };
      } else {
        // Execute the migration
        await migration[direction](this.kv, this.utils);
        result.success = true;
      }
    } catch (error) {
      result.error = new MigrationError(
        `Migration ${migration.version} (${direction}) failed: ${(error as Error).message}`,
        migration,
        error as Error,
      );
    }

    result.duration = Date.now() - startTime;
    return result;
  }

  /**
   * Reset migration state (for testing)
   */
  async reset(): Promise<void> {
    await this.storage.clear();
    await this.storage.initialize();
  }

  /**
   * Validate migration chain integrity
   */
  async validateIntegrity(): Promise<{
    isValid: boolean;
    errors: string[];
  }> {
    return await this.storage.validateIntegrity();
  }

  /**
   * Get migration statistics
   */
  async getStats(): Promise<{
    storage: Awaited<ReturnType<MigrationStorage['getStats']>>;
    utils: Awaited<ReturnType<KVMMigrationUtils['getMigrationStats']>>;
  }> {
    const [storageStats, utilsStats] = await Promise.all([
      this.storage.getStats(),
      this.utils.getMigrationStats(),
    ]);

    return {
      storage: storageStats,
      utils: utilsStats,
    };
  }
}