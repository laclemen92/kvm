import type { KVMEntity } from "./types.ts";
import type { ZodRawShape } from "zod";
import type {
  BatchWatchEvent,
  BatchWatchOptions,
  SSEOptions,
  WatchCallback,
  WatchEvent,
  WatchManyOptions,
  WatchOptions,
  WatchRelationOptions,
  WatchResult,
  WatchState,
  WatchStream,
  WebSocketOptions,
} from "./watch-types.ts";
import { WatchEventType } from "./watch-types.ts";
import { WatchUtils } from "./watch-utils.ts";
import { findMany } from "./find.ts";
import { buildPrimaryKey } from "./utils.ts";

/**
 * Core watch functionality for KVM entities
 */
export class WatchManager {
  private activeWatches = new Map<string, WatchState>();

  constructor(private kv: Deno.Kv) {}

  /**
   * Watch a single record by ID
   */
  async watch<T extends ZodRawShape = {}>(
    entity: KVMEntity<T>,
    id: string | Record<string, any>,
    options: WatchOptions = {},
  ): Promise<WatchResult<T>> {
    const key = WatchUtils.generateWatchKey(entity, id);
    return this.watchKeys(entity, [key], options);
  }

  /**
   * Watch multiple records by IDs
   */
  async watchMany<T extends ZodRawShape = {}>(
    entity: KVMEntity<T>,
    ids: (string | Record<string, any>)[],
    options: WatchOptions = {},
  ): Promise<WatchResult<T>> {
    const keys = WatchUtils.generateWatchKeys(entity, ids);
    return this.watchKeys(entity, keys, options);
  }

  /**
   * Watch records matching a query
   */
  async watchQuery<T extends ZodRawShape = {}>(
    entity: KVMEntity<T>,
    options: WatchManyOptions = {},
  ): Promise<WatchResult<T>> {
    const { where, limit = 10, prefix, watchAll = false, ...watchOptions } =
      options;

    // First, find the records that match the criteria
    const findOptions = {
      limit: watchAll ? undefined : limit,
      prefix,
    };

    let records;
    try {
      records = await findMany(entity, this.kv, findOptions);
    } catch (error) {
      throw new Error(
        `Failed to find records for watching: ${(error as Error).message}`,
      );
    }

    // Extract keys from found records
    const keys = records.map((record) => {
      // Get the primary key value from the record
      const primaryKeyDef = entity.primaryKey[0];
      const primaryKeyValue = primaryKeyDef.key
        ? (record.value as any)[primaryKeyDef.key]
        : record.value;
      return WatchUtils.generateWatchKey(entity, primaryKeyValue);
    });

    if (keys.length === 0) {
      // No records to watch, return empty stream
      return this.createEmptyWatchResult(entity.name);
    }

    return this.watchKeys(entity, keys, watchOptions);
  }

  /**
   * Watch related records for a given entity instance
   */
  async watchRelations<T extends ZodRawShape = {}>(
    entity: KVMEntity<T>,
    id: string | Record<string, any>,
    options: WatchRelationOptions,
  ): Promise<WatchResult<T>> {
    const { relation, includeRelated = true, depth = 1, ...watchOptions } =
      options;

    if (!entity.relations) {
      throw new Error(`Entity ${entity.name} has no relations defined`);
    }

    const relationDef = entity.relations.find((r) => r.entityName === relation);
    if (!relationDef) {
      throw new Error(
        `Relation ${relation} not found on entity ${entity.name}`,
      );
    }

    // For now, implement basic relation watching
    // This would need to be expanded based on relation types
    const mainKey = WatchUtils.generateWatchKey(entity, id);

    // Generate keys for related entities based on relation type
    const relatedKeys: Deno.KvKey[] = [];

    if (relationDef.type === "hasMany" && relationDef.foreignKey) {
      // Watch related records via foreign key
      const relatedPrefix: Deno.KvKey = [relationDef.entityName];
      relatedKeys.push(relatedPrefix);
    }

    const allKeys = includeRelated ? [mainKey, ...relatedKeys] : [mainKey];
    return this.watchKeys(entity, allKeys, watchOptions);
  }

