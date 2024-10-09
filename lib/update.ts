import { ValueType } from "./types.ts";
import type { KVMEntity, SecondaryIndex } from "./types.ts";
import { buildPrimaryKey } from "./utils.ts";
import { findUnique } from "./find.ts";

/**
 * Update a record in DenoKv
 *
 * @param entity The entity to update
 * @param kv The DenoKv instance for this connection
 * @param id The id of the record to update
 * @param value The value to update the record with
 * @param options Options for the update
 * @returns
 */
export const update = async <T = unknown>(
  entity: KVMEntity,
  kv: Deno.Kv,
  id: Deno.KvKeyPart,
  value: Partial<T>,
  options?: { expireIn?: number; onlyChangedFields?: boolean },
): Promise<Deno.KvEntryMaybe<T> | null> => {
  // do logic here to do all the setting for us
  // should it matter if it is an update or create? yea it does cause if it is an update, we can spread
  const pk: Deno.KvKey = buildPrimaryKey(entity.primaryKey, id);
  let valueToUpdate = value;

  const currentValue = await findUnique<T>(entity, kv, id);

  if (!currentValue?.value) {
    throw new Error("Record not found");
  }

  if (options?.onlyChangedFields) {
    // get the current value
    valueToUpdate = {
      ...currentValue?.value,
      ...value,
    };
  }

  const operation = kv.atomic();
  operation.set(pk, valueToUpdate, options);

  if (entity.secondaryIndexes) {
    entity.secondaryIndexes.forEach((secondaryIndexDef: SecondaryIndex) => {
      if (secondaryIndexDef.valueType === ValueType.VALUE) {
        const secondaryIndex: Deno.KvKey = buildPrimaryKey(
          secondaryIndexDef.key,
          valueToUpdate,
        );

        operation.set(secondaryIndex, valueToUpdate, options);
      }
    });
  }

  const opRes = await operation.commit();

  if (!opRes.ok) {
    throw new Error("Record could not be updated");
  }

  return await findUnique<T>(entity, kv, id);
};

/**
 * Pass an array of updates to perform multiple updates at once.
 * Returns an array of updated records.
 *
 * @param entity The entity to perform the update on
 * @param kv The kv instance for the update
 * @param updateObjects An array of update objects
 * @returns
 */
export const updateMany = async <T = unknown>(
  entity: KVMEntity,
  kv: Deno.Kv,
  updateObjects: {
    id: Deno.KvKeyPart;
    value: Partial<T>;
    options?: { expireIn?: number; onlyChangedFields?: boolean };
  }[],
): Promise<(Deno.KvEntryMaybe<T> | null)[]> => {
  const results = [];

  for await (const updateObj of updateObjects) {
    results.push(
      await update<T>(
        entity,
        kv,
        updateObj.id,
        updateObj.value,
        updateObj.options,
      ),
    );
  }

  return results;
};
