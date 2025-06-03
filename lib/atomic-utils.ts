/**
 * Atomic transaction utilities and helpers for KVM
 */

import type { KVMEntity } from "./types.ts";
import type {
  AtomicBatchResult,
  AtomicMutation,
  AtomicMutationBuilder,
  AtomicTransactionOptions,
  AtomicTransactionResult,
} from "./atomic-types.ts";
import { createAtomicBuilder } from "./atomic-builder.ts";
import { KVMOperationError } from "./errors.ts";

/**
 * Execute multiple atomic transactions in parallel
 */
export async function executeAtomicBatch(
  kv: Deno.Kv,
  mutations: AtomicMutation[][],
  options: AtomicTransactionOptions = {},
): Promise<AtomicBatchResult> {
  const results: AtomicBatchResult = {
    successful: [],
    failed: [],
    stats: {
      total: mutations.length,
      successful: 0,
      failed: 0,
    },
  };

  // Execute transactions in parallel
  const promises = mutations.map(async (mutationGroup, index) => {
    try {
      const builder = createAtomicBuilder(kv);

      // Add all mutations to builder
      for (const mutation of mutationGroup) {
        switch (mutation.type) {
          case "create":
            builder.create(mutation.entity!, mutation.data, mutation.options);
            break;
          case "update":
            builder.update(
              mutation.entity!,
              mutation.key,
              mutation.data,
              mutation.options,
            );
            break;
          case "delete":
            builder.delete(mutation.entity!, mutation.key, mutation.options);
            break;
          case "set":
            builder.set(mutation.key, mutation.value, mutation.options);
            break;
          case "check":
            builder.check(mutation.key, mutation.versionstamp);
            break;
          case "sum":
            builder.sum(mutation.key, mutation.value);
            break;
          case "min":
            builder.min(mutation.key, mutation.value);
            break;
          case "max":
            builder.max(mutation.key, mutation.value);
            break;
        }
      }

      const result = await builder.commit(options);

      if (result.ok) {
        results.successful.push(result);
        results.stats.successful++;
      } else {
        results.failed.push({
          mutation: mutationGroup[0], // Representative mutation
          error: result.failedMutation?.error ||
            new Error("Unknown transaction error"),
          index,
        });
        results.stats.failed++;
      }
    } catch (error) {
      results.failed.push({
        mutation: mutationGroup[0], // Representative mutation
        error: error as Error,
        index,
      });
      results.stats.failed++;
    }
  });

  await Promise.allSettled(promises);
  return results;
}

/**
 * Create an atomic transaction that transfers data between entities
 */
export function createTransferTransaction(
  kv: Deno.Kv,
  fromEntity: KVMEntity,
  fromKey: Record<string, Deno.KvKeyPart>,
  toEntity: KVMEntity,
  toData: any,
  options?: {
    expireIn?: number;
    cascadeDelete?: boolean;
  },
): AtomicMutationBuilder {
  return createAtomicBuilder(kv)
    .delete(fromEntity, fromKey, { cascadeDelete: options?.cascadeDelete })
    .create(toEntity, toData, { expireIn: options?.expireIn });
}

/**
 * Create an atomic transaction for bulk operations
 */
export function createBulkTransaction(
  kv: Deno.Kv,
  operations: Array<{
    type: "create" | "update" | "delete";
    entity: KVMEntity;
    data?: any;
    key?: Record<string, Deno.KvKeyPart>;
    options?: any;
  }>,
): AtomicMutationBuilder {
  const builder = createAtomicBuilder(kv);

  for (const op of operations) {
    switch (op.type) {
      case "create":
        builder.create(op.entity, op.data, op.options);
        break;
      case "update":
        builder.update(op.entity, op.key!, op.data, op.options);
        break;
      case "delete":
        builder.delete(op.entity, op.key!, op.options);
        break;
    }
  }

  return builder;
}

/**
 * Create an atomic counter transaction
 */
export function createCounterTransaction(
  kv: Deno.Kv,
  operations: Array<{
    type: "increment" | "decrement" | "set";
    key: Deno.KvKey;
    value: bigint;
  }>,
): AtomicMutationBuilder {
  const builder = createAtomicBuilder(kv);

  for (const op of operations) {
    switch (op.type) {
      case "increment":
        builder.sum(op.key, op.value);
        break;
      case "decrement":
        builder.sum(op.key, -op.value);
        break;
      case "set":
        builder.set(op.key, op.value);
        break;
    }
  }

  return builder;
}

/**
 * Create an atomic transaction with conditional checks
 */
export function createConditionalTransaction(
  kv: Deno.Kv,
  checks: Array<{
    key: Deno.KvKey;
    versionstamp: string | null;
  }>,
  mutations: Array<{
    type: "set" | "delete";
    key: Deno.KvKey;
    value?: any;
    options?: { expireIn?: number };
  }>,
): AtomicMutationBuilder {
  const builder = createAtomicBuilder(kv);

  // Add all checks first
  for (const check of checks) {
    builder.check(check.key, check.versionstamp);
  }

  // Add mutations
  for (const mutation of mutations) {
    if (mutation.type === "set") {
      builder.set(mutation.key, mutation.value, mutation.options);
    } else {
      builder.set(mutation.key, null); // Delete by setting to null
    }
  }

  return builder;
}

/**
 * Retry an atomic transaction with exponential backoff
 */
