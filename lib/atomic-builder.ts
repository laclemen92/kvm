/**
 * Atomic mutation builder implementation for KVM
 */

import type { KVMEntity } from "./types.ts";
import {
  type AtomicCheckMutation,
  type AtomicCreateMutation,
  type AtomicDeleteMutation,
  type AtomicMaxMutation,
  type AtomicMinMutation,
  type AtomicMutation,
  type AtomicMutationBuilder,
  AtomicMutationType,
  type AtomicSetMutation,
  type AtomicSumMutation,
  type AtomicTransactionOptions,
  type AtomicTransactionResult,
  type AtomicUpdateMutation,
} from "./atomic-types.ts";
import { buildPrimaryKey } from "./utils.ts";
import { findUnique } from "./find.ts";
import { ValueType } from "./types.ts";
import {
  KVMErrorUtils,
  KVMOperationError,
  KVMValidationError,
} from "./errors.ts";

/**
 * Default atomic transaction options
 */
const DEFAULT_ATOMIC_OPTIONS: AtomicTransactionOptions = {
  maxMutations: 1000,
  validate: true,
  timeout: 30000,
  retry: true,
  maxRetries: 3,
  retryDelay: 100,
};

/**
 * Atomic mutation builder implementation
 */
export class KVMAtomicBuilder implements AtomicMutationBuilder {
  private mutations: AtomicMutation[] = [];
  private kv: Deno.Kv;

  constructor(kv: Deno.Kv) {
    this.kv = kv;
  }

  /**
   * Add a create mutation
   */
  create<T>(
    entity: KVMEntity,
    data: T,
    options?: { expireIn?: number },
  ): this {
    const mutation: AtomicCreateMutation<T> = {
      type: AtomicMutationType.CREATE,
      entity,
      data,
      options,
      modelName: entity.name,
    };

    this.mutations.push(mutation);
    return this;
  }

  /**
   * Add an update mutation
   */
  update<T>(
    entity: KVMEntity,
    key: Record<string, Deno.KvKeyPart>,
    data: Partial<T>,
    options?: { expireIn?: number; merge?: boolean },
  ): this {
    const mutation: AtomicUpdateMutation<T> = {
      type: AtomicMutationType.UPDATE,
      entity,
      key,
      data,
      options: { merge: true, ...options },
      modelName: entity.name,
    };

    this.mutations.push(mutation);
    return this;
  }

  /**
   * Add a delete mutation
   */
  delete(
    entity: KVMEntity,
    key: Record<string, Deno.KvKeyPart>,
    options?: { cascadeDelete?: boolean },
  ): this {
    const mutation: AtomicDeleteMutation = {
      type: AtomicMutationType.DELETE,
      entity,
      key,
      options,
      modelName: entity.name,
    };

    this.mutations.push(mutation);
    return this;
  }

  /**
   * Add a raw set mutation
   */
  set<T>(key: Deno.KvKey, value: T, options?: { expireIn?: number }): this {
    const mutation: AtomicSetMutation<T> = {
      type: AtomicMutationType.SET,
      key,
      value,
      options,
    };

    this.mutations.push(mutation);
    return this;
  }

  /**
   * Add a check mutation
   */
  check(key: Deno.KvKey, versionstamp: string | null): this {
    const mutation: AtomicCheckMutation = {
      type: AtomicMutationType.CHECK,
      key,
      versionstamp,
    };

    this.mutations.push(mutation);
    return this;
  }

  /**
   * Add a sum mutation
   */
  sum(key: Deno.KvKey, value: bigint): this {
    const mutation: AtomicSumMutation = {
      type: AtomicMutationType.SUM,
      key,
      value,
    };

    this.mutations.push(mutation);
    return this;
  }

  /**
   * Add a min mutation
   */
  min(key: Deno.KvKey, value: bigint): this {
    const mutation: AtomicMinMutation = {
      type: AtomicMutationType.MIN,
      key,
      value,
    };

    this.mutations.push(mutation);
    return this;
  }

  /**
   * Add a max mutation
   */
  max(key: Deno.KvKey, value: bigint): this {
    const mutation: AtomicMaxMutation = {
      type: AtomicMutationType.MAX,
      key,
      value,
    };

    this.mutations.push(mutation);
    return this;
  }

