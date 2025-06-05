/**
 * Enhanced batch operations with retry and rollback functionality
 */

import type { KVMEntity } from "./types.ts";
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
import { create } from "./create.ts";
import { update } from "./update.ts";
import { deleteKey } from "./delete.ts";
import { findUnique } from "./find.ts";
import { buildPrimaryKey } from "./utils.ts";
import { KVMErrorUtils } from "./errors.ts";

/**
 * Default retry logic for batch operations
 */
function defaultShouldRetry(error: Error, attempt: number): boolean {
  // Retry on connection errors, timeout errors, and atomic conflicts
  return KVMErrorUtils.isRetryable(error) && attempt <= 3;
}

/**
 * Sleep utility for retry delays
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Enhanced createMany with retry and rollback functionality
 */
export async function enhancedCreateMany<T>(
  entity: KVMEntity,
  kv: Deno.Kv,
  data: T[],
  options: BatchCreateOptions = {},
  modelName?: string,
): Promise<BatchCreateResult<T>> {
  const {
    maxRetries = 0,
    retryDelay = 1000,
    rollbackOnAnyFailure = false,
    shouldRetry = defaultShouldRetry,
    onRetry,
    continueOnError = false,
    atomic = true,
  } = options;

  const result: BatchCreateResult<T> = {
    created: [],
    failed: [],
    stats: {
      total: data.length,
      created: 0,
      failed: 0,
      retried: 0,
      rolledBack: 0,
    },
  };

  const createdItems: Array<{ data: T; key: any }> = [];

  // Process each item with retry logic
  for (let i = 0; i < data.length; i++) {
    const item = data[i];
    let lastError: Error | null = null;
    let success = false;
    let retryCount = 0;

    // Attempt operation with retries
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        if (attempt > 0) {
          // This is a retry
          retryCount = attempt;
          result.stats.retried++;
          
          if (onRetry) {
            await onRetry(lastError!, attempt, item);
          }
          
          if (retryDelay > 0) {
            await sleep(retryDelay);
          }
        }

        const createResult = await create<T>(entity, kv, item, options);
        
        if (createResult?.value) {
          result.created.push(createResult.value);
          result.stats.created++;
          
          // Track for potential rollback
          if (rollbackOnAnyFailure && !atomic) {
            // Extract the primary key value from the created item for rollback
            const primaryKeyDef = entity.primaryKey.find(pk => pk.key);
            const primaryKeyValue = primaryKeyDef ? (createResult.value as any)[primaryKeyDef.key!] : createResult.value;
            createdItems.push({ data: createResult.value, key: primaryKeyValue });
          }
          
          success = true;
          break;
        } else {
          throw new Error("Create operation failed - no result value");
        }
      } catch (error) {
        lastError = error as Error;
        
        // Check if we should retry
        if (attempt < maxRetries && shouldRetry(lastError, attempt + 1)) {
          continue; // Try again
        } else {
          // Final failure
          break;
        }
      }
    }

    // Handle final failure
    if (!success && lastError) {
      result.failed.push({
        data: item,
        error: lastError,
        index: i,
        retryCount,
        finalAttempt: true,
      });
      result.stats.failed++;

      // Check if we should rollback and stop
      if (rollbackOnAnyFailure && !atomic) {
        // Rollback all successful operations
        for (const createdItem of createdItems) {
          try {
            await deleteKey(entity, kv, createdItem.key, { cascadeDelete: false });
            result.stats.rolledBack++;
          } catch (rollbackError) {
            // Log rollback errors but don't fail the operation
            console.warn(`Rollback failed for item:`, rollbackError);
          }
        }
        
        // Clear created items since they were rolled back
        result.created = [];
        result.stats.created = 0;
        break;
      }

      // If not continuing on error in non-atomic mode, stop here
      if (!continueOnError && !atomic) {
        break;
      }
    }
  }

  return result;
}

/**
 * Enhanced updateMany with retry and rollback functionality
 */
