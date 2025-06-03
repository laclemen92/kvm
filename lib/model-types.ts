import type { ZodObject, ZodRawShape } from "zod";
import type { KVMEntity, FindManyOptions } from "./types.ts";
import type { QueryBuilder, WhereClause } from "./query-types.ts";

/**
 * Model definition structure for creating new models
 */
export interface ModelDefinition<T extends ZodRawShape = ZodRawShape> {
  schema: ZodObject<T>;
  primaryKey: KVMEntity["primaryKey"];
  secondaryIndexes?: KVMEntity["secondaryIndexes"];
  relations?: KVMEntity["relations"];
}

/**
 * Options for model operations
 */
export interface CreateOptions {
  expireIn?: number;
}

export interface UpdateOptions {
  expireIn?: number;
}

export interface DeleteOptions {
  cascadeDelete?: boolean;
}

export interface FindOptions {
  include?: string[];
}

/**
 * Model document with instance methods
 */
export interface ModelDocument<T = any> {
  save(): Promise<this>;
  delete(options?: DeleteOptions): Promise<void>;
  update(data: Partial<T>, options?: UpdateOptions): Promise<this>;
  reload(): Promise<this>;
}

/**
 * Static model methods
 */
export interface ModelStatic<T = any> {
  create(data: T, options?: CreateOptions): Promise<ModelDocument<T> & T>;
  findById(id: string, options?: FindOptions): Promise<(ModelDocument<T> & T) | null>;
  findByIdOrThrow(id: string, options?: FindOptions): Promise<ModelDocument<T> & T>;
  findUnique(
    key: string | Deno.KvKeyPart | Record<string, any>,
    secondaryIndexName?: string,
    includeValue?: boolean
  ): Promise<(ModelDocument<T> & T) | null>;
  findUniqueOrThrow(
    key: string | Deno.KvKeyPart | Record<string, any>,
    secondaryIndexName?: string,
    includeValue?: boolean
  ): Promise<ModelDocument<T> & T>;
  findMany(options?: FindManyOptions): Promise<(ModelDocument<T> & T)[]>;
  findFirst(options?: FindManyOptions): Promise<(ModelDocument<T> & T) | null>;
  findFirstOrThrow(options?: FindManyOptions): Promise<ModelDocument<T> & T>;
  updateMany(
    updates: Array<{
      key: string | Deno.KvKeyPart;
      data: Partial<T>;
      options?: UpdateOptions;
    }>
  ): Promise<(ModelDocument<T> & T)[]>;
  deleteMany(
    keys: Array<{
      key: string | Deno.KvKeyPart;
      options?: DeleteOptions;
    }>
  ): Promise<(ModelDocument<T> & T)[]>;
  
  // Query Builder methods
  where(field: keyof T): WhereClause<T>;
  where(field: string): WhereClause<T>;
  where(conditions: Partial<T>): QueryBuilder<T>;
  query(): QueryBuilder<T>;
}

/**
 * Model constructor type
 */
export interface ModelConstructor<T = any> extends ModelStatic<T> {
  new(data: T): ModelDocument<T> & T;
  entity: KVMEntity;
  kv: Deno.Kv;
  modelName: string;
}

/**
 * Type to infer the TypeScript type from a Zod schema
 */
export type InferModel<TSchema extends ZodObject<any>> = 
  TSchema extends ZodObject<infer T> ? T : never;