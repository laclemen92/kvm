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
  BatchValidationResult,
} from "./batch-types.ts";
import { create } from "./create.ts";
import { update } from "./update.ts";
import { deleteKey } from "./delete.ts";
import { findUnique } from "./find.ts";
import { buildPrimaryKey } from "./utils.ts";
import { TTL } from "./ttl-utils.ts";
import type { TTLValue } from "./model-types.ts";
import {
  KVMBatchOperationError,
  KVMBatchValidationError,
  KVMErrorUtils,
  KVMValidationError,
} from "./errors.ts";

/**
 * Validates a batch of items against a schema
 */
export async function validateBatch<T>(
  items: T[],
  entity: KVMEntity,
  modelName?: string,
): Promise<BatchValidationResult<T>> {
  const results: BatchValidationResult<T> = {
    valid: [],
    invalid: [],
    stats: {
      total: items.length,
      valid: 0,
      invalid: 0,
    },
  };

  for (let i = 0; i < items.length; i++) {
    try {
      entity.schema.parse(items[i]);
      results.valid.push(items[i]);
      results.stats.valid++;
    } catch (error) {
      const validationErrors = [];

      if ((error as any).name === "ZodError" && (error as any).errors) {
        for (const zodError of (error as any).errors) {
          validationErrors.push({
            field: zodError.path?.join(".") || "unknown",
            message: zodError.message,
            rule: zodError.code || "validation",
            value: zodError.received,
          });
        }
      } else {
        validationErrors.push({
          field: "unknown",
          message: (error as any).message || "Validation failed",
          rule: "unknown",
        });
      }

      results.invalid.push({
        data: items[i],
        valid: false,
        errors: validationErrors,
        index: i,
      });
      results.stats.invalid++;
    }
  }

  return results;
}

/**
 * Create multiple records in a batch
 */