  /**
   * Watch multiple entities in a single stream
   * NOTE: This is a placeholder implementation - full batch watching requires entity registry
   */
  async watchBatch(
    options: BatchWatchOptions,
  ): Promise<ReadableStream<BatchWatchEvent>> {
    const { entities, global = {}, maxKeys = 50 } = options;

    // This would need entity registry to resolve entity definitions
    // For now, we'll throw an error indicating this needs implementation
    throw new Error(
      "Batch watching requires entity registry - not yet implemented",
    );
  }

  /**
   * Watch keys directly
   */
  private async watchKeys<T extends ZodRawShape = {}>(
    entity: KVMEntity<T>,
    keys: Deno.KvKey[],
    options: WatchOptions = {},
  ): Promise<WatchResult<T>> {
    const { includeDeleted = false, raw = false } = options;
    const watchId = crypto.randomUUID();

    // Deno KV supports max 10 keys per watch
    if (keys.length > 10) {
      throw new Error(
        `Cannot watch more than 10 keys at once. Got ${keys.length} keys.`,
      );
    }

    const state: WatchState = {
      active: true,
      callbacks: [],
      abortController: new AbortController(),
    };

    this.activeWatches.set(watchId, state);

    // Get initial state of all keys
    const initialEntries = await Promise.all(
      keys.map((key) => this.kv.get(key)),
    );

    let previousValues = new Map<string, T | null>();

    // Store initial values
    initialEntries.forEach((entry, index) => {
      const keyStr = JSON.stringify(keys[index]);
      previousValues.set(keyStr, entry.value as T | null);
    });

    const watchManager = this;
    const stream = new ReadableStream<WatchEvent<T>>({
      start(controller) {
        state.controller = controller;

        // Emit initial events for existing values
        initialEntries.forEach((entry, index) => {
          if (entry.value !== null || includeDeleted) {
            const event = WatchUtils.createEvent(
              WatchEventType.INITIAL,
              keys[index],
              entry.value as T,
              entry.versionstamp,
              entity.name,
            );
            controller.enqueue(event);
          }
        });

        // Start watching
        watchManager.startWatching(
          keys,
          controller,
          state,
          entity,
          previousValues,
          includeDeleted,
          raw,
        ).catch((error) => controller.error(error));
      },

      cancel() {
        watchManager.stopWatch(watchId);
      },
    });

    const stop = () => this.stopWatch(watchId);

    const on = (callback: WatchCallback<T>) => {
      state.callbacks.push(callback);
      return () => {
        const index = state.callbacks.indexOf(callback);
        if (index > -1) {
          state.callbacks.splice(index, 1);
        }
      };
    };

    const toSSE = (sseOptions?: SSEOptions) => {
      return WatchUtils.createSSEResponse(stream, sseOptions);
    };

    const toWebSocket = (wsOptions?: WebSocketOptions) => {
      return WatchUtils.createWebSocketHandler(stream, wsOptions);
    };

    return {
      stream,
      stop,
      on,
      toSSE,
      toWebSocket,
    };
  }

