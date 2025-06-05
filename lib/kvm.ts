import type { ZodRawShape } from "zod";
import type {
  InferModel,
  ModelConstructor,
  ModelDefinition,
} from "./model-types.ts";
import type { KVMEntity } from "./types.ts";
import { createModelClass } from "./model.ts";
import type { AtomicMutationBuilder } from "./atomic-types.ts";
import { createAtomicBuilder } from "./atomic-builder.ts";
import { MigrationManager } from "./migration-manager.ts";
import type {
  Migration,
  MigrationOptions,
  MigrationResult,
  MigrationStatus,
  MigrationStorageConfig,
} from "./migration-types.ts";

/**
 * Main KVM class for managing models and database connection
 */
export class KVM {
  private models = new Map<string, ModelConstructor>();
  private migrationManager: MigrationManager;

  constructor(
    private kv: Deno.Kv,
    migrationConfig?: MigrationStorageConfig,
  ) {
    this.migrationManager = new MigrationManager(kv, migrationConfig);
  }

  /**
   * Define a new model
   */
  model<TSchema extends ZodRawShape>(
    name: string,
    definition: ModelDefinition<TSchema>,
  ): ModelConstructor<InferModel<ModelDefinition<TSchema>["schema"]>> {
    // Check if model already exists
    if (this.models.has(name)) {
      return this.models.get(name)! as ModelConstructor<
        InferModel<ModelDefinition<TSchema>["schema"]>
      >;
    }

    // Create KVMEntity from definition
    const entity: KVMEntity = {
      name,
      primaryKey: definition.primaryKey,
      secondaryIndexes: definition.secondaryIndexes,
      relations: definition.relations,
      schema: definition.schema,
    };

    // Create model class
    const ModelClass = createModelClass<
      InferModel<ModelDefinition<TSchema>["schema"]>
    >(
      name,
      entity,
      this.kv,
    );

    // Store model for future reference
    this.models.set(name, ModelClass as ModelConstructor);

    return ModelClass;
  }

  /**
   * Get an existing model by name
   */
  getModel<T = any>(name: string): ModelConstructor<T> | undefined {
    return this.models.get(name) as ModelConstructor<T>;
  }

  /**
   * List all registered model names
   */
  getModelNames(): string[] {
    return Array.from(this.models.keys());
  }

  /**
   * Check if a model exists
   */
  hasModel(name: string): boolean {
    return this.models.has(name);
  }

  /**
   * Remove a model (useful for testing)
   */
  removeModel(name: string): boolean {
    return this.models.delete(name);
  }

  /**
   * Clear all models (useful for testing)
   */
  clearModels(): void {
    this.models.clear();
  }

  /**
   * Get the underlying Deno.Kv instance
   */
  getKv(): Deno.Kv {
    return this.kv;
  }

  /**
   * Create an atomic transaction builder
   */
  atomic(): AtomicMutationBuilder {
    return createAtomicBuilder(this.kv);
  }

  /**
   * Initialize the migration system
   */
  async initializeMigrations(): Promise<void> {
    await this.migrationManager.initialize();
  }

  /**
   * Run pending migrations
   */
  async migrate(options?: MigrationOptions): Promise<MigrationResult> {
    return await this.migrationManager.up(options);
  }

  /**
   * Rollback migrations to a specific version
   */
  async rollback(toVersion?: number, migrations?: Migration[]): Promise<MigrationResult> {
    return await this.migrationManager.down(toVersion, migrations);
  }

  /**
   * Get current migration status
   */
  async getMigrationStatus(migrationsPath?: string | Migration[]): Promise<MigrationStatus> {
    return await this.migrationManager.getStatus(migrationsPath);
  }

  /**
   * Load migrations from a directory or array
   */
  async loadMigrations(
    migrationsPath: string | Migration[],
  ): Promise<Migration[]> {
    return await this.migrationManager.loadMigrations(migrationsPath);
  }

  /**
   * Validate migration chain integrity
   */
  async validateMigrationIntegrity(): Promise<{
    isValid: boolean;
    errors: string[];
  }> {
    return await this.migrationManager.validateIntegrity();
  }

  /**
   * Get migration statistics
   */
  async getMigrationStats(): Promise<{
    storage: any;
    utils: any;
  }> {
    return await this.migrationManager.getStats();
  }

  /**
   * Reset migration state (for testing)
   */
  async resetMigrations(): Promise<void> {
    await this.migrationManager.reset();
  }

  /**
   * Close the database connection
   */
  async close(): Promise<void> {
    await this.kv.close();
  }
}

/**
 * Create a new KVM instance
 */
export async function createKVM(
  path?: string,
  migrationConfig?: MigrationStorageConfig,
): Promise<KVM> {
  const kv = await Deno.openKv(path);
  const kvmInstance = new KVM(kv, migrationConfig);
  
  // Initialize migrations on first use
  await kvmInstance.initializeMigrations();
  
  return kvmInstance;
}
