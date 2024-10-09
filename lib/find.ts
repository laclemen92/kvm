import { ValueType } from "./types.ts";
import type { FindManyOptions, KVMEntity, SecondaryIndex } from "./types.ts";
import { buildPrimaryKey, isDenoKvKeyPart } from "./utils.ts";

/**
 * Find a unique record by a Deno.KvKeyPart or Deno.KvKey.
 * bySeondaryIndexName will query by a secondary index instead of
 * the primary key.
 * includeValue flags if a lookup should be performed for ValueType.KEY entries.
 *
 * @param entity The KvmEntity to find records for
 * @param kv The Deno.Kv instance for this operation
 * @param key The key to find by
 * @param bySecondaryIndexName Search by a secondaryIndex instead of the primaryKey
 * @param includeValue Include the full value for ValueType.KEY fields
 * @returns
 */
export const findUnique = async <T = unknown>(
  entity: KVMEntity,
  kv: Deno.Kv,
  key: Deno.KvKeyPart | Deno.KvKey,
  bySecondaryIndexName?: string,
  includeValue?: boolean,
): Promise<Deno.KvEntryMaybe<T> | null> => {
  let secondaryIndex: SecondaryIndex | undefined;
  if (
    bySecondaryIndexName
  ) {
    secondaryIndex = entity.secondaryIndexes?.find(
      (value) => {
        // don't really know if I need an array of keys here
        if (value.key[0].name === bySecondaryIndexName) {
          return value;
        }
      },
    );

    if (secondaryIndex) {
      const secondaryKey = buildPrimaryKey(
        secondaryIndex.key,
        key,
      );

      const result: Deno.KvEntryMaybe<T> = await kv.get(secondaryKey);

      if (
        includeValue && secondaryIndex.valueType !== ValueType.VALUE &&
        result.value
      ) {
        const pk = buildPrimaryKey(
          entity.primaryKey,
          result.value,
        );
        return await kv.get(pk);
      }

      return result;
    }

    return null;
  } else if (isDenoKvKeyPart(key)) {
    const pk = buildPrimaryKey(
      entity.primaryKey,
      key,
    );
    return await kv.get(pk);
  } else {
    return await kv.get(key);
  }
};

/**
 * Find a unique record by a Deno.KvKeyPart or Deno.KvKey.
 * bySeondaryIndexName will query by a secondary index instead of
 * the primary key.
 * includeValue flags if a lookup should be performed for ValueType.KEY entries.
 *
 * @param entity The KvmEntity to find records for
 * @param kv The Deno.Kv instance for this operation
 * @param key The key to find by
 * @param bySecondaryIndexName Search by a secondaryIndex instead of the primaryKey
 * @param includeValue Include the full value for ValueType.KEY fields
 * @returns
 */
export const findUniqueOrThrow = async <T = unknown>(
  entity: KVMEntity,
  kv: Deno.Kv,
  key: Deno.KvKeyPart | Deno.KvKey,
  bySecondaryIndexName?: string,
  includeValue?: boolean,
): Promise<Deno.KvEntryMaybe<T>> => {
  const result = await findUnique<T>(
    entity,
    kv,
    key,
    bySecondaryIndexName,
    includeValue,
  );

  if (!result || !result.value) {
    throw new Error("Not found");
  }

  return result;
};

/**
 * Attempt to findMany records. A selector or prefix can be used
 * to filter out results. Returns an array of results.
 *
 * @param entity The KvmEntity to find records for
 * @param kv The Deno.Kv instance for this operation
 * @param options Options for the list operation
 * @returns
 */
export const findMany = async <T = unknown>(
  entity: KVMEntity,
  kv: Deno.Kv,
  options?: FindManyOptions,
): Promise<Deno.KvEntry<T>[]> => {
  const selector: Deno.KvListSelector = options?.selector || {
    prefix: options?.prefix || [entity.name],
  };

  const listOptions: Deno.KvListOptions = {
    limit: options?.limit || 10,
    reverse: options?.reverse || false,
  };

  if (options?.cursor) {
    listOptions.cursor = options.cursor;
  }

  return await Array.fromAsync(
    kv.list<T>(selector, listOptions),
  );
};

/**
 * Returns the first record of a findMany operation.
 * A selector or prefix can be used to filter out results.
 * Returns an array of results.
 *
 * @param entity The KvmEntity to find records for
 * @param kv The Deno.Kv instance for this operation
 * @param options Options for the list operation
 * @returns
 */
export const findFirst = async <T = unknown>(
  entity: KVMEntity,
  kv: Deno.Kv,
  options?: FindManyOptions,
): Promise<Deno.KvEntry<T> | null> => {
  const results = await findMany<T>(entity, kv, options);

  if (results.length === 0) {
    return null;
  }

  return results[0];
};

/**
 * Returns the first record of a findMany operation
 * or throws an error.
 * A selector or prefix can be used to filter out results.
 * Returns an array of results.
 *
 * @param entity The KvmEntity to find records for
 * @param kv The Deno.Kv instance for this operation
 * @param options Options for the list operation
 * @returns
 */
export const findFirstOrThrow = async <T = unknown>(
  entity: KVMEntity,
  kv: Deno.Kv,
  options?: FindManyOptions,
): Promise<Deno.KvEntry<T>> => {
  const result = await findFirst<T>(entity, kv, options);

  if (!result) {
    throw new Error("Not found");
  }

  return result;
};