export async function createMany<T>(
  entity: KVMEntity,
  kv: Deno.Kv,
  data: T[],
  options: BatchCreateOptions = {},
  modelName?: string,
): Promise<BatchCreateResult<T>> {
  const {
    atomic = true,
    continueOnError = false,
    returnPartialResults = false,
    validateBeforeWrite = true,
    batchSize,
    expireIn,
  } = options;

  // Process TTL value if provided
  let processedExpireIn: number | undefined;
  if (expireIn !== undefined) {
    processedExpireIn = typeof expireIn === "string" 
      ? TTL.parse(expireIn) 
      : expireIn;
    
    if (!TTL.isValid(processedExpireIn)) {
      throw new Error(`Invalid TTL value: ${expireIn}`);
    }
  }

  const result: BatchCreateResult<T> = {
    created: [],
    failed: [],
    stats: {
      total: data.length,
      created: 0,
      failed: 0,
    },
  };

  // Validate all items first if requested
  if (validateBeforeWrite) {
    const validationResult = await validateBatch(data, entity, modelName);

    if (validationResult.stats.invalid > 0) {
      // Convert validation errors to failed items
      for (const invalid of validationResult.invalid) {
        result.failed.push({
          data: invalid.data,
          error: new KVMValidationError(
            invalid.errors?.[0]?.field || "unknown",
            invalid.errors?.[0]?.value,
            invalid.errors?.[0]?.message || "Validation failed",
            modelName,
          ),
          index: invalid.index,
        });
        result.stats.failed++;
      }

      if (!continueOnError) {
        throw new KVMBatchValidationError(validationResult, modelName);
      }

      if (!returnPartialResults) {
        return result;
      }

      // Continue with only valid items
      data = validationResult.valid;
    }
  }

  // Process in batches if batchSize is specified
  const chunks = batchSize ? chunkArray(data, batchSize) : [data];

  for (const chunk of chunks) {
    if (atomic && chunk.length > 1) {
      // Atomic batch operation
      try {
        const atomicOp = kv.atomic();
        const keys: Deno.KvKey[] = [];

        // Prepare all operations
        for (const item of chunk) {
          const pk = buildPrimaryKey(entity.primaryKey, item);
          keys.push(pk);

          // Check that key doesn't exist
          atomicOp.check({ key: pk, versionstamp: null });
          atomicOp.set(pk, item, processedExpireIn ? { expireIn: processedExpireIn } : undefined);

          // Handle secondary indexes
          if (entity.secondaryIndexes) {
            for (const secondaryIndex of entity.secondaryIndexes) {
              const secondaryKey = buildPrimaryKey(secondaryIndex.key, item);
              atomicOp.check({ key: secondaryKey, versionstamp: null });

              // Set secondary index based on valueType
              if (
                secondaryIndex.valueType === "KEY" && secondaryIndex.valueKey
              ) {
                const value = (item as any)[secondaryIndex.valueKey];
                atomicOp.set(secondaryKey, value, processedExpireIn ? { expireIn: processedExpireIn } : undefined);
              } else {
                atomicOp.set(secondaryKey, item, processedExpireIn ? { expireIn: processedExpireIn } : undefined);
              }
            }
          }

          // Handle relations
          if (entity.relations) {
            for (const relation of entity.relations) {
              const relationKey = buildPrimaryKey(
                entity.primaryKey,
                item,
              );

              if (relation.valueType === "KEY" && relation.valueKey) {
                const value = (item as any)[relation.valueKey];
                atomicOp.set(relationKey, value, processedExpireIn ? { expireIn: processedExpireIn } : undefined);
              } else {
                atomicOp.set(relationKey, item, processedExpireIn ? { expireIn: processedExpireIn } : undefined);
              }
            }
          }
        }

        // Commit atomic operation
        const atomicResult = await atomicOp.commit();

        if (atomicResult.ok) {
          result.created.push(...chunk);
          result.stats.created += chunk.length;
        } else {
          // All items in this atomic batch failed
          for (let i = 0; i < chunk.length; i++) {
            result.failed.push({
              data: chunk[i],
              error: new Error(
                "Atomic operation failed - key may already exist",
              ),
              index: data.indexOf(chunk[i]),
            });
            result.stats.failed++;
          }

          if (!continueOnError) {
            throw new KVMBatchOperationError(
              "create",
              result.stats.created,
              result.stats.failed,
              result.failed,
              modelName,
            );
          }
        }
      } catch (error) {
        // Error in atomic operation
        for (let i = 0; i < chunk.length; i++) {
          result.failed.push({
            data: chunk[i],
            error: error as Error,
            index: data.indexOf(chunk[i]),
          });
          result.stats.failed++;
        }

        if (!continueOnError) {
          throw new KVMBatchOperationError(
            "create",
            result.stats.created,
            result.stats.failed,
            result.failed,
            modelName,
          );
        }
      }
    } else {
      // Non-atomic operation or single item
      for (const item of chunk) {
        try {
          const created = await create(entity, kv, item, { expireIn });
          if (created?.value) {
            result.created.push(created.value);
            result.stats.created++;
          }
        } catch (error) {
          result.failed.push({
            data: item,
            error: error as Error,
            index: data.indexOf(item),
          });
          result.stats.failed++;

          if (!continueOnError) {
            throw new KVMBatchOperationError(
              "create",
              result.stats.created,
              result.stats.failed,
              result.failed,
              modelName,
            );
          }
        }
      }
    }
  }

  // If we had any failures and didn't throw earlier, throw now
  if (result.stats.failed > 0 && !returnPartialResults) {
    throw new KVMBatchOperationError(
      "create",
      result.stats.created,
      result.stats.failed,
      result.failed,
      modelName,
    );
  }

  return result;
}

/**
 * Update multiple records in a batch
 */