  /**
   * Execute all mutations atomically
   */
  async commit(
    options: AtomicTransactionOptions = {},
  ): Promise<AtomicTransactionResult> {
    const opts = { ...DEFAULT_ATOMIC_OPTIONS, ...options };

    // Validate mutation count
    if (this.mutations.length === 0) {
      return {
        ok: false,
        mutations: [],
        failedMutation: {
          index: -1,
          mutation: {} as AtomicMutation,
          error: new KVMOperationError("commit", "No mutations to commit"),
        },
      };
    }

    if (this.mutations.length > opts.maxMutations!) {
      return {
        ok: false,
        mutations: this.mutations,
        failedMutation: {
          index: -1,
          mutation: {} as AtomicMutation,
          error: new KVMOperationError(
            "commit",
            `Too many mutations: ${this.mutations.length}. Maximum allowed: ${opts.maxMutations}`,
          ),
        },
      };
    }

    // Validate mutations if requested
    if (opts.validate) {
      try {
        await this.validateMutations();
      } catch (error) {
        return {
          ok: false,
          mutations: this.mutations,
          failedMutation: {
            index: -1,
            mutation: {} as AtomicMutation,
            error: error as Error,
          },
        };
      }
    }

    // Execute with retries
    let lastError: Error | null = null;
    let attempts = 0;

    while (attempts <= (opts.maxRetries || 0)) {
      try {
        const result = await this.executeAtomicTransaction(opts);
        return result;
      } catch (error) {
        lastError = error as Error;
        attempts++;

        if (attempts <= (opts.maxRetries || 0) && opts.retry) {
          await this.delay(opts.retryDelay || 100);
          continue;
        }
        break;
      }
    }

    return {
      ok: false,
      mutations: this.mutations,
      failedMutation: {
        index: -1,
        mutation: {} as AtomicMutation,
        error: lastError ||
          new KVMOperationError("commit", "Unknown atomic transaction error"),
      },
    };
  }

  /**
   * Get all mutations without executing
   */
  getMutations(): AtomicMutation[] {
    return [...this.mutations];
  }

  /**
   * Clear all mutations
   */
  clear(): this {
    this.mutations = [];
    return this;
  }

  /**
   * Get the number of mutations
   */
  size(): number {
    return this.mutations.length;
  }

  /**
   * Validate all mutations before execution
   */
  private async validateMutations(): Promise<void> {
    for (let i = 0; i < this.mutations.length; i++) {
      const mutation = this.mutations[i];

      try {
        switch (mutation.type) {
          case AtomicMutationType.CREATE:
            await this.validateCreateMutation(mutation as AtomicCreateMutation);
            break;
          case AtomicMutationType.UPDATE:
            await this.validateUpdateMutation(mutation as AtomicUpdateMutation);
            break;
          case AtomicMutationType.DELETE:
            await this.validateDeleteMutation(mutation as AtomicDeleteMutation);
            break;
            // SET, CHECK, SUM, MIN, MAX mutations don't need entity validation
        }
      } catch (error) {
        throw new KVMValidationError(
          "mutation",
          mutation,
          `Mutation ${i} validation failed: ${(error as Error).message}`,
          mutation.modelName,
        );
      }
    }
  }

  /**
   * Validate a create mutation
   */
  private async validateCreateMutation(
    mutation: AtomicCreateMutation,
  ): Promise<void> {
    if (!mutation.entity || !mutation.data) {
      throw new Error("Create mutation requires entity and data");
    }

    // Validate against schema
    try {
      mutation.entity.schema.parse(mutation.data);
    } catch (error) {
      throw KVMErrorUtils.fromZodError(error, mutation.modelName);
    }

    // Check if record already exists
    const pk = buildPrimaryKey(mutation.entity.primaryKey, mutation.data);
    const existing = await this.kv.get(pk);
    if (existing.value !== null) {
      throw new Error(`Record already exists with key: ${pk.join(":")}`);
    }
  }

  /**
   * Validate an update mutation
   */
  private async validateUpdateMutation(
    mutation: AtomicUpdateMutation,
  ): Promise<void> {
    if (!mutation.entity || !mutation.key || !mutation.data) {
      throw new Error("Update mutation requires entity, key, and data");
    }

    // Check if record exists
    const existing = await findUnique(
      mutation.entity,
      this.kv,
      mutation.key as string | Deno.KvKeyPart | Record<string, unknown>,
    );
    if (!existing || !existing.value) {
      throw new Error(
        `Record not found with key: ${JSON.stringify(mutation.key)}`,
      );
    }

    // Validate merged data against schema
    const mergedData = mutation.options?.merge
      ? { ...existing.value, ...mutation.data }
      : mutation.data;

    try {
      mutation.entity.schema.parse(mergedData);
    } catch (error) {
      throw KVMErrorUtils.fromZodError(error, mutation.modelName);
    }
  }

