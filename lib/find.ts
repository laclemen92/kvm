import { RelationType, ValueType } from "./types.ts";
import type {
  FindManyOptions,
  IncludePath,
  KVMEntity,
  SecondaryIndex,
  StringKeyedValueObject,
} from "./types.ts";
import {
  buildPrimaryKey,
  isDenoKvKeyPart,
  isStringKeyedValueObject,
} from "./utils.ts";

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
  key: Deno.KvKeyPart | Deno.KvKey | StringKeyedValueObject,
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
        if (value.name === bySecondaryIndexName) {
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
  } else if (isDenoKvKeyPart(key) || isStringKeyedValueObject(key)) {
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

/**
 * Helper function to eagerly load relations based on include paths
 */
export const eagerLoadRelations = async <T = unknown>(
  entity: KVMEntity,
  kv: Deno.Kv,
  records: Deno.KvEntry<T>[],
  includePaths?: IncludePath[],
): Promise<Deno.KvEntry<T>[]> => {
  if (!includePaths || includePaths.length === 0 || !entity.relations) {
    return records;
  }

  // Process each include path
  for (const includePath of includePaths) {
    const path = typeof includePath === "string"
      ? includePath
      : includePath.path;

    // Find the relation definition
    const relation = entity.relations.find((rel) => rel.entityName === path);
    if (!relation) {
      continue; // Skip unknown relations
    }

    // Load related data for all records
    for (const record of records) {
      try {
        await _eagerLoadRelation(entity, kv, record, relation, includePath);
      } catch (error) {
        // Ignore errors for individual relation loading
        console.warn(`Failed to load relation ${path}:`, error);
      }
    }
  }

  return records;
};

/**
 * Load a specific relation for a record
 */
async function _eagerLoadRelation<T>(
  entity: KVMEntity,
  kv: Deno.Kv,
  record: Deno.KvEntry<T>,
  relation: any,
  includePath: IncludePath,
): Promise<void> {
  const value = record.value as any;
  if (!value) return;

  // Get the foreign key value(s) from the record
  const foreignKeyValues = relation.fields.map((field: string) => value[field])
    .filter(Boolean);
  if (foreignKeyValues.length === 0) {
    return;
  }

  // Handle different relation types
  switch (relation.type) {
    case RelationType.BELONGS_TO:
      await _eagerLoadBelongsTo(
        kv,
        value,
        relation,
        foreignKeyValues[0],
        includePath,
      );
      break;
    case RelationType.ONE_TO_MANY:
      await _eagerLoadOneToMany(
        kv,
        value,
        relation,
        foreignKeyValues,
        includePath,
      );
      break;
    case RelationType.MANY_TO_MANY:
      await _eagerLoadManyToMany(
        kv,
        value,
        relation,
        foreignKeyValues,
        includePath,
      );
      break;
  }
}

/**
 * Eager load a belongsTo relation
 */
async function _eagerLoadBelongsTo(
  kv: Deno.Kv,
  value: any,
  relation: any,
  foreignKeyValue: any,
  includePath: IncludePath,
): Promise<void> {
  try {
    const result = await findUnique(
      {
        name: relation.entityName,
        primaryKey: [{ name: relation.entityName, key: "id" }],
      } as KVMEntity,
      kv,
      foreignKeyValue,
    );

    if (result?.value) {
      value[relation.entityName] = result.value;

      // Handle nested includes
      if (typeof includePath === "object" && includePath.include) {
        const relatedEntity = {
          name: relation.entityName,
          primaryKey: [{ name: relation.entityName, key: "id" }],
        } as KVMEntity;
        if (result?.value !== null) {
          await eagerLoadRelations(
            relatedEntity,
            kv,
            [result as Deno.KvEntry<unknown>],
            includePath.include,
          );
        }
      }
    }
  } catch (error) {
    // Ignore not found errors
  }
}

/**
 * Eager load a hasMany/one-to-many relation
 */
async function _eagerLoadOneToMany(
  kv: Deno.Kv,
  value: any,
  relation: any,
  foreignKeyValues: any[],
  includePath: IncludePath,
): Promise<void> {
  try {
    const results = await findMany(
      {
        name: relation.entityName,
        primaryKey: [{ name: relation.entityName }],
      } as KVMEntity,
      kv,
      {
        prefix: [relation.entityName],
        limit: 100,
      },
    );

    // Filter results that match the foreign key
    const primaryKeyField = relation.foreignKey || "id";
    const primaryKeyValue = value[primaryKeyField] || value.id;

    const filteredResults = results.filter((result) => {
      return relation.fields.some((field: string) =>
        (result.value as any)?.[field] === primaryKeyValue
      );
    });

    value[relation.entityName] = filteredResults.map((r) => r.value);

    // Handle nested includes
    if (typeof includePath === "object" && includePath.include) {
      const relatedEntity = {
        name: relation.entityName,
        primaryKey: [{ name: relation.entityName }],
      } as KVMEntity;
      await eagerLoadRelations(
        relatedEntity,
        kv,
        filteredResults,
        includePath.include,
      );
    }
  } catch (error) {
    value[relation.entityName] = [];
  }
}

/**
 * Eager load a many-to-many relation
 */
async function _eagerLoadManyToMany(
  kv: Deno.Kv,
  value: any,
  relation: any,
  foreignKeyValues: any[],
  includePath: IncludePath,
): Promise<void> {
  if (!relation.through) {
    value[relation.entityName] = [];
    return;
  }

  try {
    // Get join table records
    const joinResults = await findMany(
      {
        name: relation.through,
        primaryKey: [{ name: relation.through }],
      } as KVMEntity,
      kv,
      {
        prefix: [relation.through],
        limit: 100,
      },
    );

    const primaryKeyValue = value.id;

    // Find related IDs through the join table
    const relatedIds: any[] = [];
    for (const joinRecord of joinResults) {
      const joinValue = joinRecord.value as any;
      if (
        joinValue &&
        relation.fields.some((field: string) =>
          joinValue[field] === primaryKeyValue
        )
      ) {
        // Extract the other side's ID from the join record
        const otherIdField = Object.keys(joinValue).find((key) =>
          !relation.fields.includes(key) && key.endsWith("Id")
        );
        if (otherIdField && joinValue[otherIdField]) {
          relatedIds.push(joinValue[otherIdField]);
        }
      }
    }

    // Fetch the actual related records
    const relatedRecords = [];
    for (const relatedId of relatedIds) {
      try {
        const result = await findUnique(
          {
            name: relation.entityName,
            primaryKey: [{ name: relation.entityName, key: "id" }],
          } as KVMEntity,
          kv,
          relatedId,
        );
        if (result?.value) {
          relatedRecords.push(result);
        }
      } catch (error) {
        // Ignore individual lookup failures
      }
    }

    value[relation.entityName] = relatedRecords.map((r) => r.value);

    // Handle nested includes
    if (typeof includePath === "object" && includePath.include) {
      const relatedEntity = {
        name: relation.entityName,
        primaryKey: [{ name: relation.entityName, key: "id" }],
      } as KVMEntity;
      const validRecords = relatedRecords.filter(r => r?.value !== null) as Deno.KvEntry<unknown>[];
      if (validRecords.length > 0) {
        await eagerLoadRelations(
          relatedEntity,
          kv,
          validRecords,
          includePath.include,
        );
      }
    }
  } catch (error) {
    value[relation.entityName] = [];
  }
}