export async function updateMany<T>(
  entity: KVMEntity,
  kv: Deno.Kv,
  updates: BatchUpdateInput<T>[],
  options: BatchUpdateOptions = {},
  modelName?: string,
): Promise<BatchUpdateResult<T>> {
  const {
    atomic = true,
    continueOnError = false,
    returnPartialResults = false,
    batchSize,
    expireIn,
  } = options;

  // Process TTL value if provided
  let processedExpireIn: number | undefined;
  if (expireIn !== undefined) {
    processedExpireIn = typeof expireIn === "string" 
      ? TTL.parse(expireIn) 
      : expireIn;
    
    if (!TTL.isValid(processedExpireIn)) {
      throw new Error(`Invalid TTL value: ${expireIn}`);
    }
  }

  const result: BatchUpdateResult<T> = {
    updated: [],
    notFound: [],
    failed: [],
    stats: {
      total: updates.length,
      updated: 0,
      notFound: 0,
      failed: 0,
    },
  };

  // Process in batches if batchSize is specified
  const chunks = batchSize ? chunkArray(updates, batchSize) : [updates];

  for (const chunk of chunks) {
    if (atomic && chunk.length > 1) {
      // Atomic batch update - first fetch all existing records
      const existingRecords: Array<
        { update: BatchUpdateInput<T>; existing: any; index: number }
      > = [];

      for (let i = 0; i < chunk.length; i++) {
        const updateItem = chunk[i];
        const existing = await findUnique(entity, kv, updateItem.key);

        if (!existing?.value) {
          result.notFound.push({
            key: updateItem.key,
            index: updates.indexOf(updateItem),
          });
          result.stats.notFound++;

          if (!continueOnError) {
            throw new KVMBatchOperationError(
              "update",
              result.stats.updated,
              result.stats.failed + result.stats.notFound,
              result.failed,
              modelName,
            );
          }
        } else {
          existingRecords.push({
            update: updateItem,
            existing: existing.value,
            index: updates.indexOf(updateItem),
          });
        }
      }

      if (existingRecords.length > 0) {
        try {
          const atomicOp = kv.atomic();

          for (const { update: updateItem, existing } of existingRecords) {
            const mergedData = { ...existing, ...updateItem.data };

            // Validate merged data
            try {
              entity.schema.parse(mergedData);
            } catch (error) {
              if (!continueOnError) {
                throw KVMErrorUtils.fromZodError(error, modelName);
              }
              continue;
            }

            const pk = buildPrimaryKey(entity.primaryKey, updateItem.key);
            // Process individual item TTL
            let itemExpireIn = processedExpireIn;
            if (updateItem.options?.expireIn !== undefined) {
              itemExpireIn = typeof updateItem.options.expireIn === "string"
                ? TTL.parse(updateItem.options.expireIn)
                : updateItem.options.expireIn;
            }
            
            atomicOp.set(pk, mergedData, itemExpireIn ? { expireIn: itemExpireIn } : undefined);

            // Update secondary indexes
            if (entity.secondaryIndexes) {
              for (const secondaryIndex of entity.secondaryIndexes) {
                // Delete old secondary index
                const oldSecondaryKey = buildPrimaryKey(
                  secondaryIndex.key,
                  existing,
                );
                atomicOp.delete(oldSecondaryKey);

                // Create new secondary index
                const newSecondaryKey = buildPrimaryKey(
                  secondaryIndex.key,
                  mergedData,
                );
                if (
                  secondaryIndex.valueType === "KEY" && secondaryIndex.valueKey
                ) {
                  const value = mergedData[secondaryIndex.valueKey];
                  atomicOp.set(newSecondaryKey, value, itemExpireIn ? { expireIn: itemExpireIn } : undefined);
                } else {
                  atomicOp.set(newSecondaryKey, mergedData, itemExpireIn ? { expireIn: itemExpireIn } : undefined);
                }
              }
            }
          }

          const atomicResult = await atomicOp.commit();

          if (atomicResult.ok) {
            for (const { update: updateItem, existing } of existingRecords) {
              const mergedData = { ...existing, ...updateItem.data };
              result.updated.push(mergedData);
              result.stats.updated++;
            }
          } else {
            throw new Error("Atomic update operation failed");
          }
        } catch (error) {
          for (const { update: updateItem, index } of existingRecords) {
            result.failed.push({
              key: updateItem.key,
              data: updateItem.data,
              error: error as Error,
              index,
            });
            result.stats.failed++;
          }

          if (!continueOnError) {
            throw new KVMBatchOperationError(
              "update",
              result.stats.updated,
              result.stats.failed,
              result.failed,
              modelName,
            );
          }
        }
      }
    } else {
      // Non-atomic updates
      for (const updateItem of chunk) {
        try {
          const updated = await update(
            entity,
            kv,
            updateItem.key,
            updateItem.data,
            updateItem.options || { expireIn },
          );

          if (updated?.value) {
            result.updated.push(updated.value);
            result.stats.updated++;
          } else {
            result.notFound.push({
              key: updateItem.key,
              index: updates.indexOf(updateItem),
            });
            result.stats.notFound++;
          }
        } catch (error) {
          // Check if it's a "Record not found" error
          if ((error as Error).message === "Record not found") {
            result.notFound.push({
              key: updateItem.key,
              index: updates.indexOf(updateItem),
            });
            result.stats.notFound++;
          } else {
            result.failed.push({
              key: updateItem.key,
              data: updateItem.data,
              error: error as Error,
              index: updates.indexOf(updateItem),
            });
            result.stats.failed++;

            if (!continueOnError) {
              throw new KVMBatchOperationError(
                "update",
                result.stats.updated,
                result.stats.failed,
                result.failed,
                modelName,
              );
            }
          }
        }
      }
    }
  }

  if (
    (result.stats.failed > 0 || result.stats.notFound > 0) &&
    !returnPartialResults
  ) {
    throw new KVMBatchOperationError(
      "update",
      result.stats.updated,
      result.stats.failed + result.stats.notFound,
      result.failed,
      modelName,
    );
  }

  return result;
}

/**
 * Delete multiple records in a batch
 */
