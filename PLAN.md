### What to build?

- typeorm or prisma or vogels but for deno kv
- define an entity
- define the pk, secondary index(?)es(?)
- use zod to create the schema
- have dependencies (onDelete, onUpdate, onCreate)
- add some easy way to add createdAt, updatedAt automatically
- support creating a ulid id
- KVM_PATH, KVM_AUTH, etc. or just piggy back off the ones deno.openKV already
  uses

```js
/**
 * findUnique - returns the object or null if not found
 * findUniqueOrThrow - non-null return type. Returns or throws ex. NotFoundError: No User found error
 * findMany - Retruns an array of the object or an empty array
 * findFirst - returns the object or null if not found. Same logic as findMany, so really just call findMany()[0] to implement
 * findFirstOrThrow - same idea as findUniqueOrThrow
 * update - returns the updated object or throws a RecordNotFound exception
 * updateMany
 * upsert - returns the object
 * delete - returns the deleted record or recordNotFound exception thrown if it can't be found
 * deleteMany
 * create - returns the created object
 * createMany -
 * createManyAndReturn -
 * count -
 */
```