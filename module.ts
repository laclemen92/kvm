/**
 * @module
 *
 * Provides a way to interact with data in DenoKV.
 * Define a KVMEntity and then use it to perform CRUD
 * operations in DenoKv. KVMEntity has a zod schema
 * in order to validate data being stored!
 *
 * @example
 * ```ts
 * import { create, KVMEntity, ValueType } from "@laclemen92/kvm";
 * import { z } from "zod";
 *
 * const userSchema = z.object({
 *    id: z.string(),
 *    email: z.string().email("Invalid email format"),
 *    age: z.number(),
 *    sessionId: z.string(),
 *  }).strict();
 * export const userEntity: KVMEntity<typeof userSchema.shape> = {
 *    primaryKey: [{
 *      name: "users",
 *      key: "id",
 *    }],
 *    secondaryIndexes: [{
 *      key: [{
 *        name: "users_by_email",
 *        key: "email",
 *       }],
 *      valueType: ValueType.KEY,
 *      valueKey: "id",
 *    }, {
 *      key: [{
 *        name: "users_by_session",
 *        key: "sessionId",
 *      }],
 *      valueType: ValueType.KEY,
 *      valueKey: "id",
 *    }],
 *    schema: userSchema,
 *    name: "users",
 *  };
 * type User = z.infer<typeof userEntity.schema>;
 *
 * const kv = await Deno.openKv();
 *
 * const user = await create<User>(userEntity, kv, {
 *    id: "user1",
 *    email: "test@test.com",
 *    age: 31,
 *    sessionId: "123"
 * });
 * ```
 */

export * from "./lib/create.ts";
export * from "./lib/delete.ts";
export * from "./lib/find.ts";
export * from "./lib/update.ts";
export * from "./lib/types.ts";

export type { ZodObject, ZodRawShape } from "zod";