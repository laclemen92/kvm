import {
  buildPrimaryKey,
  isDenoKvKeyPart,
  isStringKeyedValueObject,
} from "./utils.ts";
import { ValueType } from "./types.ts";
import type { KVMEntity, Relation, SecondaryIndex } from "./types.ts";
import { findUnique } from "./find.ts";

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
  options?: { expireIn?: number },
): Promise<Deno.KvEntryMaybe<T> | null> => {
  // do logic here to do all the setting for us
  // should it matter if it is an update or create? yea it does cause if it is an update, we can spread

  // first check that the schema and value are good to go
  // const result = entity.schema.parse(value);
  const pk: Deno.KvKey = buildPrimaryKey(entity.primaryKey, value);
  const operation = kv.atomic();
  const checks = [];
  const sets = [];

  checks.push({ key: pk, versionstamp: null });
  sets.push({ key: pk, value, options });

  if (entity.secondaryIndexes) {
    entity.secondaryIndexes.forEach((secondaryIndexDef: SecondaryIndex) => {
      const secondaryIndex: Deno.KvKey = buildPrimaryKey(
        secondaryIndexDef.key,
        value,
      );
      // }

      checks.push({ key: secondaryIndex, versionstamp: null });

      if (
        secondaryIndexDef.valueType === ValueType.KEY &&
        secondaryIndexDef.valueKey &&
        isStringKeyedValueObject(value)
      ) {
        sets.push({
          key: secondaryIndex,
          value: value[secondaryIndexDef.valueKey],
        });
      } else {
        sets.push({ key: secondaryIndex, value });
      }
    });
  }

  if (entity.relations) {
    // in example when a comment is written. We want to also write it to the post
    // [ "posts", "postId1", "comments", "id" ]
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

        checks.push({ key: relationKey, versionstamp: null });
        if (relation.valueType === ValueType.KEY && relation.valueKey) {
          sets.push({ key: relationKey, value: value[relation.valueKey] });
        } else {
          sets.push({ key: relationKey, value });
        }
      }
    });
  }

  checks.forEach((checkParams) => {
    operation.check(checkParams);
  });
  sets.forEach((setParams) => {
    const { key, value, options } = setParams;
    operation.set(key, value, options);
  });

  try {
    const res = await operation.commit();
    if (!res.ok) {
      throw new Error(`Failed to create ${entity.name}`);
    }
    // return res;

    let findKey: Deno.KvKey | Deno.KvKeyPart | null = null;
    if (entity.primaryKey[0].key && isStringKeyedValueObject(value)) {
      findKey = value[entity.primaryKey[0].key];
    } else if (isDenoKvKeyPart(value)) {
      findKey = value;
    }
    if (!findKey) {
      throw new Error("couldn't find key");
    }
    const created = await findUnique<T>(entity, kv, findKey);
    return created;
  } catch (e) {
    console.error(e);
    return null;
  }
};