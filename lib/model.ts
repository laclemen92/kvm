import type {
  CreateOptions,
  DeleteOptions,
  FindOptions,
  ModelConstructor,
  ModelDocument,
  ModelStatic,
  UpdateOptions,
} from "./model-types.ts";
import type {
  FindManyOptions,
  KVMEntity,
  PopulateOptions,
} from "./types.ts";
import { RelationType } from "./types.ts";
import type { QueryBuilder, WhereClause } from "./query-types.ts";
import type {
  BatchCreateOptions,
  BatchCreateResult,
  BatchDeleteInput,
  BatchDeleteOptions,
  BatchDeleteResult,
  BatchUpdateInput,
  BatchUpdateOptions,
  BatchUpdateResult,
} from "./batch-types.ts";
import type {
  HookContext,
  HookManager,
  HookOptions,
  HookType,
  Plugin,
  PostHookFunction,
  PreHookFunction,
} from "./middleware-types.ts";
import { create } from "./create.ts";
import {
  eagerLoadRelations,
  findFirst,
  findFirstOrThrow,
  findMany,
  findUnique,
  findUniqueOrThrow,
} from "./find.ts";
import { update, updateMany } from "./update.ts";
import { deleteKey, deleteMany } from "./delete.ts";
import { KVMQueryBuilder } from "./query-builder.ts";
import {
  createMany as batchCreate,
  deleteMany as batchDelete,
  updateMany as batchUpdate,
} from "./batch-operations.ts";
import { KVMHookManager } from "./middleware.ts";
import {
  KVMErrorUtils,
  KVMNotFoundError,
  KVMOperationError,
  KVMValidationError,
} from "./errors.ts";

/**
 * Base model class that provides instance methods for documents
 */
export class BaseModel<T = any> implements ModelDocument<T> {
  [key: string]: any;

  constructor(data: T) {
    Object.assign(this, data);
  }

  /**
   * Save changes to this document
   */
  async save(): Promise<this> {
    const ModelClass = this.constructor as ModelConstructor<T>;
    const primaryKeyValue = this._getPrimaryKeyValue();

    const context: HookContext<T> = {
      modelName: ModelClass.modelName,
      operation: "save",
      document: this,
      input: this as any,
    };

    try {
      // Execute pre-save hooks
      await ModelClass.hooks.executePreHooks("save", context, this);

      const result = await update<T>(
        ModelClass.entity,
        ModelClass.kv,
        primaryKeyValue,
        this as any,
      );

      if (result?.value) {
        Object.assign(this, result.value);
      }

      // Execute post-save hooks
      await ModelClass.hooks.executePostHooks("save", context, result, this);

      return this;
    } catch (error) {
      if ((error as Error).name === "ZodError") {
        throw KVMErrorUtils.fromZodError(error as any, ModelClass.modelName);
      }
      throw KVMErrorUtils.wrap(error as Error, "update", ModelClass.modelName);
    }
  }

  /**
   * Delete this document
   */
  async delete(options?: DeleteOptions): Promise<void> {
    const ModelClass = this.constructor as ModelConstructor<T>;
    const primaryKeyValue = this._getPrimaryKeyValue();

    const context: HookContext<T> = {
      modelName: ModelClass.modelName,
      operation: "delete",
      document: this,
      options,
    };

    try {
      // Execute pre-delete hooks
      await ModelClass.hooks.executePreHooks("delete", context, this);

      await deleteKey<T>(
        ModelClass.entity,
        ModelClass.kv,
        primaryKeyValue,
        options ? { cascadeDelete: options.cascadeDelete ?? false } : undefined,
      );

      // Execute post-delete hooks
      await ModelClass.hooks.executePostHooks("delete", context, true, this);
    } catch (error) {
      throw KVMErrorUtils.wrap(error as Error, "delete", ModelClass.modelName);
    }
  }

