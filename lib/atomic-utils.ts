/**
 * Core atomic utilities for KVM - essential building blocks for concurrent operations
 */

import type { KVMEntity } from "./types.ts";
import { createAtomicBuilder } from "./atomic-builder.ts";
import { buildPrimaryKey } from "./utils.ts";
import type { AtomicTransactionResult } from "./atomic-types.ts";

/**
 * Counter utilities for atomic increments/decrements
 * This is the core building block for most atomic operations
 */
export class AtomicCounter {
  constructor(
    private kv: Deno.Kv,
    private key: Deno.KvKey,
  ) {}

  /**
   * Increment counter by specified amount (default: 1)
   */
  async increment(
    amount: number | bigint = 1,
  ): Promise<AtomicTransactionResult> {
    const value = typeof amount === "number" ? BigInt(amount) : amount;
    return await createAtomicBuilder(this.kv)
      .sum(this.key, value)
      .commit();
  }

  /**
   * Decrement counter by specified amount (default: 1)
   * Note: This is implemented as get-subtract-set rather than atomic sum with negative
   * since Deno KV sum only accepts positive values
   */
  async decrement(
    amount: number | bigint = 1,
  ): Promise<AtomicTransactionResult> {
    const decrementValue = typeof amount === "number" ? BigInt(amount) : amount;

    // Get current value and versionstamp for atomic check
    const current = await this.kv.get<Deno.KvU64>(this.key);
    const currentValue = current.value?.value ?? 0n;
    const newValue = currentValue - decrementValue;

    // Ensure we don't go below 0
    const finalValue = newValue < 0n ? 0n : newValue;

    return await createAtomicBuilder(this.kv)
      .check(this.key, current.versionstamp)
      .set(this.key, new Deno.KvU64(finalValue))
      .commit();
  }

  /**
   * Get current counter value
   */
  async get(): Promise<bigint> {
    const result = await this.kv.get<Deno.KvU64>(this.key);
    return result.value?.value ?? 0n;
  }

  /**
   * Reset counter to zero
   */
  async reset(): Promise<AtomicTransactionResult> {
    return await createAtomicBuilder(this.kv)
      .set(this.key, new Deno.KvU64(0n))
      .commit();
  }

  /**
   * Set counter to specific value
   */
  async set(value: number | bigint): Promise<AtomicTransactionResult> {
    const bigintValue = typeof value === "number" ? BigInt(value) : value;
    return await createAtomicBuilder(this.kv)
      .set(this.key, new Deno.KvU64(bigintValue))
      .commit();
  }

  /**
   * Conditionally increment if current value matches expected
   */
  async conditionalIncrement(
    expectedValue: bigint,
    amount: number | bigint = 1,
  ): Promise<AtomicTransactionResult> {
    const expectedEntry = await this.kv.get<Deno.KvU64>(this.key);
    const currentValue = expectedEntry.value?.value ?? 0n;

    if (currentValue !== expectedValue) {
      return { ok: false, mutations: [] };
    }

    const value = typeof amount === "number" ? BigInt(amount) : amount;

    return await createAtomicBuilder(this.kv)
      .check(this.key, expectedEntry.versionstamp)
      .sum(this.key, value)
      .commit();
  }
}

/**
 * Model-level atomic utilities for entity-based operations
 */
export class ModelAtomicUtils {
  constructor(
    private kv: Deno.Kv,
    private entity: KVMEntity,
  ) {}

  /**
   * Create a counter for a specific field in an entity
   */
  createFieldCounter(
    recordKey: string | Record<string, unknown>,
    field: string,
  ): AtomicCounter {
    const pk = typeof recordKey === "string"
      ? buildPrimaryKey(this.entity.primaryKey, { id: recordKey })
      : buildPrimaryKey(this.entity.primaryKey, recordKey);

    const counterKey = [...pk, "counters", field];
    return new AtomicCounter(this.kv, counterKey);
  }

  /**
   * Increment a numeric field atomically (e.g., likes, views, comments)
   */
  async incrementField(
    recordKey: string | Record<string, unknown>,
    field: string,
    amount: number | bigint = 1,
  ): Promise<AtomicTransactionResult> {
    const counter = this.createFieldCounter(recordKey, field);
    return await counter.increment(amount);
  }

  /**
   * Batch increment multiple fields atomically
   */
  async incrementFields(
    recordKey: string | Record<string, unknown>,
    fields: Record<string, number | bigint>,
  ): Promise<AtomicTransactionResult> {
    const pk = typeof recordKey === "string"
      ? buildPrimaryKey(this.entity.primaryKey, { id: recordKey })
      : buildPrimaryKey(this.entity.primaryKey, recordKey);

    const builder = createAtomicBuilder(this.kv);

    for (const [field, amount] of Object.entries(fields)) {
      const counterKey = [...pk, "counters", field];
      const value = typeof amount === "number" ? BigInt(amount) : amount;
      builder.sum(counterKey, value);
    }

    return await builder.commit();
  }

  /**
   * Get all counter values for a record
   */
  async getCounters(
    recordKey: string | Record<string, unknown>,
  ): Promise<Record<string, bigint>> {
    const pk = typeof recordKey === "string"
      ? buildPrimaryKey(this.entity.primaryKey, { id: recordKey })
      : buildPrimaryKey(this.entity.primaryKey, recordKey);

    const prefix = [...pk, "counters"];
    const counters: Record<string, bigint> = {};

    for await (const entry of this.kv.list<Deno.KvU64>({ prefix })) {
      const field = entry.key[entry.key.length - 1] as string;
      counters[field] = entry.value?.value ?? 0n;
    }

    return counters;
  }
}

/**
 * Core atomic utilities factory - provides essential building blocks
 */
export const AtomicUtils: {
  counter(kv: Deno.Kv, key: Deno.KvKey): AtomicCounter;
  forModel(kv: Deno.Kv, entity: KVMEntity): ModelAtomicUtils;
  builder(kv: Deno.Kv): ReturnType<typeof createAtomicBuilder>;
} = {
  /**
   * Create a counter for any key
   */
  counter(kv: Deno.Kv, key: Deno.KvKey): AtomicCounter {
    return new AtomicCounter(kv, key);
  },

  /**
   * Create model-specific atomic utilities
   */
  forModel(kv: Deno.Kv, entity: KVMEntity): ModelAtomicUtils {
    return new ModelAtomicUtils(kv, entity);
  },

  /**
   * Access to the atomic builder for custom operations
   */
  builder(kv: Deno.Kv) {
    return createAtomicBuilder(kv);
  },
};
