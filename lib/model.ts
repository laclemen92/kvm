import type {
  ModelDocument,
  ModelStatic,
  ModelConstructor,
  CreateOptions,
  UpdateOptions,
  DeleteOptions,
  FindOptions,
} from "./model-types.ts";
import type { KVMEntity, FindManyOptions } from "./types.ts";
import type { QueryBuilder, WhereClause } from "./query-types.ts";
import { create } from "./create.ts";
import { findUnique, findUniqueOrThrow, findMany, findFirst, findFirstOrThrow } from "./find.ts";
import { update, updateMany } from "./update.ts";
import { deleteKey, deleteMany } from "./delete.ts";
import { KVMQueryBuilder } from "./query-builder.ts";
import { 
  KVMNotFoundError, 
  KVMOperationError, 
  KVMValidationError,
  KVMErrorUtils 
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
    
    try {
      const result = await update<T>(
        ModelClass.entity,
        ModelClass.kv,
        primaryKeyValue,
        this as any
      );
      
      if (result?.value) {
        Object.assign(this, result.value);
      }
      
      return this;
    } catch (error) {
      if (error.name === 'ZodError') {
        throw KVMErrorUtils.fromZodError(error, ModelClass.modelName);
      }
      throw KVMErrorUtils.wrap(error as Error, 'update', ModelClass.modelName);
    }
  }

  /**
   * Delete this document
   */
  async delete(options?: DeleteOptions): Promise<void> {
    const ModelClass = this.constructor as ModelConstructor<T>;
    const primaryKeyValue = this._getPrimaryKeyValue();
    
    try {
      await deleteKey<T>(
        ModelClass.entity,
        ModelClass.kv,
        primaryKeyValue,
        options ? { cascadeDelete: options.cascadeDelete ?? false } : undefined
      );
    } catch (error) {
      throw KVMErrorUtils.wrap(error as Error, 'delete', ModelClass.modelName);
    }
  }

  /**
   * Update this document with new data
   */
  async update(data: Partial<T>, options?: UpdateOptions): Promise<this> {
    try {
      Object.assign(this, data);
      return await this.save();
    } catch (error) {
      if (KVMErrorUtils.isKVMError(error)) {
        throw error;
      }
      const ModelClass = this.constructor as ModelConstructor<T>;
      throw KVMErrorUtils.wrap(error as Error, 'update', ModelClass.modelName);
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
        primaryKeyValue
      );
      
      if (result?.value) {
        Object.assign(this, result.value);
      } else {
        throw new KVMNotFoundError(
          ModelClass.modelName,
          primaryKeyValue,
          'id'
        );
      }
      
      return this;
    } catch (error) {
      if (KVMErrorUtils.isKVMError(error)) {
        throw error;
      }
      throw KVMErrorUtils.wrap(error as Error, 'read', ModelClass.modelName);
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
  kv: Deno.Kv
): ModelConstructor<T> {
  
  class DynamicModel extends BaseModel<T> {
    static entity = entity;
    static kv = kv;
    static modelName = modelName;

    /**
     * Create a new document
     */
    static async create(data: T, options?: CreateOptions): Promise<DynamicModel & T> {
      try {
        const result = await create<T>(this.entity, this.kv, data, options);
        
        if (!result?.value) {
          throw new KVMOperationError('create', 'Failed to create document', modelName);
        }
        
        return new this(result.value) as DynamicModel & T;
      } catch (error) {
        if (KVMErrorUtils.isKVMError(error)) {
          throw error;
        }
        if (error.name === 'ZodError') {
          throw KVMErrorUtils.fromZodError(error, modelName);
        }
        throw KVMErrorUtils.wrap(error as Error, 'create', modelName);
      }
    }

    /**
     * Find document by primary key
     */
    static async findById(
      id: string,
      options?: FindOptions
    ): Promise<(DynamicModel & T) | null> {
      try {
        const result = await findUnique<T>(this.entity, this.kv, id);
        
        if (!result?.value) {
          return null;
        }
        
        return new this(result.value) as DynamicModel & T;
      } catch (error) {
        if (KVMErrorUtils.isKVMError(error)) {
          throw error;
        }
        throw KVMErrorUtils.wrap(error as Error, 'read', modelName);
      }
    }

    /**
     * Find document by primary key or throw error
     */
    static async findByIdOrThrow(
      id: string,
      options?: FindOptions
    ): Promise<DynamicModel & T> {
      const result = await this.findById(id, options);
      
      if (!result) {
        throw new KVMNotFoundError(modelName, id, 'id');
      }
      
      return result;
    }

    /**
     * Find unique document by key or secondary index
     */
    static async findUnique(
      key: string | Deno.KvKeyPart | Record<string, any>,
      secondaryIndexName?: string,
      includeValue?: boolean
    ): Promise<(DynamicModel & T) | null> {
      try {
        const result = await findUnique<T>(
          this.entity,
          this.kv,
          key as any,
          secondaryIndexName,
          includeValue
        );
        
        if (!result?.value) {
          return null;
        }
        
        return new this(result.value) as DynamicModel & T;
      } catch (error) {
        if (KVMErrorUtils.isKVMError(error)) {
          throw error;
        }
        throw KVMErrorUtils.wrap(error as Error, 'read', modelName);
      }
    }

    /**
     * Find unique document or throw error
     */
    static async findUniqueOrThrow(
      key: string | Deno.KvKeyPart | Record<string, any>,
      secondaryIndexName?: string,
      includeValue?: boolean
    ): Promise<DynamicModel & T> {
      const result = await this.findUnique(key, secondaryIndexName, includeValue);
      
      if (!result) {
        throw new KVMNotFoundError(
          modelName,
          key,
          secondaryIndexName ? 'unique' : 'id'
        );
      }
      
      return result;
    }

    /**
     * Find many documents
     */
    static async findMany(
      options?: FindManyOptions
    ): Promise<(DynamicModel & T)[]> {
      try {
        const results = await findMany<T>(this.entity, this.kv, options);
        
        return results.map(result => new this(result.value) as DynamicModel & T);
      } catch (error) {
        if (KVMErrorUtils.isKVMError(error)) {
          throw error;
        }
        throw KVMErrorUtils.wrap(error as Error, 'read', modelName);
      }
    }

    /**
     * Find first document
     */
    static async findFirst(
      options?: FindManyOptions
    ): Promise<(DynamicModel & T) | null> {
      try {
        const result = await findFirst<T>(this.entity, this.kv, options);
        
        if (!result?.value) {
          return null;
        }
        
        return new this(result.value) as DynamicModel & T;
      } catch (error) {
        if (KVMErrorUtils.isKVMError(error)) {
          throw error;
        }
        throw KVMErrorUtils.wrap(error as Error, 'read', modelName);
      }
    }

    /**
     * Find first document or throw error
     */
    static async findFirstOrThrow(
      options?: FindManyOptions
    ): Promise<DynamicModel & T> {
      const result = await this.findFirst(options);
      
      if (!result) {
        throw new KVMNotFoundError(modelName, {}, 'first');
      }
      
      return result;
    }

    /**
     * Update many documents
     */
    static async updateMany(
      updates: Array<{
        key: string | Deno.KvKeyPart;
        data: Partial<T>;
        options?: UpdateOptions;
      }>
    ): Promise<(DynamicModel & T)[]> {
      const formattedUpdates = updates.map(update => ({
        id: update.key,
        value: update.data,
        options: update.options,
      }));
      
      const results = await updateMany<T>(this.entity, this.kv, formattedUpdates);
      
      return results
        .filter(result => result?.value)
        .map(result => new this(result!.value!) as DynamicModel & T);
    }

    /**
     * Delete many documents
     */
    static async deleteMany(
      keys: Array<{
        key: string | Deno.KvKeyPart;
        options?: DeleteOptions;
      }>
    ): Promise<(DynamicModel & T)[]> {
      const formattedKeys = keys.map(item => ({
        key: item.key,
        options: item.options ? { cascadeDelete: item.options.cascadeDelete ?? false } : undefined,
      }));
      
      const results = await deleteMany<T>(this.entity, this.kv, formattedKeys);
      
      return results
        .filter(result => result?.value)
        .map(result => new this(result!.value!) as DynamicModel & T);
    }

    /**
     * Start a query builder for field-specific conditions
     */
    static where(field: keyof T): WhereClause<T>;
    static where(field: string): WhereClause<T>;
    static where(conditions: Partial<T>): QueryBuilder<T>;
    static where(fieldOrConditions: keyof T | string | Partial<T>): WhereClause<T> | QueryBuilder<T> {
      const queryBuilder = new KVMQueryBuilder<T>(this.entity, this.kv, this as any);
      return queryBuilder.where(fieldOrConditions as any);
    }

    /**
     * Create a query builder for this model
     */
    static query(): QueryBuilder<T> {
      return new KVMQueryBuilder<T>(this.entity, this.kv, this as any);
    }
  }

  return DynamicModel as unknown as ModelConstructor<T>;
}