  /**
   * Update this document with new data
   */
  async update(data: Partial<T>, options?: UpdateOptions): Promise<this> {
    const ModelClass = this.constructor as ModelConstructor<T>;

    const context: HookContext<T> = {
      modelName: ModelClass.modelName,
      operation: "update",
      document: this,
      input: data,
      options,
    };

    try {
      // Execute pre-update hooks
      await ModelClass.hooks.executePreHooks("update", context, this);

      Object.assign(this, data);

      const result = await this.save();

      // Execute post-update hooks
      await ModelClass.hooks.executePostHooks("update", context, result, this);

      return result;
    } catch (error) {
      if (KVMErrorUtils.isKVMError(error)) {
        throw error;
      }
      throw KVMErrorUtils.wrap(error as Error, "update", ModelClass.modelName);
    }
  }

  /**
   * Reload this document from the database
   */
  async reload(): Promise<this> {
    const ModelClass = this.constructor as ModelConstructor<T>;
    const primaryKeyValue = this._getPrimaryKeyValue();

    try {
      const result = await findUnique<T>(
        ModelClass.entity,
        ModelClass.kv,
        primaryKeyValue,
      );

      if (result?.value) {
        Object.assign(this, result.value);
      } else {
        throw new KVMNotFoundError(
          ModelClass.modelName,
          primaryKeyValue,
          "id",
        );
      }

      return this;
    } catch (error) {
      if (KVMErrorUtils.isKVMError(error)) {
        throw error;
      }
      throw KVMErrorUtils.wrap(error as Error, "read", ModelClass.modelName);
    }
  }

  /**
   * Populate relations for this document
   */
  async populate(path: string | PopulateOptions): Promise<this>;
  async populate(paths: (string | PopulateOptions)[]): Promise<this>;
  async populate(
    pathOrPaths: string | PopulateOptions | (string | PopulateOptions)[],
  ): Promise<this> {
    const ModelClass = this.constructor as ModelConstructor<T>;

    try {
      const paths = Array.isArray(pathOrPaths) ? pathOrPaths : [pathOrPaths];

      for (const pathDef of paths) {
        await this._populatePath(pathDef, ModelClass);
      }

      return this;
    } catch (error) {
      if (KVMErrorUtils.isKVMError(error)) {
        throw error;
      }
      throw KVMErrorUtils.wrap(
        error as Error,
        "populate",
        ModelClass.modelName,
      );
    }
  }

  /**
   * Populate a specific relation path
   */
  private async _populatePath(
    pathDef: string | PopulateOptions,
    ModelClass: ModelConstructor<T>,
  ): Promise<void> {
    const path = typeof pathDef === "string" ? pathDef : pathDef.path;
    const options = typeof pathDef === "object" ? pathDef : {};

    // Find the relation definition
    const relation = ModelClass.entity.relations?.find((rel) =>
      rel.entityName === path
    );
    if (!relation) {
      throw new KVMOperationError(
        "populate",
        `Relation '${path}' not found in ${ModelClass.modelName}`,
        ModelClass.modelName,
      );
    }

    // Get the foreign key value(s) from this document
    const foreignKeyValues = relation.fields.map((field) =>
      (this as any)[field]
    ).filter(Boolean);
    if (foreignKeyValues.length === 0) {
      return; // No foreign key values to populate
    }

    // Handle different relation types
    switch (relation.type) {
      case RelationType.BELONGS_TO:
        await this._populateBelongsTo(
          relation,
          foreignKeyValues[0],
          options,
          ModelClass,
        );
        break;
      case RelationType.ONE_TO_MANY:
        await this._populateOneToMany(
          relation,
          foreignKeyValues,
          options,
          ModelClass,
        );
        break;
      case RelationType.MANY_TO_MANY:
        await this._populateManyToMany(
          relation,
          foreignKeyValues,
          options,
          ModelClass,
        );
        break;
      default:
        throw new KVMOperationError(
          "populate",
          `Unsupported relation type: ${relation.type}`,
          ModelClass.modelName,
        );
    }
  }

