import { RelationType, ValueType } from "./types.ts";
import type {
  KVMEntity,
  Relation,
  SecondaryIndex,
  StringKeyedValueObject,
} from "./types.ts";
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
  id: Deno.KvKeyPart | StringKeyedValueObject,
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

  // Validate the final value against the schema
  entity.schema.parse(valueToUpdate);

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

  // Handle relation updates when foreign keys change
  if (entity.relations && currentValue.value) {
    await _handleRelationUpdates(
      kv,
      operation,
      entity,
      currentValue.value as StringKeyedValueObject,
      valueToUpdate as StringKeyedValueObject,
      pk,
    );
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

/**
 * Handle relation updates when foreign keys change
 */
async function _handleRelationUpdates(
  kv: Deno.Kv,
  operation: Deno.AtomicOperation,
  entity: KVMEntity,
  oldValue: StringKeyedValueObject,
  newValue: StringKeyedValueObject,
  pk: Deno.KvKey,
): Promise<void> {
  if (!entity.relations) return;

  for (const relation of entity.relations) {
    switch (relation.type) {
      case RelationType.ONE_TO_MANY:
      case "one-to-many" as any: // Backward compatibility
        await _handleOneToManyUpdate(
          operation,
          relation,
          oldValue,
          newValue,
          pk,
        );
        break;

      case RelationType.BELONGS_TO:
        // For belongsTo, the foreign key is in this entity
        // If the foreign key changes, we may need to update parent references
        await _handleBelongsToUpdate(
          kv,
          operation,
          relation,
          oldValue,
          newValue,
          pk,
        );
        break;

      case RelationType.MANY_TO_MANY:
        // For many-to-many, we need to update join table entries
        if (relation.through) {
          await _handleManyToManyUpdate(
            kv,
            operation,
            relation,
            oldValue,
            newValue,
          );
        }
        break;
    }
  }
}

/**
 * Handle one-to-many relation updates
 */
async function _handleOneToManyUpdate(
  operation: Deno.AtomicOperation,
  relation: Relation,
  oldValue: StringKeyedValueObject,
  newValue: StringKeyedValueObject,
  pk: Deno.KvKey,
): Promise<void> {
  // Check if any of the relation fields have changed
  const fieldsChanged = relation.fields.some((field) =>
    oldValue[field] !== newValue[field]
  );

  if (fieldsChanged) {
    // Delete old relation key
    const oldRelationKey = [
      relation.entityName,
      ...relation.fields.map((field) => oldValue[field]),
      ...pk,
    ];
    operation.delete(oldRelationKey);

    // Create new relation key
    const newRelationKey = [
      relation.entityName,
      ...relation.fields.map((field) => newValue[field]),
      ...pk,
    ];

    if (relation.valueType === ValueType.KEY && relation.valueKey) {
      operation.set(newRelationKey, newValue[relation.valueKey]);
    } else {
      operation.set(newRelationKey, newValue);
    }
  }
}

/**
 * Handle belongsTo relation updates
 */
async function _handleBelongsToUpdate(
  kv: Deno.Kv,
  operation: Deno.AtomicOperation,
  relation: Relation,
  oldValue: StringKeyedValueObject,
  newValue: StringKeyedValueObject,
  pk: Deno.KvKey,
): Promise<void> {
  // Check if the foreign key has changed
  const foreignKeyField = relation.foreignKey || relation.fields[0];
  const oldForeignKey = oldValue[foreignKeyField];
  const newForeignKey = newValue[foreignKeyField];

  if (oldForeignKey !== newForeignKey) {
    // The belongsTo relationship has changed
    // In most cases, we don't need to update anything in the parent entity
    // The foreign key change is enough

    // However, if there are inverse relations or caches to update,
    // this is where we would handle them
    console.log(
      `belongsTo relation updated: ${foreignKeyField} changed from ${oldForeignKey} to ${newForeignKey}`,
    );
  }
}

/**
 * Handle many-to-many relation updates
 */
async function _handleManyToManyUpdate(
  kv: Deno.Kv,
  operation: Deno.AtomicOperation,
  relation: Relation,
  oldValue: StringKeyedValueObject,
  newValue: StringKeyedValueObject,
): Promise<void> {
  // For many-to-many relations, we typically don't update join table entries
  // during entity updates unless specific fields that are part of the relation change

  // Check if any relation fields have changed
  const fieldsChanged = relation.fields.some((field) =>
    oldValue[field] !== newValue[field]
  );

  if (fieldsChanged) {
    // This would be a complex scenario where the entity's ID changes
    // In most cases, primary keys shouldn't change, but if they do,
    // we'd need to update all join table entries

    const oldId = oldValue.id || oldValue[relation.fields[0]];
    const newId = newValue.id || newValue[relation.fields[0]];

    if (oldId !== newId) {
      console.warn(
        `Many-to-many relation field changed from ${oldId} to ${newId}. Manual join table updates may be required.`,
      );
    }
  }
}
