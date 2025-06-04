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
import type {
  DateRangeOptions,
  ListOptions,
  ListResult,
  PaginatedResult,
  PaginationOptions,
} from "./list-operations.ts";

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
 * TTL (Time To Live) value - can be milliseconds or human-readable string
 * Examples: 300000, "5m", "1h", "30s", "2d"
 */
export type TTLValue = number | string;

/**
 * Options for model operations
 */
export interface CreateOptions {
  /**
   * Time to live in milliseconds or human-readable format
   * Examples: 300000, "5m", "1h", "30s", "2d"
   */
  expireIn?: TTLValue;
}

export interface UpdateOptions {
  /**
   * Time to live in milliseconds or human-readable format
   * Examples: 300000, "5m", "1h", "30s", "2d"
   */
  expireIn?: TTLValue;
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
  watch(
    options?: import("./watch-types.ts").WatchOptions,
  ): Promise<import("./watch-types.ts").WatchResult<this>>;

  // Atomic counter methods
  incrementField(
    field: string,
    amount?: number | bigint,
  ): Promise<import("./atomic-types.ts").AtomicTransactionResult>;
  incrementFields(
    fields: Record<string, number | bigint>,
  ): Promise<import("./atomic-types.ts").AtomicTransactionResult>;
  getCounters(): Promise<Record<string, bigint>>;
  createFieldCounter(field: string): import("./atomic-utils.ts").AtomicCounter;
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

  // Watch methods
  watch(
    id: string,
    options?: import("./watch-types.ts").WatchOptions,
  ): Promise<import("./watch-types.ts").WatchResult<ModelDocument<T> & T>>;
  watchMany(
    ids: string[],
    options?: import("./watch-types.ts").WatchOptions,
  ): Promise<import("./watch-types.ts").WatchResult<ModelDocument<T> & T>>;
  watchQuery(
    options?: import("./watch-types.ts").WatchManyOptions,
  ): Promise<import("./watch-types.ts").WatchResult<ModelDocument<T> & T>>;
  watchRelations(
    id: string,
    relation: string,
    options?: import("./watch-types.ts").WatchRelationOptions,
  ): Promise<import("./watch-types.ts").WatchResult<ModelDocument<T> & T>>;

  // Atomic utilities methods
  atomicUtils(): import("./atomic-utils.ts").ModelAtomicUtils;
  incrementField(
    recordKey: string | Record<string, any>,
    field: string,
    amount?: number | bigint,
  ): Promise<import("./atomic-types.ts").AtomicTransactionResult>;
  incrementFields(
    recordKey: string | Record<string, any>,
    fields: Record<string, number | bigint>,
  ): Promise<import("./atomic-types.ts").AtomicTransactionResult>;
  getCounters(
    recordKey: string | Record<string, any>,
  ): Promise<Record<string, bigint>>;
  createFieldCounter(
    recordKey: string | Record<string, any>,
    field: string,
  ): import("./atomic-utils.ts").AtomicCounter;
  createCounter(key: Deno.KvKey): import("./atomic-utils.ts").AtomicCounter;

  // Advanced list operations
  list(options?: ListOptions): Promise<ModelListResult<ModelDocument<T> & T>>;
  listRange(
    startKey: Deno.KvKey,
    endKey: Deno.KvKey,
    options?: Omit<ListOptions, "start" | "end">,
  ): Promise<ModelListResult<ModelDocument<T> & T>>;
  listByPrefix(
    prefix: Deno.KvKey,
    options?: Omit<ListOptions, "prefix">,
  ): Promise<ModelListResult<ModelDocument<T> & T>>;
  listByDateRange(
    options: DateRangeOptions,
  ): Promise<ModelListResult<ModelDocument<T> & T>>;
  listStream(
    options?: ListOptions,
  ): AsyncGenerator<ModelDocument<T> & T, void, unknown>;
  count(options?: Omit<ListOptions, "limit" | "cursor">): Promise<number>;
  paginate(
    options?: PaginationOptions,
  ): Promise<ModelPaginatedResult<ModelDocument<T> & T>>;
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

/**
 * Model-specific list result that contains model instances instead of raw KV entries
 */
export interface ModelListResult<T> {
  /** Array of model instances */
  data: T[];
  /** Cursor for next page (if available) */
  nextCursor?: string;
  /** Whether there are more results */
  hasMore: boolean;
  /** Total count of results in this batch */
  count: number;
}

/**
 * Model-specific paginated result that contains model instances
 */
export interface ModelPaginatedResult<T> {
  /** Current page data */
  data: T[];
  /** Pagination metadata */
  pagination: {
    page: number;
    pageSize: number;
    hasNextPage: boolean;
    hasPreviousPage: boolean;
    nextCursor?: string;
    totalInBatch: number;
  };
}
