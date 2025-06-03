import type { ZodRawShape } from "zod";
import type {
  InferModel,
  ModelConstructor,
  ModelDefinition,
} from "./model-types.ts";
import type { KVMEntity } from "./types.ts";
import { createModelClass } from "./model.ts";

/**
 * Main KVM class for managing models and database connection
 */
export class KVM {
  private models = new Map<string, ModelConstructor>();

  constructor(private kv: Deno.Kv) {}

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
   * Close the database connection
   */
  async close(): Promise<void> {
    await this.kv.close();
  }
}

/**
 * Create a new KVM instance
 */
export async function createKVM(path?: string): Promise<KVM> {
  const kv = await Deno.openKv(path);
  return new KVM(kv);
}
