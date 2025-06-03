/**
 * Type definitions for atomic mutations in KVM
 */

import type { KVMEntity } from "./types.ts";

/**
 * Atomic mutation operation types
 */
export enum AtomicMutationType {
  CREATE = "create",
  UPDATE = "update",
  DELETE = "delete",
  SET = "set",
  CHECK = "check",
  SUM = "sum",
  MIN = "min",
  MAX = "max",
}

/**
 * Atomic check condition
 */
export interface AtomicCheck {
  key: Deno.KvKey;
  versionstamp: string | null;
}

/**
 * Atomic set operation
 */
export interface AtomicSet<T = unknown> {
  key: Deno.KvKey;
  value: T;
  options?: {
    expireIn?: number;
  };
}

/**
 * Atomic delete operation
 */
export interface AtomicDelete {
  key: Deno.KvKey;
}

/**
 * Atomic sum operation for numeric values
 */
export interface AtomicSum {
  key: Deno.KvKey;
  value: bigint;
}

/**
 * Atomic min operation for numeric values
 */
export interface AtomicMin {
  key: Deno.KvKey;
  value: bigint;
}

/**
 * Atomic max operation for numeric values
 */
export interface AtomicMax {
  key: Deno.KvKey;
  value: bigint;
}

/**
 * Base atomic mutation operation
 */
export interface BaseAtomicMutation {
  type: AtomicMutationType;
  entity?: KVMEntity;
  modelName?: string;
}

/**
 * Atomic create mutation
 */
export interface AtomicCreateMutation<T = unknown> extends BaseAtomicMutation {
  type: AtomicMutationType.CREATE;
  entity: KVMEntity;
  data: T;
  options?: {
    expireIn?: number;
  };
}

/**
 * Atomic update mutation
 */
export interface AtomicUpdateMutation<T = unknown> extends BaseAtomicMutation {
  type: AtomicMutationType.UPDATE;
  entity: KVMEntity;
  key: Record<string, Deno.KvKeyPart>;
  data: Partial<T>;
  options?: {
    expireIn?: number;
    merge?: boolean;
  };
}

/**
 * Atomic delete mutation
 */
export interface AtomicDeleteMutation extends BaseAtomicMutation {
  type: AtomicMutationType.DELETE;
  entity: KVMEntity;
  key: Record<string, Deno.KvKeyPart>;
  options?: {
    cascadeDelete?: boolean;
  };
}

/**
 * Atomic raw set mutation (for custom operations)
 */
export interface AtomicSetMutation<T = unknown> extends BaseAtomicMutation {
  type: AtomicMutationType.SET;
  key: Deno.KvKey;
  value: T;
  options?: {
    expireIn?: number;
  };
}

/**
 * Atomic check mutation
 */
export interface AtomicCheckMutation extends BaseAtomicMutation {
  type: AtomicMutationType.CHECK;
  key: Deno.KvKey;
  versionstamp: string | null;
}

/**
 * Atomic numeric mutations
 */
export interface AtomicSumMutation extends BaseAtomicMutation {
  type: AtomicMutationType.SUM;
  key: Deno.KvKey;
  value: bigint;
}

export interface AtomicMinMutation extends BaseAtomicMutation {
  type: AtomicMutationType.MIN;
  key: Deno.KvKey;
  value: bigint;
}

export interface AtomicMaxMutation extends BaseAtomicMutation {
  type: AtomicMutationType.MAX;
  key: Deno.KvKey;
  value: bigint;
}

/**
 * Union type of all atomic mutations
 */
export type AtomicMutation =
  | AtomicCreateMutation
  | AtomicUpdateMutation
  | AtomicDeleteMutation
  | AtomicSetMutation
  | AtomicCheckMutation
  | AtomicSumMutation
  | AtomicMinMutation
  | AtomicMaxMutation;

/**
 * Result of an atomic transaction
 */
export interface AtomicTransactionResult {
  ok: boolean;
  versionstamp?: string;
  mutations: AtomicMutation[];
  failedMutation?: {
    index: number;
    mutation: AtomicMutation;
    error: Error;
  };
}

/**
 * Atomic transaction options
 */
export interface AtomicTransactionOptions {
  /**
   * Maximum number of mutations per transaction (Deno KV limit is 1000)
   */
  maxMutations?: number;

  /**
   * Whether to validate data before executing mutations
   */
  validate?: boolean;

  /**
   * Timeout for the transaction in milliseconds
   */
  timeout?: number;

  /**
   * Whether to retry failed transactions
   */
  retry?: boolean;

  /**
   * Maximum number of retries
   */
  maxRetries?: number;

  /**
   * Delay between retries in milliseconds
   */
  retryDelay?: number;
}

/**
 * Atomic batch operation result
 */
export interface AtomicBatchResult<T = unknown> {
  successful: T[];
  failed: Array<{
    mutation: AtomicMutation;
    error: Error;
    index: number;
  }>;
  stats: {
    total: number;
    successful: number;
    failed: number;
  };
}

/**
 * Context passed to atomic mutation hooks
 */
export interface AtomicMutationContext {
  kv: Deno.Kv;
  mutations: AtomicMutation[];
  options: AtomicTransactionOptions;
  startTime: number;
}

/**
 * Hook function type for atomic mutations
 */
export type AtomicMutationHook = (
  context: AtomicMutationContext,
) => Promise<void> | void;

/**
 * Atomic mutation builder interface
 */
export interface AtomicMutationBuilder {
  /**
   * Add a create mutation
   */
  create<T>(entity: KVMEntity, data: T, options?: { expireIn?: number }): this;

  /**
   * Add an update mutation
   */
  update<T>(
    entity: KVMEntity,
    key: Record<string, Deno.KvKeyPart>,
    data: Partial<T>,
    options?: { expireIn?: number; merge?: boolean },
  ): this;

  /**
   * Add a delete mutation
   */
  delete(
    entity: KVMEntity,
    key: Record<string, Deno.KvKeyPart>,
    options?: { cascadeDelete?: boolean },
  ): this;

  /**
   * Add a raw set mutation
   */
  set<T>(key: Deno.KvKey, value: T, options?: { expireIn?: number }): this;

  /**
   * Add a check mutation
   */
  check(key: Deno.KvKey, versionstamp: string | null): this;

  /**
   * Add a sum mutation
   */
  sum(key: Deno.KvKey, value: bigint): this;

  /**
   * Add a min mutation
   */
  min(key: Deno.KvKey, value: bigint): this;

  /**
   * Add a max mutation
   */
  max(key: Deno.KvKey, value: bigint): this;

  /**
   * Execute all mutations atomically
   */
  commit(options?: AtomicTransactionOptions): Promise<AtomicTransactionResult>;

  /**
   * Get all mutations without executing
   */
  getMutations(): AtomicMutation[];

  /**
   * Clear all mutations
   */
  clear(): this;

  /**
   * Get the number of mutations
   */
  size(): number;
}