  /**
   * Populate a belongsTo relation (single record)
   */
  private async _populateBelongsTo(
    relation: any,
    foreignKeyValue: any,
    options: Partial<PopulateOptions>,
    ModelClass: ModelConstructor<T>,
  ): Promise<void> {
    try {
      // For belongsTo, we look up the parent record by its primary key
      const result = await findUnique(
        {
          name: relation.entityName,
          primaryKey: [{ name: relation.entityName, key: "id" }],
        } as KVMEntity,
        ModelClass.kv,
        foreignKeyValue,
      );

      if (result?.value) {
        (this as any)[relation.entityName] = result.value;
      }
    } catch (error) {
      // Ignore not found errors for optional relations
    }
  }

  /**
   * Populate a hasMany/one-to-many relation (array of records)
   */
  private async _populateOneToMany(
    relation: any,
    foreignKeyValues: any[],
    options: Partial<PopulateOptions>,
    ModelClass: ModelConstructor<T>,
  ): Promise<void> {
    try {
      // For hasMany, we look up records that reference this document
      const results = await findMany(
        {
          name: relation.entityName,
          primaryKey: [{ name: relation.entityName }],
        } as KVMEntity,
        ModelClass.kv,
        {
          prefix: [relation.entityName],
          limit: options.options?.limit || 100,
        },
      );

      // Filter results that match the foreign key
      const primaryKeyValue = this._getPrimaryKeyValue();
      const filteredResults = results.filter((result) => {
        return relation.fields.some((field: string) =>
          (result.value as any)?.[field] === primaryKeyValue
        );
      });

      (this as any)[relation.entityName] = filteredResults.map((r) => r.value);
    } catch (error) {
      (this as any)[relation.entityName] = [];
    }
  }

  /**
   * Populate a many-to-many relation (array of records through join table)
   */
  private async _populateManyToMany(
    relation: any,
    foreignKeyValues: any[],
    options: Partial<PopulateOptions>,
    ModelClass: ModelConstructor<T>,
  ): Promise<void> {
    if (!relation.through) {
      throw new KVMOperationError(
        "populate",
        `Many-to-many relation '${relation.entityName}' requires a 'through' table`,
        ModelClass.modelName,
      );
    }

    try {
      // Get join table records
      const joinResults = await findMany(
        {
          name: relation.through,
          primaryKey: [{ name: relation.through }],
        } as KVMEntity,
        ModelClass.kv,
        {
          prefix: [relation.through],
          limit: options.options?.limit || 100,
        },
      );

      const primaryKeyValue = this._getPrimaryKeyValue();

      // Find related IDs through the join table
      const relatedIds: any[] = [];
      for (const joinRecord of joinResults) {
        const joinValue = joinRecord.value as any;
        if (
          joinValue &&
          relation.fields.some((field: string) =>
            joinValue[field] === primaryKeyValue
          )
        ) {
          // Extract the other side's ID from the join record
          const otherIdField = Object.keys(joinValue).find((key) =>
            !relation.fields.includes(key) && key.endsWith("Id")
          );
          if (otherIdField && joinValue[otherIdField]) {
            relatedIds.push(joinValue[otherIdField]);
          }
        }
      }

      // Fetch the actual related records
      const relatedRecords = [];
      for (const relatedId of relatedIds) {
        try {
          const result = await findUnique(
            {
              name: relation.entityName,
              primaryKey: [{ name: relation.entityName, key: "id" }],
            } as KVMEntity,
            ModelClass.kv,
            relatedId,
          );
          if (result?.value) {
            relatedRecords.push(result.value);
          }
        } catch (error) {
          // Ignore individual lookup failures
        }
      }

      (this as any)[relation.entityName] = relatedRecords;
    } catch (error) {
      (this as any)[relation.entityName] = [];
    }
  }

