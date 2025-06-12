/**
 * Migration storage layer for tracking schema versions and applied migrations
 */

import type {
  AppliedMigration,
  MigrationStorageConfig,
} from "./migration-types.ts";
import { MigrationStateError } from "./migration-types.ts";

/**
 * Handles storage and retrieval of migration metadata in Deno KV
 */
export class MigrationStorage {
  private keyPrefix: Deno.KvKeyPart[];
  private versionKey: Deno.KvKey;
  private appliedMigrationsPrefix: Deno.KvKey;

  constructor(
    private kv: Deno.Kv,
    config: MigrationStorageConfig = {},
  ) {
    this.keyPrefix = config.keyPrefix ?? ["__migrations"];
    this.versionKey = config.versionKey ?? [...this.keyPrefix, "version"];
    this.appliedMigrationsPrefix = config.appliedMigrationsPrefix ??
      [...this.keyPrefix, "applied"];
  }

  /**
   * Get the current schema version
   */
  async getCurrentVersion(): Promise<number> {
    const result = await this.kv.get<number>(this.versionKey);
    return result.value ?? 0;
  }

  /**
   * Set the current schema version
   */
  async setCurrentVersion(version: number): Promise<void> {
    await this.kv.set(this.versionKey, version);
  }

  /**
   * Record that a migration has been applied
   */
  async recordAppliedMigration(migration: AppliedMigration): Promise<void> {
    const key = [...this.appliedMigrationsPrefix, migration.version];
    await this.kv.set(key, migration);
  }

  /**
   * Remove a migration from the applied list (for rollbacks)
   */
  async removeAppliedMigration(version: number): Promise<void> {
    const key = [...this.appliedMigrationsPrefix, version];
    await this.kv.delete(key);
  }

  /**
   * Get all applied migrations, sorted by version
   */
  async getAppliedMigrations(): Promise<AppliedMigration[]> {
    const migrations: AppliedMigration[] = [];

    for await (
      const entry of this.kv.list<AppliedMigration>({
        prefix: this.appliedMigrationsPrefix,
      })
    ) {
      if (entry.value) {
        migrations.push(entry.value);
      }
    }

    // Sort by version number
    return migrations.sort((a, b) => a.version - b.version);
  }

  /**
   * Check if a specific migration has been applied
   */
  async isMigrationApplied(version: number): Promise<boolean> {
    const key = [...this.appliedMigrationsPrefix, version];
    const result = await this.kv.get(key);
    return result.value !== null;
  }

  /**
   * Get a specific applied migration
   */
  async getAppliedMigration(version: number): Promise<AppliedMigration | null> {
    const key = [...this.appliedMigrationsPrefix, version];
    const result = await this.kv.get<AppliedMigration>(key);
    return result.value ?? null;
  }

  /**
   * Initialize the migration system (create initial version if not exists)
   */
  async initialize(): Promise<void> {
    const currentVersion = await this.getCurrentVersion();
    if (currentVersion === 0) {
      // First time setup - set version to 0
      await this.setCurrentVersion(0);
    }
  }

  /**
   * Atomically update version and record migration
   */
  async applyMigration(
    fromVersion: number,
    toVersion: number,
    migration: AppliedMigration,
  ): Promise<void> {
    const atomic = this.kv.atomic();

    // Get current version entry to check its versionstamp
    const currentVersionEntry = await this.kv.get(this.versionKey);

    // Check that current version is what we expect
    atomic.check(currentVersionEntry);

    // Update version
    atomic.set(this.versionKey, toVersion);

    // Record applied migration
    const migrationKey = [...this.appliedMigrationsPrefix, migration.version];
    atomic.set(migrationKey, migration);

    const _result = await atomic.commit();

    if (!_result.ok) {
      throw new MigrationStateError(
        `Failed to apply migration ${migration.version}: version conflict`,
        fromVersion,
        toVersion,
      );
    }
  }

  /**
   * Atomically rollback version and remove migration record
   */
  async rollbackMigration(
    fromVersion: number,
    toVersion: number,
    migrationVersion: number,
  ): Promise<void> {
    const atomic = this.kv.atomic();

    // Check that current version is what we expect
    const versionCheck = await this.kv.get(this.versionKey);
    atomic.check(versionCheck);

    // Update version
    atomic.set(this.versionKey, toVersion);

    // Remove applied migration record
    const migrationKey = [...this.appliedMigrationsPrefix, migrationVersion];
    atomic.delete(migrationKey);

    const _result = await atomic.commit();

    if (!_result.ok) {
      throw new MigrationStateError(
        `Failed to rollback migration ${migrationVersion}: version conflict`,
        fromVersion,
        toVersion,
      );
    }
  }

  /**
   * Get migration system statistics
   */
  async getStats(): Promise<{
    currentVersion: number;
    totalAppliedMigrations: number;
    firstMigrationDate?: Date;
    lastMigrationDate?: Date;
  }> {
    const currentVersion = await this.getCurrentVersion();
    const appliedMigrations = await this.getAppliedMigrations();

    const stats = {
      currentVersion,
      totalAppliedMigrations: appliedMigrations.length,
      firstMigrationDate: undefined as Date | undefined,
      lastMigrationDate: undefined as Date | undefined,
    };

    if (appliedMigrations.length > 0) {
      stats.firstMigrationDate = appliedMigrations[0].appliedAt;
      stats.lastMigrationDate =
        appliedMigrations[appliedMigrations.length - 1].appliedAt;
    }

    return stats;
  }

  /**
   * Clear all migration data (for testing/reset)
   */
  async clear(): Promise<void> {
    // Delete version
    await this.kv.delete(this.versionKey);

    // Delete all applied migrations
    for await (
      const entry of this.kv.list({ prefix: this.appliedMigrationsPrefix })
    ) {
      await this.kv.delete(entry.key);
    }
  }

  /**
   * Validate migration chain integrity
   */
  async validateIntegrity(): Promise<{
    isValid: boolean;
    errors: string[];
  }> {
    const errors: string[] = [];
    const currentVersion = await this.getCurrentVersion();
    const appliedMigrations = await this.getAppliedMigrations();

    // Check version consistency
    if (appliedMigrations.length > 0) {
      const highestApplied = Math.max(
        ...appliedMigrations.map((m) => m.version),
      );
      if (currentVersion !== highestApplied) {
        errors.push(
          `Version mismatch: current version is ${currentVersion} but highest applied migration is ${highestApplied}`,
        );
      }
    } else if (currentVersion !== 0) {
      errors.push(
        `Version mismatch: current version is ${currentVersion} but no migrations have been applied`,
      );
    }

    // Check for gaps in migration sequence
    const versions = appliedMigrations.map((m) => m.version).sort((a, b) =>
      a - b
    );
    for (let i = 1; i < versions.length; i++) {
      if (versions[i] !== versions[i - 1] + 1) {
        errors.push(
          `Gap in migration sequence between version ${versions[i - 1]} and ${
            versions[i]
          }`,
        );
      }
    }

    return {
      isValid: errors.length === 0,
      errors,
    };
  }
}