export async function deleteMany<T>(
  entity: KVMEntity,
  kv: Deno.Kv,
  keys: BatchDeleteInput[],
  options: BatchDeleteOptions = {},
  modelName?: string,
): Promise<BatchDeleteResult<T>> {
  const {
    atomic = true,
    continueOnError = false,
    returnDeletedItems = false,
    returnPartialResults = false,
    cascadeDelete = false,
    batchSize,
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
    },
  };

  // Process in batches if batchSize is specified
  const chunks = batchSize ? chunkArray(keys, batchSize) : [keys];

  for (const chunk of chunks) {
    if (atomic && chunk.length > 1) {
      // Fetch existing records if needed
      const existingRecords: Array<
        { key: BatchDeleteInput; existing: any; index: number }
      > = [];

      for (let i = 0; i < chunk.length; i++) {
        const deleteItem = chunk[i];
        const existing = await findUnique(entity, kv, deleteItem.key);

        if (!existing?.value) {
          result.notFound.push({
            key: deleteItem.key,
            index: keys.indexOf(deleteItem),
          });
          result.stats.notFound++;

          if (!continueOnError) {
            throw new KVMBatchOperationError(
              "delete",
              result.stats.deleted,
              result.stats.failed + result.stats.notFound,
              result.failed,
              modelName,
            );
          }
        } else {
          existingRecords.push({
            key: deleteItem,
            existing: existing.value,
            index: keys.indexOf(deleteItem),
          });
        }
      }

      if (existingRecords.length > 0) {
        try {
          const atomicOp = kv.atomic();

          for (const { key: deleteItem, existing } of existingRecords) {
            const pk = buildPrimaryKey(entity.primaryKey, deleteItem.key);
            atomicOp.delete(pk);

            // Delete secondary indexes
            if (entity.secondaryIndexes) {
              for (const secondaryIndex of entity.secondaryIndexes) {
                const secondaryKey = buildPrimaryKey(
                  secondaryIndex.key,
                  existing,
                );
                atomicOp.delete(secondaryKey);
              }
            }

            // Handle cascade deletes
            if (
              (deleteItem.options?.cascadeDelete ?? cascadeDelete) &&
              entity.relations
            ) {
              for (const relation of entity.relations) {
                const relationKey = buildPrimaryKey(
                  entity.primaryKey,
                  existing,
                );
                atomicOp.delete(relationKey);
              }
            }
          }

          const atomicResult = await atomicOp.commit();

          if (atomicResult.ok) {
            for (const { existing } of existingRecords) {
              if (returnDeletedItems) {
                result.deleted.push(existing);
              }
              result.deletedCount++;
              result.stats.deleted++;
            }
          } else {
            throw new Error("Atomic delete operation failed");
          }
        } catch (error) {
          for (const { key: deleteItem, index } of existingRecords) {
            result.failed.push({
              key: deleteItem.key,
              error: error as Error,
              index,
            });
            result.stats.failed++;
          }

          if (!continueOnError) {
            throw new KVMBatchOperationError(
              "delete",
              result.stats.deleted,
              result.stats.failed,
              result.failed,
              modelName,
            );
          }
        }
      }
    } else {
      // Non-atomic deletes
      for (const deleteItem of chunk) {
        try {
          const existing = returnDeletedItems
            ? await findUnique(entity, kv, deleteItem.key)
            : null;

          const deleted = await deleteKey(
            entity,
            kv,
            deleteItem.key,
            {
              cascadeDelete: deleteItem.options?.cascadeDelete ??
                cascadeDelete ?? false,
            },
          );

          if (deleted) {
            if (returnDeletedItems && existing?.value) {
              result.deleted.push(existing.value as T);
            }
            result.deletedCount++;
            result.stats.deleted++;
          } else {
            result.notFound.push({
              key: deleteItem.key,
              index: keys.indexOf(deleteItem),
            });
            result.stats.notFound++;
          }
        } catch (error) {
          result.failed.push({
            key: deleteItem.key,
            error: error as Error,
            index: keys.indexOf(deleteItem),
          });
          result.stats.failed++;

          if (!continueOnError) {
            throw new KVMBatchOperationError(
              "delete",
              result.stats.deleted,
              result.stats.failed,
              result.failed,
              modelName,
            );
          }
        }
      }
    }
  }

  if (
    (result.stats.failed > 0 || result.stats.notFound > 0) &&
    !returnPartialResults
  ) {
    throw new KVMBatchOperationError(
      "delete",
      result.stats.deleted,
      result.stats.failed + result.stats.notFound,
      result.failed,
      modelName,
    );
  }

  return result;
}

/**
 * Helper function to split an array into chunks
 */
function chunkArray<T>(array: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < array.length; i += size) {
    chunks.push(array.slice(i, i + size));
  }
  return chunks;
}
