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
import type { MigrationStorage } from "./migration-storage.ts";
import type { KVMMigrationUtils } from "./migration-utils.ts";
import { KVMQueueManager } from "./queue-manager.ts";
import type { Queue, QueueManager } from "./queue-types.ts";

/**
 * Main KVM class for managing models and database connection
 */
export class KVM {
  private models = new Map<string, ModelConstructor>();
  private migrationManager: MigrationManager;
  private queueManager: KVMQueueManager;

  constructor(
    private kv: Deno.Kv,
    migrationConfig?: MigrationStorageConfig,
  ) {
    this.migrationManager = new MigrationManager(kv, migrationConfig);
    this.queueManager = new KVMQueueManager(kv);
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
  getModel<T = unknown>(name: string): ModelConstructor<T> | undefined {
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
  async rollback(
    toVersion?: number,
    migrations?: Migration[],
  ): Promise<MigrationResult> {
    return await this.migrationManager.down(toVersion, migrations);
  }

  /**
   * Get current migration status
   */
  async getMigrationStatus(
    migrationsPath?: string | Migration[],
  ): Promise<MigrationStatus> {
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
    storage: Awaited<ReturnType<MigrationStorage["getStats"]>>;
    utils: Awaited<ReturnType<KVMMigrationUtils["getMigrationStats"]>>;
  }> {
    return await this.migrationManager.getStats();
  }

  /**
   * Reset migration state (for testing)
   */
  async resetMigrations(): Promise<void> {
    await this.migrationManager.reset();
  }

  // ============================================================================
  // Queue System Methods
  // ============================================================================

  /**
   * Get or create a queue
   */
  queue<TData = unknown>(queueName: string): Queue<TData> {
    return this.queueManager.queue<TData>(queueName);
  }

  /**
   * Get the queue manager instance
   */
  get queues(): QueueManager {
    return this.queueManager;
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
