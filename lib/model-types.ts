import type { ZodObject, ZodRawShape } from "zod";
import { z } from "zod";
import type {
  FindManyOptions,
  IncludePath,
  KVMEntity,
  PopulateOptions,
} from "./types.ts";
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
  HookManager,
  HookOptions,
  HookType,
  Plugin,
  PostHookFunction,
  PreHookFunction,
} from "./middleware-types.ts";

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
  include?: IncludePath[];
}

/**
 * Model document with instance methods
 */
export interface ModelDocument<T = any> {
  save(options?: UpdateOptions): Promise<this>;
  delete(options?: DeleteOptions): Promise<void>;
  update(data: Partial<T>, options?: UpdateOptions): Promise<this>;
  reload(): Promise<this>;
  populate(path: string | PopulateOptions): Promise<this>;
  populate(paths: (string | PopulateOptions)[]): Promise<this>;
}

/**
 * Static model methods
 */
export interface ModelStatic<T = any> {
  create(data: T, options?: CreateOptions): Promise<ModelDocument<T> & T>;
  findById(
    id: string,
    options?: FindOptions,
  ): Promise<(ModelDocument<T> & T) | null>;
  findByIdOrThrow(
    id: string,
    options?: FindOptions,
  ): Promise<ModelDocument<T> & T>;
  findUnique(
    key: string | Deno.KvKeyPart | Record<string, any>,
    secondaryIndexName?: string,
    includeValue?: boolean,
  ): Promise<(ModelDocument<T> & T) | null>;
  findUniqueOrThrow(
    key: string | Deno.KvKeyPart | Record<string, any>,
    secondaryIndexName?: string,
    includeValue?: boolean,
  ): Promise<ModelDocument<T> & T>;
  findMany(options?: FindManyOptions): Promise<(ModelDocument<T> & T)[]>;
  findFirst(options?: FindManyOptions): Promise<(ModelDocument<T> & T) | null>;
  findFirstOrThrow(options?: FindManyOptions): Promise<ModelDocument<T> & T>;
  // Query Builder methods
  where(field: keyof T): WhereClause<T>;
  where(field: string): WhereClause<T>;
  where(conditions: Partial<T>): QueryBuilder<T>;
  query(): QueryBuilder<T>;

  // Batch operations
  createMany(
    data: T[],
    options?: BatchCreateOptions,
  ): Promise<BatchCreateResult<ModelDocument<T> & T>>;
  updateMany(
    updates: BatchUpdateInput<T>[],
    options?: BatchUpdateOptions,
  ): Promise<BatchUpdateResult<ModelDocument<T> & T>>;
  deleteMany(
    keys: BatchDeleteInput[],
    options?: BatchDeleteOptions,
  ): Promise<BatchDeleteResult<ModelDocument<T> & T>>;

  // Middleware/Hooks methods
  pre(type: HookType, fn: PreHookFunction<T>, options?: HookOptions): void;
  post(type: HookType, fn: PostHookFunction<T>, options?: HookOptions): void;
  use(plugin: Plugin<T>, options?: Record<string, any>): void;
  unuse(plugin: Plugin<T>): void;
  removeHook(id: string): boolean;
  removeHooks(type: HookType, timing?: "pre" | "post"): number;
  clearHooks(): void;
  getHooks(type?: HookType, timing?: "pre" | "post"): any[];
  setHooksEnabled(enabled: boolean): void;
  areHooksEnabled(): boolean;
}

/**
 * Model constructor type
 */
export interface ModelConstructor<T = any> extends ModelStatic<T> {
  new (data: T): ModelDocument<T> & T;
  entity: KVMEntity;
  kv: Deno.Kv;
  modelName: string;
  hooks: HookManager<T>;
}

/**
 * Type to infer the TypeScript type from a Zod schema
 */
export type InferModel<TSchema extends ZodObject<any>> = z.infer<TSchema>;