  /**
   * Get the primary key value for this document
   */
  private _getPrimaryKeyValue(): string | Record<string, any> {
    const ModelClass = this.constructor as ModelConstructor<T>;
    const primaryKeyDef = ModelClass.entity.primaryKey[0];

    if (primaryKeyDef.key) {
      return (this as any)[primaryKeyDef.key];
    }

    // For composite keys or complex scenarios
    return this as any;
  }
}

/**
 * Creates a model class with static methods
 */
export function createModelClass<T = any>(
  modelName: string,
  entity: KVMEntity,
  kv: Deno.Kv,
): ModelConstructor<T> {
  class DynamicModel extends BaseModel<T> {
    static entity = entity;
    static kv = kv;
    static modelName = modelName;
    static hooks = new KVMHookManager<T>();

    /**
     * Create a new document
     */
    static async create(
      data: T,
      options?: CreateOptions,
    ): Promise<DynamicModel & T> {
      const context: HookContext<T> = {
        modelName,
        operation: "create",
        input: data,
        options,
      };

      try {
        // Execute validation hooks
        const validateResult = await this.hooks.executePreHooks(
          "validate",
          context,
        );
        if (!validateResult.success) {
          throw validateResult.errors[0];
        }

        // Execute pre-create hooks
        const preCreateResult = await this.hooks.executePreHooks(
          "create",
          context,
        );
        if (!preCreateResult.success) {
          throw preCreateResult.errors[0];
        }

        // Execute pre-save hooks (create is also a save operation)
        const preSaveResult = await this.hooks.executePreHooks("save", context);
        if (!preSaveResult.success) {
          throw preSaveResult.errors[0];
        }

        const result = await create<T>(this.entity, this.kv, data, options);

        if (!result?.value) {
          throw new KVMOperationError(
            "create",
            "Failed to create document",
            modelName,
          );
        }

        const instance = new this(result.value) as DynamicModel & T;

        // Execute post-create hooks
        await this.hooks.executePostHooks("create", context, result, instance);

        // Execute post-save hooks
        await this.hooks.executePostHooks("save", context, result, instance);

        return instance;
      } catch (error) {
        if (KVMErrorUtils.isKVMError(error)) {
          throw error;
        }
        if ((error as Error).name === "ZodError") {
          throw KVMErrorUtils.fromZodError(error as any, modelName);
        }
        throw KVMErrorUtils.wrap(error as Error, "create", modelName);
      }
    }

    /**
     * Find document by primary key
     */
    static async findById(
      id: string,
      options?: FindOptions,
    ): Promise<(DynamicModel & T) | null> {
      const context: HookContext<T> = {
        modelName,
        operation: "findOne",
        conditions: { id },
        options,
      };

      try {
        // Execute pre-find hooks
        await this.hooks.executePreHooks("findOne", context);

        const result = await findUnique<T>(this.entity, this.kv, id);

        if (!result?.value) {
          return null;
        }

        // Handle eager loading if include options are provided
        if (options?.include) {
          await eagerLoadRelations(
            this.entity,
            this.kv,
            [result],
            options.include,
          );
        }

        const instance = new this(result.value) as DynamicModel & T;

        // Execute post-find hooks
        await this.hooks.executePostHooks("findOne", context, result, instance);

        return instance;
      } catch (error) {
        if (KVMErrorUtils.isKVMError(error)) {
          throw error;
        }
        throw KVMErrorUtils.wrap(error as Error, "read", modelName);
      }
    }

    /**
     * Find document by primary key or throw error
     */
    static async findByIdOrThrow(
      id: string,
      options?: FindOptions,
    ): Promise<DynamicModel & T> {
      const result = await this.findById(id, options);

      if (!result) {
        throw new KVMNotFoundError(modelName, id, "id");
      }

      return result;
    }

    /**
     * Find unique document by key or secondary index
     */
    static async findUnique(
      key: string | Deno.KvKeyPart | Record<string, any>,
      secondaryIndexName?: string,
      includeValue?: boolean,
    ): Promise<(DynamicModel & T) | null> {
      try {
        const result = await findUnique<T>(
          this.entity,
          this.kv,
          key as any,
          secondaryIndexName,
          includeValue,
        );

        if (!result?.value) {
          return null;
        }

        return new this(result.value) as DynamicModel & T;
      } catch (error) {
        if (KVMErrorUtils.isKVMError(error)) {
          throw error;
        }
        throw KVMErrorUtils.wrap(error as Error, "read", modelName);
      }
    }

    /**
     * Find unique document or throw error
     */
    static async findUniqueOrThrow(
      key: string | Deno.KvKeyPart | Record<string, any>,
      secondaryIndexName?: string,
      includeValue?: boolean,
    ): Promise<DynamicModel & T> {
      const result = await this.findUnique(
        key,
        secondaryIndexName,
        includeValue,
      );

      if (!result) {
        throw new KVMNotFoundError(
          modelName,
          key,
          secondaryIndexName ? "unique" : "id",
        );
      }

      return result;
    }

    /**
     * Find many documents
     */
    static async findMany(
      options?: FindManyOptions & FindOptions,
    ): Promise<(DynamicModel & T)[]> {
      try {
        const results = await findMany<T>(this.entity, this.kv, options);

        // Handle eager loading if include options are provided
        if (options?.include) {
          await eagerLoadRelations(
            this.entity,
            this.kv,
            results,
            options.include,
          );
        }

        return results.map((result) =>
          new this(result.value) as DynamicModel & T
        );
      } catch (error) {
        if (KVMErrorUtils.isKVMError(error)) {
          throw error;
        }
        throw KVMErrorUtils.wrap(error as Error, "read", modelName);
      }
    }

    /**
     * Find first document
     */
    static async findFirst(
      options?: FindManyOptions & FindOptions,
    ): Promise<(DynamicModel & T) | null> {
      try {
        const result = await findFirst<T>(this.entity, this.kv, options);

        if (!result?.value) {
          return null;
        }

        // Handle eager loading if include options are provided
        if (options?.include) {
          await eagerLoadRelations(
            this.entity,
            this.kv,
            [result],
            options.include,
          );
        }

        return new this(result.value) as DynamicModel & T;
      } catch (error) {
        if (KVMErrorUtils.isKVMError(error)) {
          throw error;
        }
        throw KVMErrorUtils.wrap(error as Error, "read", modelName);
      }
    }

    /**
     * Find first document or throw error
     */
    static async findFirstOrThrow(
      options?: FindManyOptions,
    ): Promise<DynamicModel & T> {
      const result = await this.findFirst(options);

      if (!result) {
        throw new KVMNotFoundError(modelName, {}, "first");
      }

      return result;
    }

    /**
     * Start a query builder for field-specific conditions
     */
    static where(field: keyof T): WhereClause<T>;
    static where(field: string): WhereClause<T>;
    static where(conditions: Partial<T>): QueryBuilder<T>;
    static where(
      fieldOrConditions: keyof T | string | Partial<T>,
    ): WhereClause<T> | QueryBuilder<T> {
      const queryBuilder = new KVMQueryBuilder<T>(
        this.entity,
        this.kv,
        this as any,
      );
      return queryBuilder.where(fieldOrConditions as any);
    }

    /**
     * Create a query builder for this model
     */
    static query(): QueryBuilder<T> {
      return new KVMQueryBuilder<T>(this.entity, this.kv, this as any);
    }

    /**
     * Create multiple documents in a batch
     */
    static async createMany(
      data: T[],
      options?: BatchCreateOptions,
    ): Promise<BatchCreateResult<DynamicModel & T>> {
      try {
        const result = await batchCreate<T>(
          this.entity,
          this.kv,
          data,
          options,
          modelName,
        );

        // Convert created items to model instances
        const convertedResult: BatchCreateResult<DynamicModel & T> = {
          created: result.created.map((item) =>
            new this(item) as DynamicModel & T
          ),
          failed: result.failed,
          stats: result.stats,
        };

        return convertedResult;
      } catch (error) {
        if (KVMErrorUtils.isKVMError(error)) {
          throw error;
        }
        throw KVMErrorUtils.wrap(error as Error, "create", modelName);
      }
    }

    /**
     * Update multiple documents in a batch
     */
    static async updateMany(
      updates: BatchUpdateInput<T>[],
      options?: BatchUpdateOptions,
    ): Promise<BatchUpdateResult<DynamicModel & T>> {
      try {
        const result = await batchUpdate<T>(
          this.entity,
          this.kv,
          updates,
          options,
          modelName,
        );

        // Convert updated items to model instances
        const convertedResult: BatchUpdateResult<DynamicModel & T> = {
          updated: result.updated.map((item) =>
            new this(item) as DynamicModel & T
          ),
          notFound: result.notFound,
          failed: result.failed,
          stats: result.stats,
        };

        return convertedResult;
      } catch (error) {
        if (KVMErrorUtils.isKVMError(error)) {
          throw error;
        }
        throw KVMErrorUtils.wrap(error as Error, "update", modelName);
      }
    }

    /**
     * Delete multiple documents in a batch
     */
    static async deleteMany(
      keys: BatchDeleteInput[],
      options?: BatchDeleteOptions,
    ): Promise<BatchDeleteResult<DynamicModel & T>> {
      try {
        const result = await batchDelete<T>(
          this.entity,
          this.kv,
          keys,
          options,
          modelName,
        );

        // Convert deleted items to model instances (if returned)
        const convertedResult: BatchDeleteResult<DynamicModel & T> = {
          deleted: result.deleted.map((item) =>
            new this(item) as DynamicModel & T
          ),
          deletedCount: result.deletedCount,
          notFound: result.notFound,
          failed: result.failed,
          stats: result.stats,
        };

        return convertedResult;
      } catch (error) {
        if (KVMErrorUtils.isKVMError(error)) {
          throw error;
        }
        throw KVMErrorUtils.wrap(error as Error, "delete", modelName);
      }
    }

    /**
     * Register a pre-hook
     */
    static pre(
      type: HookType,
      fn: PreHookFunction<T>,
      options?: HookOptions,
    ): void {
      this.hooks.pre(type, fn, options);
    }

    /**
     * Register a post-hook
     */
    static post(
      type: HookType,
      fn: PostHookFunction<T>,
      options?: HookOptions,
    ): void {
      this.hooks.post(type, fn, options);
    }

    /**
     * Install a plugin
     */
    static use(plugin: Plugin<T>, options?: Record<string, any>): void {
      this.hooks.use(plugin, options);
    }

    /**
     * Uninstall a plugin
     */
    static unuse(plugin: Plugin<T>): void {
      this.hooks.unuse(plugin);
    }

    /**
     * Remove hooks
     */
    static removeHook(id: string): boolean {
      return this.hooks.removeHook(id);
    }

    /**
     * Remove all hooks of a type
     */
    static removeHooks(type: HookType, timing?: "pre" | "post"): number {
      return this.hooks.removeHooks(type, timing);
    }

    /**
     * Clear all hooks
     */
    static clearHooks(): void {
      this.hooks.clearHooks();
    }

    /**
     * Get registered hooks
     */
    static getHooks(type?: HookType, timing?: "pre" | "post") {
      return this.hooks.getHooks(type, timing);
    }

    /**
     * Enable/disable hooks
     */
    static setHooksEnabled(enabled: boolean): void {
      this.hooks.setEnabled(enabled);
    }

    /**
     * Check if hooks are enabled
     */
    static areHooksEnabled(): boolean {
      return this.hooks.isEnabled();
    }
  }

  return DynamicModel as unknown as ModelConstructor<T>;
}