  /**
   * Start the actual watching process
   */
  private async startWatching<T extends ZodRawShape = {}>(
    keys: Deno.KvKey[],
    controller: ReadableStreamDefaultController<WatchEvent<T>>,
    state: WatchState,
    entity: KVMEntity<T>,
    previousValues: Map<string, T | null>,
    includeDeleted: boolean,
    raw: boolean,
  ) {
    try {
      const watchStream = this.kv.watch(keys, { raw });

      for await (const entries of watchStream) {
        if (!state.active) {
          break;
        }

        entries.forEach((entry, index) => {
          const keyStr = JSON.stringify(keys[index]);
          const previousValue = previousValues.get(keyStr);
          const currentValue = entry.value as T | null;

          // Skip if value hasn't actually changed (unless raw mode)
          if (!raw && previousValue === currentValue) {
            return;
          }

          // Skip deleted entries unless requested
          if (!includeDeleted && currentValue === null) {
            return;
          }

          const eventType = WatchUtils.determineEventType(
            currentValue,
            previousValue,
            false,
          );

          const event = WatchUtils.createEvent(
            eventType,
            keys[index],
            currentValue,
            entry.versionstamp,
            entity.name,
            previousValue,
          );

          // Update previous value
          previousValues.set(keyStr, currentValue);

          // Emit event
          controller.enqueue(event);

          // Call registered callbacks
          state.callbacks.forEach((callback) => {
            try {
              callback(event);
            } catch (error) {
              console.error("Watch callback error:", error);
            }
          });
        });
      }
    } catch (error) {
      if (state.active) {
        controller.error(error);
      }
    } finally {
      if (state.active) {
        controller.close();
      }
    }
  }

  /**
   * Stop a watch operation
   */
  private stopWatch(watchId: string) {
    const state = this.activeWatches.get(watchId);
    if (state) {
      state.active = false;
      state.abortController?.abort();

      // Only close if controller exists and stream isn't already closed
      if (state.controller) {
        try {
          state.controller.close();
        } catch (error) {
          // Ignore error if stream is already closed
          if (
            !(error instanceof TypeError &&
              error.message.includes("cannot close or enqueue"))
          ) {
            throw error;
          }
        }
      }

      this.activeWatches.delete(watchId);
    }
  }

  /**
   * Create an empty watch result for when no records match
   */
  private createEmptyWatchResult<T>(modelName: string): WatchResult<T> {
    const stream = new ReadableStream<WatchEvent<T>>({
      start(controller) {
        controller.close();
      },
    });

    return {
      stream,
      stop: () => {},
      on: () => () => {},
      toSSE: (options?: SSEOptions) =>
        WatchUtils.createSSEResponse(stream, options),
      toWebSocket: (options?: WebSocketOptions) =>
        WatchUtils.createWebSocketHandler(stream, options),
    };
  }

  /**
   * Stop all active watches
   */
  stopAll() {
    for (const watchId of this.activeWatches.keys()) {
      this.stopWatch(watchId);
    }
  }

  /**
   * Get count of active watches
   */
  getActiveWatchCount(): number {
    return this.activeWatches.size;
  }
}

/**
 * Global watch manager instance (can be overridden)
 */
let globalWatchManager: WatchManager | null = null;

/**
 * Initialize the global watch manager
 */
export function initializeWatchManager(kv: Deno.Kv): WatchManager {
  globalWatchManager = new WatchManager(kv);
  return globalWatchManager;
}

/**
 * Get the global watch manager
 */
export function getWatchManager(): WatchManager {
  if (!globalWatchManager) {
    throw new Error(
      "Watch manager not initialized. Call initializeWatchManager() first.",
    );
  }
  return globalWatchManager;
}

/**
 * Functional API for watching individual records
 */
export async function watchRecord<T extends ZodRawShape = {}>(
  entity: KVMEntity<T>,
  kv: Deno.Kv,
  id: string | Record<string, any>,
  options: WatchOptions = {},
): Promise<WatchResult<T>> {
  const manager = new WatchManager(kv);
  return manager.watch(entity, id, options);
}

/**
 * Functional API for watching multiple records
 */
export async function watchRecords<T extends ZodRawShape = {}>(
  entity: KVMEntity<T>,
  kv: Deno.Kv,
  ids: (string | Record<string, any>)[],
  options: WatchOptions = {},
): Promise<WatchResult<T>> {
  const manager = new WatchManager(kv);
  return manager.watchMany(entity, ids, options);
}

/**
 * Functional API for watching records matching a query
 */
export async function watchQuery<T extends ZodRawShape = {}>(
  entity: KVMEntity<T>,
  kv: Deno.Kv,
  options: WatchManyOptions = {},
): Promise<WatchResult<T>> {
  const manager = new WatchManager(kv);
  return manager.watchQuery(entity, options);
}
