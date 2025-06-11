import { assertEquals, assertExists } from "https://deno.land/std@0.220.0/assert/mod.ts";
import { createModelClass } from "./model.ts";
import type { KVMEntity } from "./types.ts";
import { z } from "zod";

const userSchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string(),
});

const userEntity: KVMEntity = {
  name: "test_users",
  primaryKey: [{ name: "test_users", key: "id" }],
  secondaryIndexes: [],
  relations: [],
  schema: userSchema,
};

Deno.test("Model Simple Coverage", async (t) => {
  await t.step("Model static properties", async () => {
    const kv = await Deno.openKv(":memory:");
    const UserModel = createModelClass("test_users", userEntity, kv);
    
    assertEquals(UserModel.modelName, "test_users");
    assertEquals(UserModel.entity, userEntity);
    assertEquals(UserModel.kv, kv);
    
    await kv.close();
  });

  await t.step("Model create and retrieve", async () => {
    const kv = await Deno.openKv(":memory:");
    const UserModel = createModelClass("test_users", userEntity, kv);
    
    const user = await UserModel.create({
      id: "user1",
      name: "John",
      email: "john@test.com",
    });
    
    assertEquals(user.id, "user1");
    assertEquals(user.name, "John");
    
    const found = await UserModel.findById("user1");
    assertEquals(found?.name, "John");
    
    await kv.close();
  });

  await t.step("Model update operations", async () => {
    const kv = await Deno.openKv(":memory:");
    const UserModel = createModelClass("test_users", userEntity, kv);
    
    const user = await UserModel.create({
      id: "user2",
      name: "Jane",
      email: "jane@test.com",
    });
    
    // Test instance update
    await user.update({ name: "Jane Updated" });
    assertEquals(user.name, "Jane Updated");
    
    // Test static update
    await UserModel.update("user2", { name: "Jane Static" });
    
    // Test reload
    await user.reload();
    assertEquals(user.name, "Jane Static");
    
    await kv.close();
  });

  await t.step("Model delete operations", async () => {
    const kv = await Deno.openKv(":memory:");
    const UserModel = createModelClass("test_users", userEntity, kv);
    
    const user = await UserModel.create({
      id: "user3",
      name: "ToDelete",
      email: "delete@test.com",
    });
    
    await user.delete();
    
    const found = await UserModel.findById("user3");
    assertEquals(found, null);
    
    await kv.close();
  });

  await t.step("Model query operations", async () => {
    const kv = await Deno.openKv(":memory:");
    const UserModel = createModelClass("test_users", userEntity, kv);
    
    for (let i = 1; i <= 3; i++) {
      await UserModel.create({
        id: `query${i}`,
        name: `User ${i}`,
        email: `user${i}@test.com`,
      });
    }
    
    const many = await UserModel.findMany();
    assertEquals(many.length, 3);
    
    const first = await UserModel.findFirst();
    assertExists(first);
    
    const count = await UserModel.count();
    assertEquals(count, 3);
    
    await kv.close();
  });

  await t.step("Model list operations", async () => {
    const kv = await Deno.openKv(":memory:");
    const UserModel = createModelClass("test_users", userEntity, kv);
    
    await UserModel.create({
      id: "list1",
      name: "List User",
      email: "list@test.com",
    });
    
    const results = await UserModel.listByPrefix(["test_users"]);
    assertEquals(results.data.length >= 1, true);
    
    await kv.close();
  });

  await t.step("Model hooks and utilities", async () => {
    const kv = await Deno.openKv(":memory:");
    const UserModel = createModelClass("test_users", userEntity, kv);
    
    // Test hooks enabled/disabled
    UserModel.setHooksEnabled(false);
    assertEquals(UserModel.areHooksEnabled(), false);
    
    UserModel.setHooksEnabled(true);
    assertEquals(UserModel.areHooksEnabled(), true);
    
    // Test internal build key method
    const key = (UserModel as any)._buildPrimaryKey({ id: "test" });
    assertEquals(key, ["test_users", "test"]);
    
    // Test query builder
    const qb = UserModel.query();
    assertExists(qb);
    
    await kv.close();
  });

  await t.step("Model batch operations", async () => {
    const kv = await Deno.openKv(":memory:");
    const UserModel = createModelClass("test_users", userEntity, kv);
    
    const users = await UserModel.createMany([
      { id: "batch1", name: "Batch 1", email: "batch1@test.com" },
      { id: "batch2", name: "Batch 2", email: "batch2@test.com" },
    ]);
    
    assertEquals(users.created.length, 2);
    
    await UserModel.updateMany([
      { key: "batch1", data: { name: "Updated Batch 1" } },
    ]);
    
    await UserModel.deleteMany([
      { key: "batch1" },
      { key: "batch2" },
    ]);
    
    await kv.close();
  });
});