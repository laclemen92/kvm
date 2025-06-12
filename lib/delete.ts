import type {
  KVMEntity,
  Relation,
  RelationType,
  SecondaryIndex,
  StringKeyedValueObject,
} from "./types.ts";
import {
  buildPrimaryKey,
  isDenoKvKeyPart,
  isStringKeyedValueObject,
} from "./utils.ts";
import { findMany, findUnique } from "./find.ts";

/**
 * Delete a record by key.
 * options.cascadeDelete will also delete all relations and secondaryIndexes
 *
 * @param entity The KvmEntity to find records for
 * @param kv The Deno.Kv instance for this operation
 * @param key A Deno.KvKeyPart or Deno.KvKey to find for deletion
 * @param options
 * @returns
 */
export const deleteKey = async <T = unknown>(
  entity: KVMEntity,
  kv: Deno.Kv,
  key: Deno.KvKeyPart | Deno.KvKey | StringKeyedValueObject,
  options?: { cascadeDelete: boolean },
): Promise<Deno.KvEntryMaybe<T>> => {
  const found = await findUnique<T>(entity, kv, key);

  if (!found?.value) {
    throw new Error("Record not found");
  }

  if (isDenoKvKeyPart(key) || isStringKeyedValueObject(key)) {
    const pk = buildPrimaryKey(entity.primaryKey, key);

    if (options && options.cascadeDelete) {
      const value: T | null = found && found.value ? found.value : null;

      // Use atomic operation for all cascade deletes
      const atomic = kv.atomic();

      // Delete primary key
      atomic.delete(pk);

      // Delete secondary indexes
      if (entity.secondaryIndexes) {
        entity.secondaryIndexes.forEach((secondaryIndex: SecondaryIndex) => {
          const secondaryIndexKey: Deno.KvKey = buildPrimaryKey(
            secondaryIndex.key,
            value,
          );
          atomic.delete(secondaryIndexKey);
        });
      }

      // Delete relations
      if (entity.relations && isStringKeyedValueObject(value)) {
        for (const relation of entity.relations) {
          await _handleRelationCascadeDelete(
            kv,
            atomic,
            relation,
            value,
            pk,
            entity.name,
          );
        }
      }

      const _result = await atomic.commit();
      if (!_result.ok) {
        throw new Error(`Failed to delete ${entity.name}`);
      }

      return found;
    } else {
      await kv.delete(pk);
      return found;
    }
  } else {
    await kv.delete(key);
    return found;
  }
};

/**
 * Delete a records by keys.
 * options.cascadeDelete will also delete all relations and secondaryIndexes
 *
 * @param entity The KvmEntity to find records for
 * @param kv The Deno.Kv instance for this operation
 * @param deleteObjects An array of deletion operations
 * @returns
 */
export const deleteMany = async <T = unknown>(
  entity: KVMEntity,
  kv: Deno.Kv,
  deleteObjects: {
    key: Deno.KvKeyPart | Deno.KvKey;
    options?: { cascadeDelete: boolean };
  }[],
): Promise<Deno.KvEntryMaybe<T>[]> => {
  const results = [];

  for await (const del of deleteObjects) {
    results.push(await deleteKey<T>(entity, kv, del.key, del.options));
  }

  return results;
};

/**
 * Handle cascade delete for different relation types
 */
async function _handleRelationCascadeDelete(
  kv: Deno.Kv,
  atomic: Deno.AtomicOperation,
  relation: Relation,
  value: StringKeyedValueObject,
  pk: Deno.KvKey,
  entityName: string,
): Promise<void> {
  switch (relation.type) {
    case "one-to-many" as RelationType: // Backward compatibility
    case "hasMany" as RelationType: {
      // Delete the relation index
      const relationKey = [
        relation.entityName,
        ...relation.fields.map((field) => value[field]),
        ...pk,
      ];
      atomic.delete(relationKey);
      break;
    }

    case "belongsTo" as RelationType:
      // For belongsTo, we don't need to delete anything since the foreign key is in this entity
      // The related parent entity is not affected
      break;

    case "manyToMany" as RelationType:
      // For many-to-many, delete all join table entries
      if (relation.through) {
        try {
          const primaryKeyValue = value.id ||
            value[pk[pk.length - 1] as string];

          // Find all join table entries for this entity
          const joinTableResults = await findMany(
            {
              name: relation.through,
              primaryKey: [{ name: relation.through }],
            } as KVMEntity,
            kv,
            {
              prefix: [relation.through],
              limit: 1000, // Should be configurable
            },
          );

          // Delete join table entries that reference this entity
          for (const joinRecord of joinTableResults) {
            const joinValue = joinRecord.value as Record<string, unknown>;
            if (
              joinValue &&
              relation.fields.some((field: string) =>
                joinValue[field] === primaryKeyValue
              )
            ) {
              atomic.delete(joinRecord.key);
            }
          }
        } catch (error) {
          console.warn(
            `Failed to cascade delete many-to-many relations for ${entityName}:`,
            error,
          );
        }
      }
      break;

    default:
      console.warn(
        `Unknown relation type for cascade delete: ${relation.type}`,
      );
  }
}

/**
 * Delete cascade for hasMany relations - deletes all child records
 * This is a more aggressive cascade that deletes the actual child records, not just the relation indexes
 */
export const cascadeDeleteChildren = async <T = unknown>(
  kv: Deno.Kv,
  parentEntity: KVMEntity,
  childEntity: KVMEntity,
  parentValue: StringKeyedValueObject,
  relation: Relation,
): Promise<void> => {
  try {
    const parentPrimaryKey = parentValue.id ||
      parentValue[parentEntity.primaryKey[0].key!];

    // Find all child records
    const childResults = await findMany(
      childEntity,
      kv,
      {
        prefix: [childEntity.name],
        limit: 1000,
      },
    );

    // Filter children that belong to this parent
    const childrenToDelete = childResults.filter((childResult) => {
      const childValue = childResult.value as Record<string, unknown>;
      return relation.fields.some((field: string) =>
        childValue?.[field] === parentPrimaryKey
      );
    });

    // Delete each child record
    const atomic = kv.atomic();
    for (const child of childrenToDelete) {
      atomic.delete(child.key);

      // Also delete child's secondary indexes if needed
      if (childEntity.secondaryIndexes) {
        childEntity.secondaryIndexes.forEach((secondaryIndex) => {
          const secondaryIndexKey = buildPrimaryKey(
            secondaryIndex.key,
            child.value,
          );
          atomic.delete(secondaryIndexKey);
        });
      }
    }

    await atomic.commit();
  } catch (error) {
    console.error(
      `Failed to cascade delete children for ${parentEntity.name}:`,
      error,
    );
    throw error;
  }
};
