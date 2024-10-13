import type {
  KVMEntity,
  Relation,
  SecondaryIndex,
  StringKeyedValueObject,
} from "./types.ts";
import {
  buildPrimaryKey,
  isDenoKvKeyPart,
  isStringKeyedValueObject,
} from "./utils.ts";
import { findUnique } from "./find.ts";

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
      const deletes = [];
      const value: T | null = found && found.value ? found.value : null;
      const atomicDelete = kv.atomic();
      deletes.push(pk);

      if (entity.secondaryIndexes) {
        entity.secondaryIndexes.forEach((secondaryIndex: SecondaryIndex) => {
          const secondaryIndexKey: Deno.KvKey = buildPrimaryKey(
            secondaryIndex.key,
            key,
          );

          deletes.push(secondaryIndexKey);
        });
      }

      if (entity.relations) {
        entity.relations.forEach((relation: Relation) => {
          if (
            relation.type === "one-to-many" &&
            isStringKeyedValueObject(value)
          ) {
            const relationKey = [
              relation.entityName,
              ...relation.fields.map((field) => {
                return value[field];
              }),
              ...pk,
            ];

            deletes.push(relationKey);
          }
        });
      }

      deletes.forEach((deleteParams) => {
        atomicDelete.delete(deleteParams);
      });

      await atomicDelete.commit();

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