  /**
   * Validate a delete mutation
   */
  private async validateDeleteMutation(
    mutation: AtomicDeleteMutation,
  ): Promise<void> {
    if (!mutation.entity || !mutation.key) {
      throw new Error("Delete mutation requires entity and key");
    }

    // Check if record exists
    const existing = await findUnique(
      mutation.entity,
      this.kv,
      mutation.key as string | Deno.KvKeyPart | Record<string, unknown>,
    );
    if (!existing || !existing.value) {
      throw new Error(
        `Record not found with key: ${JSON.stringify(mutation.key)}`,
      );
    }
  }

  /**
   * Execute the atomic transaction
   */
  private async executeAtomicTransaction(
    options: AtomicTransactionOptions,
  ): Promise<AtomicTransactionResult> {
    const atomic = this.kv.atomic();

    // Build atomic operations
    for (const mutation of this.mutations) {
      switch (mutation.type) {
        case AtomicMutationType.CREATE:
          await this.buildCreateOperation(
            atomic,
            mutation as AtomicCreateMutation,
          );
          break;
        case AtomicMutationType.UPDATE:
          await this.buildUpdateOperation(
            atomic,
            mutation as AtomicUpdateMutation,
          );
          break;
        case AtomicMutationType.DELETE:
          await this.buildDeleteOperation(
            atomic,
            mutation as AtomicDeleteMutation,
          );
          break;
        case AtomicMutationType.SET:
          this.buildSetOperation(atomic, mutation as AtomicSetMutation);
          break;
        case AtomicMutationType.CHECK:
          this.buildCheckOperation(atomic, mutation as AtomicCheckMutation);
          break;
        case AtomicMutationType.SUM:
          this.buildSumOperation(atomic, mutation as AtomicSumMutation);
          break;
        case AtomicMutationType.MIN:
          this.buildMinOperation(atomic, mutation as AtomicMinMutation);
          break;
        case AtomicMutationType.MAX:
          this.buildMaxOperation(atomic, mutation as AtomicMaxMutation);
          break;
      }
    }

    // Execute with timeout
    const commitPromise = atomic.commit();
    let timeoutId: number | undefined;

    let result: Deno.KvCommitResult | Deno.KvCommitError;
    if (options.timeout) {
      const timeoutPromise = new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => {
          reject(
            new Error(
              `Atomic transaction timed out after ${options.timeout}ms`,
            ),
          );
        }, options.timeout);
      });

      try {
        result = await Promise.race([commitPromise, timeoutPromise]);
      } finally {
        // Always clear the timeout to prevent timer leaks
        if (timeoutId !== undefined) {
          clearTimeout(timeoutId);
        }
      }
    } else {
      result = await commitPromise;
    }

    return {
      ok: result.ok,
      versionstamp: "versionstamp" in result ? result.versionstamp : undefined,
      mutations: this.mutations,
    };
  }

  /**
   * Build create operation for atomic transaction
   */
  private buildCreateOperation(
    atomic: Deno.AtomicOperation,
    mutation: AtomicCreateMutation,
  ): void {
    const { entity, data, options } = mutation;
    const pk = buildPrimaryKey(entity.primaryKey, data);

    // Check that primary key doesn't exist
    atomic.check({ key: pk, versionstamp: null });
    atomic.set(pk, data, options);

    // Handle secondary indexes
    if (entity.secondaryIndexes) {
      for (const secondaryIndex of entity.secondaryIndexes) {
        const secondaryKey = buildPrimaryKey(secondaryIndex.key, data);
        atomic.check({ key: secondaryKey, versionstamp: null });

        if (
          secondaryIndex.valueType === ValueType.KEY && secondaryIndex.valueKey
        ) {
          const value =
            (data as Record<string, unknown>)[secondaryIndex.valueKey];
          atomic.set(secondaryKey, value, options);
        } else {
          atomic.set(secondaryKey, data, options);
        }
      }
    }

    // Handle relations
    if (entity.relations) {
      for (const relation of entity.relations) {
        const relationKey = buildPrimaryKey(
          entity.primaryKey, // Relations use the entity's primary key
          data,
        );

        if (relation.valueType === ValueType.KEY && relation.valueKey) {
          const value = (data as Record<string, unknown>)[relation.valueKey];
          atomic.set(relationKey, value, options);
        } else {
          atomic.set(relationKey, data, options);
        }
      }
    }
  }

  /**
   * Build update operation for atomic transaction
   */
  private async buildUpdateOperation(
    atomic: Deno.AtomicOperation,
    mutation: AtomicUpdateMutation,
  ): Promise<void> {
    const { entity, key, data, options } = mutation;

    // Get existing record for merging and secondary index cleanup
    const existing = await findUnique(
      entity,
      this.kv,
      key as string | Deno.KvKeyPart | Record<string, unknown>,
    );
    if (!existing || !existing.value) {
      throw new Error(`Record not found for update: ${JSON.stringify(key)}`);
    }

    const mergedData = options?.merge ? { ...existing.value, ...data } : data;

    const pk = buildPrimaryKey(entity.primaryKey, key);
    atomic.set(pk, mergedData, { expireIn: options?.expireIn });

    // Update secondary indexes
    if (entity.secondaryIndexes) {
      for (const secondaryIndex of entity.secondaryIndexes) {
        // Delete old secondary index
        const oldSecondaryKey = buildPrimaryKey(
          secondaryIndex.key,
          existing.value,
        );
        atomic.delete(oldSecondaryKey);

        // Create new secondary index
        const newSecondaryKey = buildPrimaryKey(secondaryIndex.key, mergedData);
        if (
          secondaryIndex.valueType === ValueType.KEY && secondaryIndex.valueKey
        ) {
          const value =
            (mergedData as Record<string, unknown>)[secondaryIndex.valueKey];
          atomic.set(newSecondaryKey, value, { expireIn: options?.expireIn });
        } else {
          atomic.set(newSecondaryKey, mergedData, {
            expireIn: options?.expireIn,
          });
        }
      }
    }
  }

  /**
   * Build delete operation for atomic transaction
   */
  private async buildDeleteOperation(
    atomic: Deno.AtomicOperation,
    mutation: AtomicDeleteMutation,
  ): Promise<void> {
    const { entity, key, options } = mutation;

    // Get existing record for secondary index cleanup
    const existing = await findUnique(
      entity,
      this.kv,
      key as string | Deno.KvKeyPart | Record<string, unknown>,
    );
    if (!existing || !existing.value) {
      throw new Error(`Record not found for delete: ${JSON.stringify(key)}`);
    }

    const pk = buildPrimaryKey(entity.primaryKey, key);
    atomic.delete(pk);

    // Delete secondary indexes
    if (entity.secondaryIndexes) {
      for (const secondaryIndex of entity.secondaryIndexes) {
        const secondaryKey = buildPrimaryKey(
          secondaryIndex.key,
          existing.value,
        );
        atomic.delete(secondaryKey);
      }
    }

    // Handle cascade deletes
    if (options?.cascadeDelete && entity.relations) {
      for (const _relation of entity.relations) {
        const relationKey = buildPrimaryKey(
          entity.primaryKey, // Relations use the entity's primary key
          existing.value,
        );
        atomic.delete(relationKey);
      }
    }
  }

  /**
   * Build set operation for atomic transaction
   */
  private buildSetOperation(
    atomic: Deno.AtomicOperation,
    mutation: AtomicSetMutation,
  ): void {
    atomic.set(mutation.key, mutation.value, mutation.options);
  }

  /**
   * Build check operation for atomic transaction
   */
  private buildCheckOperation(
    atomic: Deno.AtomicOperation,
    mutation: AtomicCheckMutation,
  ): void {
    atomic.check({ key: mutation.key, versionstamp: mutation.versionstamp });
  }

  /**
   * Build sum operation for atomic transaction
   */
  private buildSumOperation(
    atomic: Deno.AtomicOperation,
    mutation: AtomicSumMutation,
  ): void {
    atomic.sum(mutation.key, mutation.value);
  }

  /**
   * Build min operation for atomic transaction
   */
  private buildMinOperation(
    atomic: Deno.AtomicOperation,
    mutation: AtomicMinMutation,
  ): void {
    atomic.min(mutation.key, mutation.value);
  }

  /**
   * Build max operation for atomic transaction
   */
  private buildMaxOperation(
    atomic: Deno.AtomicOperation,
    mutation: AtomicMaxMutation,
  ): void {
    atomic.max(mutation.key, mutation.value);
  }

  /**
   * Delay helper for retries
   */
  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

/**
 * Create a new atomic mutation builder
 */
export function createAtomicBuilder(kv: Deno.Kv): AtomicMutationBuilder {
  return new KVMAtomicBuilder(kv);
}