export async function enhancedUpdateMany<T>(
  entity: KVMEntity,
  kv: Deno.Kv,
  updates: BatchUpdateInput<T>[],
  options: BatchUpdateOptions = {},
  modelName?: string,
): Promise<BatchUpdateResult<T>> {
  const {
    maxRetries = 0,
    retryDelay = 1000,
    rollbackOnAnyFailure = false,
    shouldRetry = defaultShouldRetry,
    onRetry,
    continueOnError = false,
    atomic = true,
  } = options;

  const result: BatchUpdateResult<T> = {
    updated: [],
    notFound: [],
    failed: [],
    stats: {
      total: updates.length,
      updated: 0,
      notFound: 0,
      failed: 0,
      retried: 0,
      rolledBack: 0,
    },
  };

  const originalValues: Array<{ key: any; originalData: T }> = [];

  // Process each update with retry logic
  for (let i = 0; i < updates.length; i++) {
    const updateItem = updates[i];
    let lastError: Error | null = null;
    let success = false;
    let retryCount = 0;

    // Store original value for potential rollback
    let originalValue: T | null = null;
    if (rollbackOnAnyFailure && !atomic) {
      try {
        const existing = await findUnique<T>(entity, kv, updateItem.key);
        if (existing?.value) {
          originalValue = existing.value;
          originalValues.push({ key: updateItem.key, originalData: existing.value });
        }
      } catch (error) {
        // If we can't find the original, we can't rollback
      }
    }

    // Attempt operation with retries
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        if (attempt > 0) {
          retryCount = attempt;
          result.stats.retried++;
          
          if (onRetry) {
            await onRetry(lastError!, attempt, updateItem);
          }
          
          if (retryDelay > 0) {
            await sleep(retryDelay);
          }
        }

        const updateResult = await update<T>(entity, kv, updateItem.key, updateItem.data, options);
        
        if (updateResult?.value) {
          result.updated.push(updateResult.value);
          result.stats.updated++;
          success = true;
          break;
        } else {
          // Check if item was not found
          const existing = await findUnique<T>(entity, kv, updateItem.key);
          if (!existing?.value) {
            result.notFound.push({
              key: updateItem.key,
              index: i,
            });
            result.stats.notFound++;
            success = true; // Not an error, just not found
            break;
          } else {
            throw new Error("Update operation failed - no result value");
          }
        }
      } catch (error) {
        lastError = error as Error;
        
        // Check if it's a "not found" error
        if (lastError.message === "Record not found") {
          result.notFound.push({
            key: updateItem.key,
            index: i,
          });
          result.stats.notFound++;
          success = true; // Not an error, just not found
          break;
        }
        
        if (attempt < maxRetries && shouldRetry(lastError, attempt + 1)) {
          continue;
        } else {
          break;
        }
      }
    }

    // Handle final failure
    if (!success && lastError) {
      result.failed.push({
        key: updateItem.key,
        data: updateItem.data,
        error: lastError,
        index: i,
        retryCount,
        finalAttempt: true,
      });
      result.stats.failed++;

      // Check if we should rollback
      if (rollbackOnAnyFailure && !atomic) {
        // Rollback all previous updates
        for (const originalItem of originalValues) {
          try {
            await update<T>(entity, kv, originalItem.key, originalItem.originalData, options);
            result.stats.rolledBack++;
          } catch (rollbackError) {
            console.warn(`Rollback failed for item:`, rollbackError);
          }
        }
        
        // Clear updated items since they were rolled back
        result.updated = [];
        result.stats.updated = 0;
        break;
      }

      if (!continueOnError && !atomic) {
        break;
      }
    }
  }

  return result;
}

/**
 * Enhanced deleteMany with retry and rollback functionality
 */
export async function enhancedDeleteMany<T>(
  entity: KVMEntity,
  kv: Deno.Kv,
  keys: BatchDeleteInput[],
  options: BatchDeleteOptions = {},
  modelName?: string,
): Promise<BatchDeleteResult<T>> {
  const {
    maxRetries = 0,
    retryDelay = 1000,
    rollbackOnAnyFailure = false,
    shouldRetry = defaultShouldRetry,
    onRetry,
    continueOnError = false,
    atomic = true,
    returnDeletedItems = false,
  } = options;

  const result: BatchDeleteResult<T> = {
    deleted: [],
    deletedCount: 0,
    notFound: [],
    failed: [],
    stats: {
      total: keys.length,
      deleted: 0,
      notFound: 0,
      failed: 0,
      retried: 0,
      rolledBack: 0,
    },
  };

  const deletedItems: Array<{ key: any; originalData: T }> = [];

  // Process each deletion with retry logic
  for (let i = 0; i < keys.length; i++) {
    const keyItem = keys[i];
    const keyToDelete = typeof keyItem === 'object' && 'key' in keyItem ? keyItem.key : keyItem;
    let lastError: Error | null = null;
    let success = false;
    let retryCount = 0;

    // Store original value for potential rollback
    let originalValue: T | null = null;
    if (rollbackOnAnyFailure || returnDeletedItems) {
      try {
        const existing = await findUnique<T>(entity, kv, keyToDelete);
        if (existing?.value) {
          originalValue = existing.value;
        }
      } catch (error) {
        // Continue even if we can't find the original
      }
    }

    // Attempt operation with retries
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        if (attempt > 0) {
          retryCount = attempt;
          result.stats.retried++;
          
          if (onRetry) {
            await onRetry(lastError!, attempt, keyItem);
          }
          
          if (retryDelay > 0) {
            await sleep(retryDelay);
          }
        }

        await deleteKey(entity, kv, keyToDelete, { 
          cascadeDelete: options.cascadeDelete ?? false 
        });
        
        if (originalValue) {
          if (returnDeletedItems) {
            result.deleted.push(originalValue);
          }
          if (rollbackOnAnyFailure && !atomic) {
            deletedItems.push({ key: keyToDelete, originalData: originalValue });
          }
        }
        
        result.deletedCount++;
        result.stats.deleted++;
        success = true;
        break;
        
      } catch (error) {
        lastError = error as Error;
        
        // Check if item was not found (not an error for deletion)
        if ((error as Error).message.includes('not found')) {
          result.notFound.push({
            key: keyToDelete,
            index: i,
          });
          result.stats.notFound++;
          success = true;
          break;
        }
        
        if (attempt < maxRetries && shouldRetry(lastError, attempt + 1)) {
          continue;
        } else {
          break;
        }
      }
    }

    // Handle final failure
    if (!success && lastError) {
      result.failed.push({
        key: keyToDelete,
        error: lastError,
        index: i,
        retryCount,
        finalAttempt: true,
      });
      result.stats.failed++;

      // Check if we should rollback
      if (rollbackOnAnyFailure && !atomic) {
        // Rollback all previous deletions by recreating items
        for (const deletedItem of deletedItems) {
          try {
            await create<T>(entity, kv, deletedItem.originalData);
            result.stats.rolledBack++;
          } catch (rollbackError) {
            console.warn(`Rollback failed for item:`, rollbackError);
          }
        }
        
        // Clear deleted items since they were rolled back
        result.deleted = [];
        result.deletedCount = 0;
        result.stats.deleted = 0;
        break;
      }

      if (!continueOnError && !atomic) {
        break;
      }
    }
  }

  return result;
}