export async function retryAtomicTransaction(
  transactionFn: () => Promise<AtomicTransactionResult>,
  options: {
    maxRetries?: number;
    baseDelay?: number;
    maxDelay?: number;
    backoffMultiplier?: number;
  } = {},
): Promise<AtomicTransactionResult> {
  const {
    maxRetries = 3,
    baseDelay = 100,
    maxDelay = 5000,
    backoffMultiplier = 2,
  } = options;

  let lastResult: AtomicTransactionResult | null = null;
  let delay = baseDelay;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const result = await transactionFn();

      if (result.ok) {
        return result;
      }

      lastResult = result;

      if (attempt < maxRetries) {
        await new Promise((resolve) => setTimeout(resolve, delay));
        delay = Math.min(delay * backoffMultiplier, maxDelay);
      }
    } catch (error) {
      if (attempt === maxRetries) {
        throw error;
      }

      await new Promise((resolve) => setTimeout(resolve, delay));
      delay = Math.min(delay * backoffMultiplier, maxDelay);
    }
  }

  return lastResult || {
    ok: false,
    mutations: [],
    failedMutation: {
      index: -1,
      mutation: {} as AtomicMutation,
      error: new KVMOperationError("atomic","All retry attempts failed"),
    },
  };
}

/**
 * Create an atomic transaction for copying/cloning records
 */
export function createCopyTransaction(
  kv: Deno.Kv,
  sourceEntity: KVMEntity,
  sourceKey: Record<string, Deno.KvKeyPart>,
  targetEntity: KVMEntity,
  targetData: any,
  options?: {
    expireIn?: number;
    preserveOriginal?: boolean;
  },
): AtomicMutationBuilder {
  const builder = createAtomicBuilder(kv);

  // Create the copy
  builder.create(targetEntity, targetData, { expireIn: options?.expireIn });

  // Optionally delete the original
  if (!options?.preserveOriginal) {
    builder.delete(sourceEntity, sourceKey);
  }

  return builder;
}

/**
 * Create an atomic swap transaction (exchange data between two records)
 */
export async function createSwapTransaction(
  kv: Deno.Kv,
  entity1: KVMEntity,
  key1: Record<string, Deno.KvKeyPart>,
  entity2: KVMEntity,
  key2: Record<string, Deno.KvKeyPart>,
  options?: {
    expireIn?: number;
  },
): Promise<AtomicMutationBuilder> {
  // We need to fetch the existing data first
  const [record1, record2] = await Promise.all([
    kv.get(["temp", "swap", ...Object.values(key1)]),
    kv.get(["temp", "swap", ...Object.values(key2)]),
  ]);

  if (!record1.value || !record2.value) {
    throw new KVMOperationError("atomic","Both records must exist for swap operation");
  }

  return createAtomicBuilder(kv)
    .update(entity1, key1, record2.value, { expireIn: options?.expireIn })
    .update(entity2, key2, record1.value, { expireIn: options?.expireIn });
}

/**
 * Create an atomic upsert transaction (update if exists, create if not)
 */
export function createUpsertTransaction(
  kv: Deno.Kv,
  entity: KVMEntity,
  data: any,
  options?: {
    expireIn?: number;
    merge?: boolean;
  },
): AtomicMutationBuilder {
  const builder = createAtomicBuilder(kv);

  // For upsert, we'll use a set operation directly
  // This bypasses the existence checks that create/update do
  const pk = data; // Simplified - in real implementation, build the primary key

  return builder.set(pk, data, { expireIn: options?.expireIn });
}

/**
 * Transaction composition utilities
 */
export const AtomicUtils = {
  /**
   * Compose multiple builders into one
   */
  compose(builders: AtomicMutationBuilder[]): AtomicMutationBuilder {
    if (builders.length === 0) {
      throw new KVMOperationError("atomic","Cannot compose empty array of builders");
    }

    const primaryBuilder = builders[0];

    for (let i = 1; i < builders.length; i++) {
      const mutations = builders[i].getMutations();
      for (const mutation of mutations) {
        // Add mutations from other builders to the primary builder
        switch (mutation.type) {
          case "create":
            primaryBuilder.create(
              mutation.entity!,
              mutation.data,
              mutation.options,
            );
            break;
          case "update":
            primaryBuilder.update(
              mutation.entity!,
              mutation.key,
              mutation.data,
              mutation.options,
            );
            break;
          case "delete":
            primaryBuilder.delete(
              mutation.entity!,
              mutation.key,
              mutation.options,
            );
            break;
          case "set":
            primaryBuilder.set(mutation.key, mutation.value, mutation.options);
            break;
          case "check":
            primaryBuilder.check(mutation.key, mutation.versionstamp);
            break;
          case "sum":
            primaryBuilder.sum(mutation.key, mutation.value);
            break;
          case "min":
            primaryBuilder.min(mutation.key, mutation.value);
            break;
          case "max":
            primaryBuilder.max(mutation.key, mutation.value);
            break;
        }
      }
    }

    return primaryBuilder;
  },

  /**
   * Create a builder from a function that accepts the builder
   */
  create(
    kv: Deno.Kv,
    builderFn: (builder: AtomicMutationBuilder) => void,
  ): AtomicMutationBuilder {
    const builder = createAtomicBuilder(kv);
    builderFn(builder);
    return builder;
  },

  /**
   * Split mutations into chunks for batch processing
   */
  chunk(
    mutations: AtomicMutation[],
    chunkSize: number = 100,
  ): AtomicMutation[][] {
    const chunks: AtomicMutation[][] = [];
    for (let i = 0; i < mutations.length; i += chunkSize) {
      chunks.push(mutations.slice(i, i + chunkSize));
    }
    return chunks;
  },

  /**
   * Validate that mutations don't exceed Deno KV limits
   */
  validateLimits(mutations: AtomicMutation[]): void {
    if (mutations.length > 1000) {
      throw new KVMOperationError("atomic",
        `Too many mutations: ${mutations.length}. Deno KV maximum is 1000 per transaction.`,
      );
    }

    // Additional validations can be added here
    // e.g., key length limits, value size limits, etc.
  },
};
