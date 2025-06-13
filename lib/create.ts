import {
  buildPrimaryKey,
  isDenoKvKeyPart,
  isStringKeyedValueObject,
} from "./utils.ts";
import { RelationType, ValueType } from "./types.ts";
import type { KVMEntity, Relation, SecondaryIndex } from "./types.ts";
import { findUnique } from "./find.ts";
import { TTL } from "./ttl-utils.ts";
import type { TTLValue } from "./model-types.ts";

/**
 * Create a record in Deno.
 *
 * @param entity The KvmEntity to find records for
 * @param kv The Deno.Kv instance for this operation
 * @param value The value to save for this key
 * @param options Options for the set operation
 * @returns
 */
export const create = async <T = unknown>(
  entity: KVMEntity,
  kv: Deno.Kv,
  value: T,
  options?: { expireIn?: TTLValue },
): Promise<Deno.KvEntryMaybe<T> | null> => {
  // do logic here to do all the setting for us
  // should it matter if it is an update or create? yea it does cause if it is an update, we can spread

  // first check that the schema and value are good to go
  // parse() returns the transformed value
  const transformedValue = entity.schema.parse(value);
  const pk: Deno.KvKey = buildPrimaryKey(entity.primaryKey, transformedValue);
  const operation = kv.atomic();
  const checks = [];
  const sets = [];

  // Process TTL value if provided
  let processedOptions = options;
  if (options?.expireIn !== undefined) {
    const expireInMs = typeof options.expireIn === "string"
      ? TTL.parse(options.expireIn)
      : options.expireIn;

    if (!TTL.isValid(expireInMs)) {
      throw new Error(`Invalid TTL value: ${options.expireIn}`);
    }

    processedOptions = { ...options, expireIn: expireInMs };
  }

  checks.push({ key: pk, versionstamp: null });
  sets.push({ key: pk, value: transformedValue, options: processedOptions });

  if (entity.secondaryIndexes) {
    entity.secondaryIndexes.forEach((secondaryIndexDef: SecondaryIndex) => {
      const secondaryIndex: Deno.KvKey = buildPrimaryKey(
        secondaryIndexDef.key,
        transformedValue,
      );
      // }

      checks.push({ key: secondaryIndex, versionstamp: null });

      if (
        secondaryIndexDef.valueType === ValueType.KEY &&
        secondaryIndexDef.valueKey &&
        isStringKeyedValueObject(transformedValue)
      ) {
        sets.push({
          key: secondaryIndex,
          value: transformedValue[secondaryIndexDef.valueKey],
          options: processedOptions,
        });
      } else {
        sets.push({
          key: secondaryIndex,
          value: transformedValue,
          options: processedOptions,
        });
      }
    });
  }

  if (entity.relations) {
    entity.relations.forEach((relation: Relation) => {
      if (!isStringKeyedValueObject(transformedValue)) return;

      switch (relation.type) {
        case RelationType.ONE_TO_MANY:
        case "one-to-many" as any: // Backward compatibility
          // Only create relation keys if this entity has the foreign key field
          // This handles child entities that reference a parent (e.g., Product -> Category)
          const hasForeignKeyFields = relation.fields.every((field) =>
            field in transformedValue
          );
          if (hasForeignKeyFields) {
            // Create index for hasMany relations: [parentEntity, foreignKey, childEntity, childId]
            const relationKey = [
              relation.entityName,
              ...relation.fields.map((field) => transformedValue[field]),
              ...pk,
            ];

            checks.push({ key: relationKey, versionstamp: null });
            if (relation.valueType === ValueType.KEY && relation.valueKey) {
              sets.push({
                key: relationKey,
                value: transformedValue[relation.valueKey],
                options: processedOptions,
              });
            } else {
              sets.push({
                key: relationKey,
                value: transformedValue,
                options: processedOptions,
              });
            }
          }
          break;

        case RelationType.BELONGS_TO:
          // For belongsTo, we don't need to create additional keys during creation
          // The foreign key is already stored in the entity itself
          break;

        case RelationType.MANY_TO_MANY:
          // For many-to-many, we'll handle join table creation in a separate function
          // This requires the join table to be created/updated separately
          if (relation.through) {
            // We could create join table entries here if needed
            // For now, we'll leave this to be handled by separate join table operations
          }
          break;
      }
    });
  }

  checks.forEach((checkParams) => {
    operation.check(checkParams);
  });
  sets.forEach((setParams) => {
    const { key, value, options } = setParams;
    operation.set(key, value, options as { expireIn?: number });
  });

  const res = await operation.commit();
  if (!res.ok) {
    // For duplicate key scenarios, provide a more specific error
    throw new Error(`Failed to create ${entity.name}: key already exists`);
  }
  // return res;

  let findKey: Deno.KvKey | Deno.KvKeyPart | null = null;
  if (entity.primaryKey[0].key && isStringKeyedValueObject(transformedValue)) {
    findKey = transformedValue[entity.primaryKey[0].key];
  } else if (isDenoKvKeyPart(transformedValue)) {
    findKey = transformedValue;
  }
  if (!findKey) {
    throw new Error("couldn't find key");
  }
  const created = await findUnique<T>(entity, kv, findKey);
  return created;
};

/**
 * Create a many-to-many relationship by adding an entry to the join table
 *
 * @param kv The Deno.Kv instance
 * @param joinTableName The name of the join table
 * @param entity1Id ID of the first entity
 * @param entity1Field Field name for the first entity ID
 * @param entity2Id ID of the second entity
 * @param entity2Field Field name for the second entity ID
 * @param additionalData Additional data to store in the join table
 */
export const createManyToManyRelation = async (
  kv: Deno.Kv,
  joinTableName: string,
  entity1Id: string,
  entity1Field: string,
  entity2Id: string,
  entity2Field: string,
  additionalData?: Record<string, any>,
): Promise<boolean> => {
  try {
    const joinTableKey = [joinTableName, entity1Id, entity2Id];
    const joinTableValue = {
      [entity1Field]: entity1Id,
      [entity2Field]: entity2Id,
      ...additionalData,
    };

    const operation = kv.atomic();
    operation.check({ key: joinTableKey, versionstamp: null });
    operation.set(joinTableKey, joinTableValue);

    const result = await operation.commit();
    return result.ok;
  } catch (error) {
    console.error("Failed to create many-to-many relation:", error);
    return false;
  }
};

/**
 * Remove a many-to-many relationship by deleting the join table entry
 */
export const deleteManyToManyRelation = async (
  kv: Deno.Kv,
  joinTableName: string,
  entity1Id: string,
  entity2Id: string,
): Promise<boolean> => {
  try {
    const joinTableKey = [joinTableName, entity1Id, entity2Id];

    const operation = kv.atomic();
    operation.delete(joinTableKey);

    const result = await operation.commit();
    return result.ok;
  } catch (error) {
    console.error("Failed to delete many-to-many relation:", error);
    return false;
  }
};
