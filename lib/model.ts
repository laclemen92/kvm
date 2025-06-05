import type {
  CreateOptions,
  DeleteOptions,
  FindOptions,
  ModelConstructor,
  ModelDocument,
  ModelStatic,
  UpdateOptions,
} from "./model-types.ts";
import type { FindManyOptions, KVMEntity, PopulateOptions } from "./types.ts";
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
import {
  enhancedCreateMany,
  enhancedDeleteMany,
  enhancedUpdateMany,
} from "./batch-enhanced.ts";
import { KVMHookManager } from "./middleware.ts";
import {
  KVMErrorUtils,
  KVMNotFoundError,
  KVMOperationError,
  KVMValidationError,
} from "./errors.ts";
import type { AtomicMutationBuilder } from "./atomic-types.ts";
import { createAtomicBuilder } from "./atomic-builder.ts";
import { TTL } from "./ttl-utils.ts";
import { AtomicUtils, ModelAtomicUtils } from "./atomic-utils.ts";

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
  async save(options?: UpdateOptions): Promise<this> {
    const ModelClass = this.constructor as ModelConstructor<T>;
    const primaryKeyValue = this._getPrimaryKeyValue();

    const context: HookContext<T> = {
      modelName: ModelClass.modelName,
      operation: "save",
      document: this as any,
      input: this as any,
      options,
    };

    try {
      // Execute pre-save hooks
      await ModelClass.hooks.executePreHooks("save", context, this as any);

      const result = await update<T>(
        ModelClass.entity,
        ModelClass.kv,
        primaryKeyValue,
        this as any,
        options,
      );

      if (result?.value) {
        Object.assign(this, result.value);
      }

      // Execute post-save hooks
      await ModelClass.hooks.executePostHooks(
        "save",
        context,
        result,
        this as any,
      );

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
      document: this as any,
      options,
    };

    try {
      // Execute pre-delete hooks
      await ModelClass.hooks.executePreHooks("delete", context, this as any);

      await deleteKey<T>(
        ModelClass.entity,
        ModelClass.kv,
        primaryKeyValue,
        options ? { cascadeDelete: options.cascadeDelete ?? false } : undefined,
      );

      // Execute post-delete hooks
      await ModelClass.hooks.executePostHooks(
        "delete",
        context,
        true,
        this as any,
      );
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
      document: this as any,
      input: data,
      options,
    };

    try {
      // Execute pre-update hooks
      await ModelClass.hooks.executePreHooks("update", context, this as any);

      Object.assign(this, data);

      const result = await this.save(options);

      // Execute post-update hooks
      await ModelClass.hooks.executePostHooks(
        "update",
        context,
        result,
        this as any,
      );

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
  public _getPrimaryKeyValue(): string | Record<string, any> {
    const ModelClass = this.constructor as ModelConstructor<T>;
    const primaryKeyDef = ModelClass.entity.primaryKey[0];

    if (primaryKeyDef.key) {
      return (this as any)[primaryKeyDef.key];
    }

    // For composite keys or complex scenarios
    return this as any;
  }

  /**
   * Watch this specific document for real-time changes
   */
  async watch(
    options?: import("./watch-types.ts").WatchOptions,
  ): Promise<import("./watch-types.ts").WatchResult<any>> {
    const ModelClass = this.constructor as ModelConstructor<T>;
    const primaryKeyValue = this._getPrimaryKeyValue();

    const { watchRecord } = await import("./watch.ts");
    const result = await watchRecord(
      ModelClass.entity,
      ModelClass.kv,
      primaryKeyValue,
      options,
    );

    // Transform the stream to return model instances
    const originalStream = result.stream;
    const modelStream = new ReadableStream<
      import("./watch-types.ts").WatchEvent<any>
    >({
      start(controller) {
        const reader = originalStream.getReader();

        const processStream = async () => {
          try {
            while (true) {
              const { done, value } = await reader.read();

              if (done) {
                controller.close();
                break;
              }

              // Transform the event to include model instance
              const transformedEvent: import("./watch-types.ts").WatchEvent<
                any
              > = {
                ...value,
                value: value.value ? new ModelClass(value.value as any) : null,
                previousValue: value.previousValue
                  ? new ModelClass(value.previousValue as any)
                  : null,
              };

              controller.enqueue(transformedEvent);
            }
          } catch (error) {
            controller.error(error);
          } finally {
            reader.releaseLock();
          }
        };

        processStream();
      },
    });

    return {
      stream: modelStream,
      stop: result.stop,
      on: (callback: import("./watch-types.ts").WatchCallback<any>) =>
        result.on(callback as any),
      toSSE: result.toSSE,
      toWebSocket: result.toWebSocket,
    };
  }

  /**
   * Increment a counter field for this document
   */
  async incrementField(
    field: string,
    amount: number | bigint = 1,
  ): Promise<import("./atomic-types.ts").AtomicTransactionResult> {
    const ModelClass = this.constructor as ModelConstructor<T>;
    const primaryKeyValue = this._getPrimaryKeyValue();
    return await ModelClass.incrementField(primaryKeyValue, field, amount);
  }

  /**
   * Increment multiple counter fields for this document
   */
  async incrementFields(
    fields: Record<string, number | bigint>,
  ): Promise<import("./atomic-types.ts").AtomicTransactionResult> {
    const ModelClass = this.constructor as ModelConstructor<T>;
    const primaryKeyValue = this._getPrimaryKeyValue();
    return await ModelClass.incrementFields(primaryKeyValue, fields);
  }

  /**
   * Get all counter values for this document
   */
  async getCounters(): Promise<Record<string, bigint>> {
    const ModelClass = this.constructor as ModelConstructor<T>;
    const primaryKeyValue = this._getPrimaryKeyValue();
    return await ModelClass.getCounters(primaryKeyValue);
  }

  /**
   * Create a counter for a specific field of this document
   */
  createFieldCounter(field: string): import("./atomic-utils.ts").AtomicCounter {
    const ModelClass = this.constructor as ModelConstructor<T>;
    const primaryKeyValue = this._getPrimaryKeyValue();
    return ModelClass.createFieldCounter(primaryKeyValue, field);
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
        if (options?.include && result?.value !== null) {
          await eagerLoadRelations(
            this.entity,
            this.kv,
            [result as Deno.KvEntry<T>],
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
      includeValue: boolean = true,
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
          key as string | Record<string, any>,
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
        if (options?.include && result?.value !== null) {
          await eagerLoadRelations(
            this.entity,
            this.kv,
            [result as Deno.KvEntry<T>],
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
        // Use enhanced batch operations if retry options are provided
        const hasRetryOptions = options && (
          options.maxRetries !== undefined ||
          options.retryDelay !== undefined ||
          options.rollbackOnAnyFailure !== undefined ||
          options.shouldRetry !== undefined ||
          options.onRetry !== undefined
        );

        const result = hasRetryOptions
          ? await enhancedCreateMany<T>(this.entity, this.kv, data, options, modelName)
          : await batchCreate<T>(this.entity, this.kv, data, options, modelName);

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
        // Use enhanced batch operations if retry options are provided
        const hasRetryOptions = options && (
          options.maxRetries !== undefined ||
          options.retryDelay !== undefined ||
          options.rollbackOnAnyFailure !== undefined ||
          options.shouldRetry !== undefined ||
          options.onRetry !== undefined
        );

        const result = hasRetryOptions
          ? await enhancedUpdateMany<T>(this.entity, this.kv, updates, options, modelName)
          : await batchUpdate<T>(this.entity, this.kv, updates, options, modelName);

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
        // Use enhanced batch operations if retry options are provided
        const hasRetryOptions = options && (
          options.maxRetries !== undefined ||
          options.retryDelay !== undefined ||
          options.rollbackOnAnyFailure !== undefined ||
          options.shouldRetry !== undefined ||
          options.onRetry !== undefined
        );

        const result = hasRetryOptions
          ? await enhancedDeleteMany<T>(this.entity, this.kv, keys, options, modelName)
          : await batchDelete<T>(this.entity, this.kv, keys, options, modelName);

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
     * Atomic bulk update with rollback support
     */
    static async atomicBulkUpdate(
      updates: Array<{
        id: string | Deno.KvKeyPart;
        data: Partial<T>;
      }>,
      options?: {
        rollbackOnAnyFailure?: boolean;
        maxRetries?: number;
        retryDelay?: number;
      },
    ): Promise<BatchUpdateResult<DynamicModel & T>> {
      const batchUpdates: BatchUpdateInput<T>[] = updates.map((update) => ({
        key: update.id,
        data: update.data,
      }));

      return this.updateMany(batchUpdates, {
        atomic: true,
        rollbackOnAnyFailure: options?.rollbackOnAnyFailure ?? true,
        maxRetries: options?.maxRetries ?? 0,
        retryDelay: options?.retryDelay ?? 1000,
      });
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

    // ============================================================================
    // Atomic Transaction Methods
    // ============================================================================

    /**
     * Create an atomic transaction builder
     */
    static atomic(): AtomicMutationBuilder {
      return createAtomicBuilder(this.kv);
    }

    /**
     * Create multiple documents atomically
     */
    static async createAtomic(
      data: T[],
      options?: CreateOptions,
    ): Promise<(DynamicModel & T)[]> {
      const builder = this.atomic();

      // Process TTL if provided
      let processedOptions: { expireIn?: number } | undefined;
      if (options?.expireIn !== undefined) {
        const expireInMs = typeof options.expireIn === "string"
          ? TTL.parse(options.expireIn)
          : options.expireIn;

        if (!TTL.isValid(expireInMs)) {
          throw new Error(`Invalid TTL value: ${options.expireIn}`);
        }

        processedOptions = { expireIn: expireInMs };
      }

      for (const item of data) {
        builder.create(this.entity, item, processedOptions);
      }

      const result = await builder.commit();

      if (!result.ok) {
        throw new KVMOperationError(
          "createAtomic",
          result.failedMutation?.error.message || "Atomic create failed",
          modelName,
        );
      }

      return data.map((item) => new this(item) as DynamicModel & T);
    }

    /**
     * Update multiple documents atomically
     */
    static async updateAtomic(
      updates: Array<{
        key: Record<string, Deno.KvKeyPart>;
        data: Partial<T>;
        options?: UpdateOptions;
      }>,
    ): Promise<(DynamicModel & T)[]> {
      const builder = this.atomic();

      for (const update of updates) {
        // Process TTL if provided
        let processedOptions: { expireIn?: number } | undefined;
        if (update.options?.expireIn !== undefined) {
          const expireInMs = typeof update.options.expireIn === "string"
            ? TTL.parse(update.options.expireIn)
            : update.options.expireIn;

          if (!TTL.isValid(expireInMs)) {
            throw new Error(`Invalid TTL value: ${update.options.expireIn}`);
          }

          processedOptions = { expireIn: expireInMs };
        }

        builder.update(this.entity, update.key, update.data, processedOptions);
      }

      const result = await builder.commit();

      if (!result.ok) {
        throw new KVMOperationError(
          "updateAtomic",
          result.failedMutation?.error.message || "Atomic update failed",
          modelName,
        );
      }

      // Fetch updated records to return
      const updatedRecords = [];
      for (const update of updates) {
        const record = await this.findUnique(update.key);
        if (record) {
          updatedRecords.push(record);
        }
      }

      return updatedRecords;
    }

    /**
     * Delete multiple documents atomically
     */
    static async deleteAtomic(
      keys: Array<Record<string, Deno.KvKeyPart>>,
      options?: DeleteOptions,
    ): Promise<number> {
      const builder = this.atomic();

      for (const key of keys) {
        builder.delete(this.entity, key, options);
      }

      const result = await builder.commit();

      if (!result.ok) {
        throw new KVMOperationError(
          "deleteAtomic",
          result.failedMutation?.error.message || "Atomic delete failed",
          modelName,
        );
      }

      return keys.length;
    }

    /**
     * Create an atomic transfer operation (move data from one record to another)
     */
    static async transferAtomic(
      fromKey: Record<string, Deno.KvKeyPart>,
      toData: T,
      options?: {
        expireIn?: number;
        cascadeDelete?: boolean;
      },
    ): Promise<DynamicModel & T> {
      const result = await this.atomic()
        .delete(this.entity, fromKey, { cascadeDelete: options?.cascadeDelete })
        .create(this.entity, toData, { expireIn: options?.expireIn })
        .commit();

      if (!result.ok) {
        throw new KVMOperationError(
          "transferAtomic",
          result.failedMutation?.error.message || "Atomic transfer failed",
          modelName,
        );
      }

      return new this(toData) as DynamicModel & T;
    }

    /**
     * Create an atomic upsert operation (create if not exists, update if exists)
     */
    static async upsertAtomic(
      data: T,
      options?: {
        expireIn?: number;
        merge?: boolean;
      },
    ): Promise<DynamicModel & T> {
      // For upsert, we'll use the builder's set method directly
      const pk = this._buildPrimaryKey(data);

      const result = await this.atomic()
        .set(pk, data, { expireIn: options?.expireIn })
        .commit();

      if (!result.ok) {
        throw new KVMOperationError(
          "upsertAtomic",
          result.failedMutation?.error.message || "Atomic upsert failed",
          modelName,
        );
      }

      return new this(data) as DynamicModel & T;
    }

    /**
     * Update a document by its ID
     */
    static async update(
      id: string | Deno.KvKeyPart,
      data: Partial<T>,
      options?: UpdateOptions,
    ): Promise<DynamicModel & T> {
      const context: HookContext<T> = {
        modelName,
        operation: "update",
        input: data,
        options,
      };

      try {
        // Execute pre-update hooks
        const preUpdateResult = await this.hooks.executePreHooks(
          "update",
          context,
        );
        if (!preUpdateResult.success) {
          throw preUpdateResult.errors[0];
        }

        // Find the existing document first to ensure it exists
        const existing = typeof id === 'string' 
          ? await this.findById(id)
          : await this.findUnique(id);
          
        if (!existing) {
          throw new KVMNotFoundError(modelName, id as string | Record<string, any>, "id");
        }

        // Update using the core update function
        const result = await update<T>(this.entity, this.kv, id, data, options);

        if (!result?.value) {
          throw new KVMOperationError(
            "update",
            "Failed to update document",
            modelName,
          );
        }

        const instance = new this(result.value) as DynamicModel & T;

        // Execute post-update hooks
        await this.hooks.executePostHooks("update", context, result, instance);

        return instance;
      } catch (error) {
        if (KVMErrorUtils.isKVMError(error)) {
          throw error;
        }
        throw KVMErrorUtils.wrap(error as Error, "update", modelName);
      }
    }

    /**
     * Upsert operation: find by criteria, update if found, create if not found
     */
    static async upsert(
      findCriteria: Record<string, any>,
      updateData: Partial<T>,
      createData: T,
      options?: CreateOptions | UpdateOptions,
    ): Promise<DynamicModel & T> {
      const context: HookContext<T> = {
        modelName,
        operation: "upsert",
        input: { findCriteria, updateData, createData },
        options,
      };

      try {
        // Execute pre-upsert hooks
        const preUpsertResult = await this.hooks.executePreHooks(
          "upsert",
          context,
        );
        if (!preUpsertResult.success) {
          throw preUpsertResult.errors[0];
        }

        // Try to find existing document by criteria
        let existing: (DynamicModel & T) | null = null;

        // If findCriteria has the primary key field, use findById for efficiency
        const primaryKeyField = this.entity.primaryKey.find(pk => pk.key)?.key;
        if (primaryKeyField && findCriteria[primaryKeyField]) {
          existing = await this.findById(findCriteria[primaryKeyField]);
        } else {
          // Find by secondary index or other criteria
          const criteriaKeys = Object.keys(findCriteria);
          if (criteriaKeys.length === 1) {
            const [fieldName] = criteriaKeys;
            const fieldValue = findCriteria[fieldName];
            
            // Check if this field has a secondary index
            const hasIndex = this.entity.secondaryIndexes?.some(
              idx => idx.key.some(keyPart => keyPart.key === fieldName)
            );
            
            if (hasIndex) {
              existing = await this.findUnique(fieldValue, fieldName);
            } else {
              // Fall back to scanning all records - this is inefficient for large datasets
              // In a real implementation, you might want to limit this or require indexes
              const results = await this.findMany({ limit: 1000 });
              existing = results.find(doc => {
                return Object.entries(findCriteria).every(([key, value]) => 
                  (doc as any)[key] === value
                );
              }) || null;
            }
          } else {
            // Multiple criteria - scan and filter
            const results = await this.findMany({ limit: 1000 });
            existing = results.find(doc => {
              return Object.entries(findCriteria).every(([key, value]) => 
                (doc as any)[key] === value
              );
            }) || null;
          }
        }

        let result: DynamicModel & T;

        if (existing) {
          // Update existing document using the primary key value
          const primaryKeyValue = existing._getPrimaryKeyValue();
          result = await this.update(
            primaryKeyValue as string | Deno.KvKeyPart,
            updateData,
            options as UpdateOptions,
          );
        } else {
          // Create new document
          result = await this.create(createData, options as CreateOptions);
        }

        // Execute post-upsert hooks
        await this.hooks.executePostHooks("upsert", context, result, result);

        return result;
      } catch (error) {
        if (KVMErrorUtils.isKVMError(error)) {
          throw error;
        }
        throw KVMErrorUtils.wrap(error as Error, "update", modelName);
      }
    }

    /**
     * Batch upsert operations
     */
    static async upsertMany(
      operations: Array<{
        findCriteria: Record<string, any>;
        updateData: Partial<T>;
        createData: T;
        options?: CreateOptions | UpdateOptions;
      }>,
      batchOptions?: {
        atomic?: boolean;
        continueOnError?: boolean;
      },
    ): Promise<BatchCreateResult<DynamicModel & T>> {
      const context: HookContext<T> = {
        modelName,
        operation: "upsertMany",
        input: operations,
        options: batchOptions,
      };

      try {
        // Execute pre-upsertMany hooks
        const preUpsertManyResult = await this.hooks.executePreHooks(
          "upsertMany",
          context,
        );
        if (!preUpsertManyResult.success) {
          throw preUpsertManyResult.errors[0];
        }

        const results: (DynamicModel & T)[] = [];
        const errors: Array<{ index: number; error: Error; data: any }> = [];

        if (batchOptions?.atomic) {
          // For atomic operations, we need to handle this differently
          // Since we need to check existence first, we'll do individual upserts
          // but ensure they're all processed together
          for (let i = 0; i < operations.length; i++) {
            try {
              const result = await this.upsert(
                operations[i].findCriteria,
                operations[i].updateData,
                operations[i].createData,
                operations[i].options,
              );
              results.push(result);
            } catch (error) {
              if (batchOptions?.continueOnError) {
                errors.push({
                  index: i,
                  error: error as Error,
                  data: operations[i],
                });
              } else {
                throw error;
              }
            }
          }
        } else {
          // Non-atomic batch processing
          for (let i = 0; i < operations.length; i++) {
            try {
              const result = await this.upsert(
                operations[i].findCriteria,
                operations[i].updateData,
                operations[i].createData,
                operations[i].options,
              );
              results.push(result);
            } catch (error) {
              if (batchOptions?.continueOnError) {
                errors.push({
                  index: i,
                  error: error as Error,
                  data: operations[i],
                });
              } else {
                throw error;
              }
            }
          }
        }

        const batchResult: BatchCreateResult<DynamicModel & T> = {
          created: results,
          failed: errors,
          stats: {
            total: operations.length,
            created: results.length,
            failed: errors.length,
            retried: 0,
            rolledBack: 0,
          },
        };

        // Execute post-upsertMany hooks
        await this.hooks.executePostHooks("upsertMany", context, batchResult, results[0] || null);

        return batchResult;
      } catch (error) {
        if (KVMErrorUtils.isKVMError(error)) {
          throw error;
        }
        throw KVMErrorUtils.wrap(error as Error, "create", modelName);
      }
    }

    /**
     * Helper method to build primary key from data
     */
    private static _buildPrimaryKey(data: any): Deno.KvKey {
      const keyParts: Deno.KvKeyPart[] = [];

      for (const keyDef of this.entity.primaryKey) {
        if (keyDef.name) {
          keyParts.push(keyDef.name);
        }
        if (keyDef.key) {
          const value = data[keyDef.key];
          if (value !== undefined && value !== null) {
            keyParts.push(value);
          } else {
            throw new KVMValidationError(
              keyDef.key,
              value,
              `Primary key field '${keyDef.key}' is required`,
              modelName,
            );
          }
        }
      }

      return keyParts;
    }

    // ============================================================================
    // Hook Management
    // ============================================================================

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

    // ============================================================================
    // Atomic Utilities Methods
    // ============================================================================

    /**
     * Get atomic utilities for this model
     */
    static atomicUtils(): ModelAtomicUtils {
      return AtomicUtils.forModel(this.kv, this.entity);
    }

    /**
     * Increment a counter field for a record atomically
     */
    static async incrementField(
      recordKey: string | Record<string, any>,
      field: string,
      amount: number | bigint = 1,
    ): Promise<import("./atomic-types.ts").AtomicTransactionResult> {
      return await this.atomicUtils().incrementField(recordKey, field, amount);
    }

    /**
     * Increment multiple counter fields atomically
     */
    static async incrementFields(
      recordKey: string | Record<string, any>,
      fields: Record<string, number | bigint>,
    ): Promise<import("./atomic-types.ts").AtomicTransactionResult> {
      return await this.atomicUtils().incrementFields(recordKey, fields);
    }

    /**
     * Get all counter values for a record
     */
    static async getCounters(
      recordKey: string | Record<string, any>,
    ): Promise<Record<string, bigint>> {
      return await this.atomicUtils().getCounters(recordKey);
    }

    /**
     * Create a counter for a specific field
     */
    static createFieldCounter(
      recordKey: string | Record<string, any>,
      field: string,
    ): import("./atomic-utils.ts").AtomicCounter {
      return this.atomicUtils().createFieldCounter(recordKey, field);
    }

    /**
     * Create a general-purpose counter
     */
    static createCounter(
      key: Deno.KvKey,
    ): import("./atomic-utils.ts").AtomicCounter {
      return AtomicUtils.counter(this.kv, key);
    }

    // ============================================================================
    // Advanced List Operations
    // ============================================================================

    /**
     * Advanced list operation with range queries and cursor pagination
     */
    static async list(
      options?: import("./list-operations.ts").ListOptions,
    ): Promise<import("./model-types.ts").ModelListResult<DynamicModel & T>> {
      const { list } = await import("./list-operations.ts");
      const result = await list<T>(this.entity, this.kv, options);

      return {
        data: result.data.map((entry) =>
          new this(entry.value) as DynamicModel & T
        ),
        nextCursor: result.nextCursor,
        hasMore: result.hasMore,
        count: result.count,
      };
    }

    /**
     * List records within a specific key range
     */
    static async listRange(
      startKey: Deno.KvKey,
      endKey: Deno.KvKey,
      options?: Omit<
        import("./list-operations.ts").ListOptions,
        "start" | "end"
      >,
    ): Promise<import("./model-types.ts").ModelListResult<DynamicModel & T>> {
      const { listRange } = await import("./list-operations.ts");
      const result = await listRange<T>(
        this.entity,
        this.kv,
        startKey,
        endKey,
        options,
      );

      return {
        data: result.data.map((entry) =>
          new this(entry.value) as DynamicModel & T
        ),
        nextCursor: result.nextCursor,
        hasMore: result.hasMore,
        count: result.count,
      };
    }

    /**
     * List records with a specific prefix
     */
    static async listByPrefix(
      prefix: Deno.KvKey,
      options?: Omit<import("./list-operations.ts").ListOptions, "prefix">,
    ): Promise<import("./model-types.ts").ModelListResult<DynamicModel & T>> {
      const { listByPrefix } = await import("./list-operations.ts");
      const result = await listByPrefix<T>(
        this.entity,
        this.kv,
        prefix,
        options,
      );

      return {
        data: result.data.map((entry) =>
          new this(entry.value) as DynamicModel & T
        ),
        nextCursor: result.nextCursor,
        hasMore: result.hasMore,
        count: result.count,
      };
    }

    /**
     * List records by date range
     */
    static async listByDateRange(
      options: import("./list-operations.ts").DateRangeOptions,
    ): Promise<import("./model-types.ts").ModelListResult<DynamicModel & T>> {
      const { listByDateRange } = await import("./list-operations.ts");
      const result = await listByDateRange<T>(this.entity, this.kv, options);

      return {
        data: result.data.map((entry) =>
          new this(entry.value) as DynamicModel & T
        ),
        nextCursor: result.nextCursor,
        hasMore: result.hasMore,
        count: result.count,
      };
    }

    /**
     * Stream results for large datasets with automatic batching
     */
    static async *listStream(
      options?: import("./list-operations.ts").ListOptions,
    ): AsyncGenerator<DynamicModel & T, void, unknown> {
      const { listStream } = await import("./list-operations.ts");

      for await (const entry of listStream<T>(this.entity, this.kv, options)) {
        yield new this(entry.value) as DynamicModel & T;
      }
    }

    /**
     * Count records matching the given criteria
     */
    static async count(
      options?: Omit<
        import("./list-operations.ts").ListOptions,
        "limit" | "cursor"
      >,
    ): Promise<number> {
      const { count } = await import("./list-operations.ts");
      return await count(this.entity, this.kv, options);
    }

    /**
     * Get paginated results with metadata
     */
    static async paginate(
      options?: import("./list-operations.ts").PaginationOptions,
    ): Promise<import("./model-types.ts").ModelPaginatedResult<DynamicModel & T>> {
      const { paginate } = await import("./list-operations.ts");
      const result = await paginate<T>(this.entity, this.kv, options);

      return {
        data: result.data.map((entry) =>
          new this(entry.value) as DynamicModel & T
        ),
        pagination: result.pagination,
      };
    }

    // ============================================================================
    // Watch/Stream Methods
    // ============================================================================

    /**
     * Watch a specific document by ID for real-time changes
     */
    static async watch(
      id: string,
      options?: import("./watch-types.ts").WatchOptions,
    ): Promise<import("./watch-types.ts").WatchResult<DynamicModel & T>> {
      const { watchRecord } = await import("./watch.ts");
      const result = await watchRecord(this.entity, this.kv, id, options);

      // Transform the stream to return model instances
      const originalStream = result.stream;
      const modelStream = new ReadableStream<
        import("./watch-types.ts").WatchEvent<DynamicModel & T>
      >({
        start(controller) {
          const reader = originalStream.getReader();

          const processStream = async () => {
            try {
              while (true) {
                const { done, value } = await reader.read();

                if (done) {
                  controller.close();
                  break;
                }

                // Transform the event to include model instance
                const transformedEvent: import("./watch-types.ts").WatchEvent<
                  DynamicModel & T
                > = {
                  ...value,
                  value: value.value
                    ? new DynamicModel(value.value as any) as DynamicModel & T
                    : null,
                  previousValue: value.previousValue
                    ? new DynamicModel(value.previousValue as any) as
                      & DynamicModel
                      & T
                    : null,
                };

                controller.enqueue(transformedEvent);
              }
            } catch (error) {
              controller.error(error);
            } finally {
              reader.releaseLock();
            }
          };

          processStream();
        },
      });

      return {
        stream: modelStream,
        stop: result.stop,
        on: (
          callback: import("./watch-types.ts").WatchCallback<DynamicModel & T>,
        ) => result.on(callback as any),
        toSSE: result.toSSE,
        toWebSocket: result.toWebSocket,
      };
    }

    /**
     * Watch multiple documents by IDs for real-time changes
     */
    static async watchMany(
      ids: string[],
      options?: import("./watch-types.ts").WatchOptions,
    ): Promise<import("./watch-types.ts").WatchResult<DynamicModel & T>> {
      const { watchRecords } = await import("./watch.ts");
      const result = await watchRecords(this.entity, this.kv, ids, options);

      // Transform the stream to return model instances
      const originalStream = result.stream;
      const modelStream = new ReadableStream<
        import("./watch-types.ts").WatchEvent<DynamicModel & T>
      >({
        start(controller) {
          const reader = originalStream.getReader();

          const processStream = async () => {
            try {
              while (true) {
                const { done, value } = await reader.read();

                if (done) {
                  controller.close();
                  break;
                }

                // Transform the event to include model instance
                const transformedEvent: import("./watch-types.ts").WatchEvent<
                  DynamicModel & T
                > = {
                  ...value,
                  value: value.value
                    ? new DynamicModel(value.value as any) as DynamicModel & T
                    : null,
                  previousValue: value.previousValue
                    ? new DynamicModel(value.previousValue as any) as
                      & DynamicModel
                      & T
                    : null,
                };

                controller.enqueue(transformedEvent);
              }
            } catch (error) {
              controller.error(error);
            } finally {
              reader.releaseLock();
            }
          };

          processStream();
        },
      });

      return {
        stream: modelStream,
        stop: result.stop,
        on: (
          callback: import("./watch-types.ts").WatchCallback<DynamicModel & T>,
        ) => result.on(callback as any),
        toSSE: result.toSSE,
        toWebSocket: result.toWebSocket,
      };
    }

    /**
     * Watch documents matching a query for real-time changes
     */
    static async watchQuery(
      options?: import("./watch-types.ts").WatchManyOptions,
    ): Promise<import("./watch-types.ts").WatchResult<DynamicModel & T>> {
      const { watchQuery } = await import("./watch.ts");
      const result = await watchQuery(this.entity, this.kv, options);

      // Transform the stream to return model instances
      const originalStream = result.stream;
      const modelStream = new ReadableStream<
        import("./watch-types.ts").WatchEvent<DynamicModel & T>
      >({
        start(controller) {
          const reader = originalStream.getReader();

          const processStream = async () => {
            try {
              while (true) {
                const { done, value } = await reader.read();

                if (done) {
                  controller.close();
                  break;
                }

                // Transform the event to include model instance
                const transformedEvent: import("./watch-types.ts").WatchEvent<
                  DynamicModel & T
                > = {
                  ...value,
                  value: value.value
                    ? new DynamicModel(value.value as any) as DynamicModel & T
                    : null,
                  previousValue: value.previousValue
                    ? new DynamicModel(value.previousValue as any) as
                      & DynamicModel
                      & T
                    : null,
                };

                controller.enqueue(transformedEvent);
              }
            } catch (error) {
              controller.error(error);
            } finally {
              reader.releaseLock();
            }
          };

          processStream();
        },
      });

      return {
        stream: modelStream,
        stop: result.stop,
        on: (
          callback: import("./watch-types.ts").WatchCallback<DynamicModel & T>,
        ) => result.on(callback as any),
        toSSE: result.toSSE,
        toWebSocket: result.toWebSocket,
      };
    }

    /**
     * Watch related documents for this model
     */
    static async watchRelations(
      id: string,
      relationName: string,
      options?: Omit<
        import("./watch-types.ts").WatchRelationOptions,
        "relation"
      >,
    ): Promise<import("./watch-types.ts").WatchResult<DynamicModel & T>> {
      const { WatchManager } = await import("./watch.ts");
      const manager = new WatchManager(this.kv);

      const result = await manager.watchRelations(this.entity, id, {
        ...options,
        relation: relationName,
      });

      // Transform the stream to return model instances
      const originalStream = result.stream;
      const modelStream = new ReadableStream<
        import("./watch-types.ts").WatchEvent<DynamicModel & T>
      >({
        start(controller) {
          const reader = originalStream.getReader();

          const processStream = async () => {
            try {
              while (true) {
                const { done, value } = await reader.read();

                if (done) {
                  controller.close();
                  break;
                }

                // Transform the event to include model instance
                const transformedEvent: import("./watch-types.ts").WatchEvent<
                  DynamicModel & T
                > = {
                  ...value,
                  value: value.value
                    ? new DynamicModel(value.value as any) as DynamicModel & T
                    : null,
                  previousValue: value.previousValue
                    ? new DynamicModel(value.previousValue as any) as
                      & DynamicModel
                      & T
                    : null,
                };

                controller.enqueue(transformedEvent);
              }
            } catch (error) {
              controller.error(error);
            } finally {
              reader.releaseLock();
            }
          };

          processStream();
        },
      });

      return {
        stream: modelStream,
        stop: result.stop,
        on: (
          callback: import("./watch-types.ts").WatchCallback<DynamicModel & T>,
        ) => result.on(callback as any),
        toSSE: result.toSSE,
        toWebSocket: result.toWebSocket,
      };
    }
  }

  return DynamicModel as unknown as ModelConstructor<T>;
}
