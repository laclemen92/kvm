/**
 * @module
 *
 * KVM - A powerful ORM for Deno KV that provides both functional and model-based APIs.
 * Define entities and use them to perform CRUD operations with full type safety.
 *
 * ## Functional API (Legacy)
 * @example
 * ```ts
 * import { create, KVMEntity, ValueType } from "@laclemen92/kvm";
 * import { z } from "zod";
 *
 * const userSchema = z.object({
 *    id: z.string(),
 *    email: z.string().email(),
 *    age: z.number(),
 * }).strict();
 *
 * const userEntity: KVMEntity = {
 *    name: "users",
 *    primaryKey: [{ name: "users", key: "id" }],
 *    schema: userSchema,
 * };
 *
 * const kv = await Deno.openKv();
 * const user = await create(userEntity, kv, {
 *    id: "user1",
 *    email: "test@test.com",
 *    age: 31,
 * });
 * ```
 *
 * ## Model-Based API (Recommended)
 * @example
 * ```ts
 * import { createKVM } from "@laclemen92/kvm";
 * import { z } from "zod";
 *
 * const kvm = await createKVM();
 *
 * const User = kvm.model('users', {
 *   schema: z.object({
 *     id: z.string(),
 *     email: z.string().email(),
 *     age: z.number(),
 *   }),
 *   primaryKey: [{ name: "users", key: "id" }],
 * });
 *
 * // Create and work with documents
 * const user = await User.create({
 *   id: "user1",
 *   email: "test@test.com",
 *   age: 31,
 * });
 *
 * user.age = 32;
 * await user.save();
 *
 * const foundUser = await User.findById("user1");
 * await user.delete();
 *
 * // Query Builder for complex queries
 * const users = await User
 *   .where('age').gte(18)
 *   .where('status').equals('active')
 *   .orderBy('createdAt', 'desc')
 *   .limit(10)
 *   .find();
 *
 * // Enhanced Error Handling
 * try {
 *   await User.create(invalidData);
 * } catch (error) {
 *   if (KVMErrorUtils.isValidationError(error)) {
 *     console.log(`Validation failed: ${error.field} - ${error.rule}`);
 *   }
 * }
 * ```
 */

// Functional API (Legacy - maintained for backward compatibility)
export * from "./lib/create.ts";
export * from "./lib/delete.ts";
export * from "./lib/find.ts";
export * from "./lib/update.ts";
export * from "./lib/types.ts";

// Model-Based API (New - Recommended)
export { createKVM, KVM } from "./lib/kvm.ts";
export { BaseModel } from "./lib/model.ts";
export type {
  CreateOptions,
  DeleteOptions,
  FindOptions,
  InferModel,
  ModelConstructor,
  ModelDefinition,
  ModelDocument,
  ModelStatic,
  UpdateOptions,
} from "./lib/model-types.ts";

// Query Builder API
export type {
  ComparisonOperator,
  QueryBuilder,
  QueryBuilderFactory,
  QueryConfig,
  QueryExecutor,
  SortConfig,
  SortDirection,
  WhereClause,
  WhereCondition,
} from "./lib/query-types.ts";
export { KVMQueryBuilder } from "./lib/query-builder.ts";

// TTL Utilities
export {
  cacheTTL,
  sessionTTL,
  temporaryTTL,
  tokenTTL,
  TTL,
  TTLConfig,
  withTTL,
} from "./lib/ttl-utils.ts";

// Atomic Transactions
export type {
  AtomicBatchResult,
  AtomicCheckMutation,
  AtomicCreateMutation,
  AtomicDeleteMutation,
  AtomicMaxMutation,
  AtomicMinMutation,
  AtomicMutation,
  AtomicMutationBuilder,
  AtomicMutationType,
  AtomicSetMutation,
  AtomicSumMutation,
  AtomicTransactionOptions,
  AtomicTransactionResult,
  AtomicUpdateMutation,
} from "./lib/atomic-types.ts";
export { createAtomicBuilder, KVMAtomicBuilder } from "./lib/atomic-builder.ts";
export {
  AtomicUtils,
  createBulkTransaction,
  createConditionalTransaction,
  createCopyTransaction,
  createCounterTransaction,
  createSwapTransaction,
  createTransferTransaction,
  createUpsertTransaction,
  executeAtomicBatch,
  retryAtomicTransaction,
} from "./lib/atomic-utils.ts";

// Error Handling
export {
  KVMBatchOperationError,
  KVMBatchValidationError,
  KVMConcurrencyError,
  KVMConfigurationError,
  KVMConnectionError,
  KVMConstraintError,
  KVMError,
  KVMErrorUtils,
  KVMNotFoundError,
  KVMOperationError,
  KVMQueryError,
  KVMValidationError,
} from "./lib/errors.ts";

// Batch Operations
export type {
  BatchCreateOptions,
  BatchCreateResult,
  BatchDeleteInput,
  BatchDeleteOptions,
  BatchDeleteResult,
  BatchUpdateInput,
  BatchUpdateOptions,
  BatchUpdateResult,
  BatchValidationResult,
  ValidationResult,
} from "./lib/batch-types.ts";

// Middleware/Hooks
export type {
  AuditPluginOptions,
  HookContext,
  HookExecutionResult,
  HookFunction,
  HookManager,
  HookOptions,
  HookTiming,
  HookType,
  Plugin,
  PostHookFunction,
  PreHookFunction,
  RegisteredHook,
  TimestampPluginOptions,
  ValidationPluginOptions,
} from "./lib/middleware-types.ts";
export {
  auditPlugin,
  KVMHookManager,
  timestampsPlugin,
  validationPlugin,
} from "./lib/middleware.ts";
export {
  HookExecutionError,
  HookTimeoutError,
} from "./lib/middleware-types.ts";

// Re-export Zod types for convenience
export type { ZodObject, ZodRawShape } from "zod";
