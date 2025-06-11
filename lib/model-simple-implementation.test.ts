import { assertEquals, assertInstanceOf } from "https://deno.land/std@0.220.0/assert/mod.ts";
import { createModelClass } from "./model.ts";
import type { KVMEntity } from "./types.ts";
import { ValueType } from "./types.ts";
import { z } from "zod";

// Simple test entity
const userSchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string().email(),
  age: z.number().optional(),
});

const userEntity: KVMEntity = {
  name: "users",
  primaryKey: [
    { name: "users", key: "id" },
  ],
  secondaryIndexes: [
    {
      name: "users_by_email",
      key: [{ name: "users_by_email", key: "email" }],
      valueType: ValueType.KEY,
      valueKey: "id",
    },
  ],
  relations: [],
  schema: userSchema,
};

Deno.test("Model Implementation - Basic Operations", async (t) => {
  await t.step("should create and retrieve document", async () => {
    const kv = await Deno.openKv(":memory:");
    const UserModel = createModelClass("users", userEntity, kv);
    
    // Create document
    const user = await UserModel.create({
      id: "1",
      name: "John",
      email: "john@example.com",
      age: 30,
    });
    
    assertEquals(user.name, "John");
    assertEquals(user.email, "john@example.com");
    assertEquals(user.age, 30);
    
    // Find by ID
    const found = await UserModel.findById("1");
    assertEquals(found?.name, "John");
    
    await kv.close();
  });

  await t.step("should update document using save", async () => {
    const kv = await Deno.openKv(":memory:");
    const UserModel = createModelClass("users", userEntity, kv);
    
    // Create document
    const user = await UserModel.create({
      id: "1",
      name: "John",
      email: "john@example.com",
      age: 30,
    });
    
    // Modify and save
    user.name = "John Updated";
    user.age = 31;
    await user.save();
    
    // Verify update
    const found = await UserModel.findById("1");
    assertEquals(found?.name, "John Updated");
    assertEquals(found?.age, 31);
    
    await kv.close();
  });

  await t.step("should update document using instance update", async () => {
    const kv = await Deno.openKv(":memory:");
    const UserModel = createModelClass("users", userEntity, kv);
    
    // Create document
    const user = await UserModel.create({
      id: "1",
      name: "John",
      email: "john@example.com",
      age: 30,
    });
    
    // Update using instance method
    await user.update({
      name: "John Modified",
      age: 32,
    });
    
    assertEquals(user.name, "John Modified");
    assertEquals(user.age, 32);
    
    await kv.close();
  });

  await t.step("should delete document", async () => {
    const kv = await Deno.openKv(":memory:");
    const UserModel = createModelClass("users", userEntity, kv);
    
    // Create document
    const user = await UserModel.create({
      id: "1",
      name: "John",
      email: "john@example.com",
    });
    
    // Delete
    await user.delete();
    
    // Verify deletion
    const found = await UserModel.findById("1");
    assertEquals(found, null);
    
    await kv.close();
  });

  await t.step("should reload document", async () => {
    const kv = await Deno.openKv(":memory:");
    const UserModel = createModelClass("users", userEntity, kv);
    
    // Create document
    const user = await UserModel.create({
      id: "1",
      name: "John",
      email: "john@example.com",
      age: 30,
    });
    
    // Update via different instance
    const otherUser = await UserModel.findById("1");
    await otherUser!.update({ name: "Updated Externally" });
    
    // Reload original instance
    await user.reload();
    assertEquals(user.name, "Updated Externally");
    
    await kv.close();
  });
});

Deno.test("Model Implementation - Static Methods", async (t) => {
  await t.step("should update document via static method", async () => {
    const kv = await Deno.openKv(":memory:");
    const UserModel = createModelClass("users", userEntity, kv);
    
    // Create document
    await UserModel.create({
      id: "1",
      name: "John",
      email: "john@example.com",
      age: 30,
    });
    
    // Update via static method
    const updated = await UserModel.update("1", {
      name: "John Updated",
      age: 31,
    });
    
    assertEquals(updated?.name, "John Updated");
    assertEquals(updated?.age, 31);
    
    await kv.close();
  });

  await t.step("should find many documents", async () => {
    const kv = await Deno.openKv(":memory:");
    const UserModel = createModelClass("users", userEntity, kv);
    
    // Create multiple documents
    await UserModel.create({ id: "1", name: "John", email: "john@example.com" });
    await UserModel.create({ id: "2", name: "Jane", email: "jane@example.com" });
    
    const users = await UserModel.findMany();
    assertEquals(users.length, 2);
    
    await kv.close();
  });

  await t.step("should find first document", async () => {
    const kv = await Deno.openKv(":memory:");
    const UserModel = createModelClass("users", userEntity, kv);
    
    // Create document
    await UserModel.create({ id: "1", name: "John", email: "john@example.com" });
    
    const first = await UserModel.findFirst();
    assertEquals(first?.name, "John");
    
    await kv.close();
  });

  await t.step("should find by secondary index", async () => {
    const kv = await Deno.openKv(":memory:");
    const UserModel = createModelClass("users", userEntity, kv);
    
    // Create document
    await UserModel.create({
      id: "1",
      name: "John",
      email: "john@example.com",
    });
    
    const found = await UserModel.findUnique("john@example.com", "users_by_email");
    assertEquals(found?.name, "John");
    
    await kv.close();
  });

  await t.step("should handle batch operations", async () => {
    const kv = await Deno.openKv(":memory:");
    const UserModel = createModelClass("users", userEntity, kv);
    
    // Create documents
    await UserModel.create({ id: "1", name: "John", email: "john@example.com" });
    await UserModel.create({ id: "2", name: "Jane", email: "jane@example.com" });
    
    // Batch update
    const result = await UserModel.updateMany([
      { key: "1", data: { name: "John Updated" } },
      { key: "2", data: { name: "Jane Updated" } },
    ]);
    
    assertEquals(result.updated.length, 2);
    assertEquals(result.updated[0].name, "John Updated");
    
    await kv.close();
  });
});

Deno.test("Model Implementation - List Operations", async (t) => {
  await t.step("should list documents", async () => {
    const kv = await Deno.openKv(":memory:");
    const UserModel = createModelClass("users", userEntity, kv);
    
    // Create documents
    await UserModel.create({ id: "1", name: "John", email: "john@example.com" });
    await UserModel.create({ id: "2", name: "Jane", email: "jane@example.com" });
    
    const result = await UserModel.list({ limit: 10 });
    assertEquals(result.data.length, 2);
    assertEquals(typeof result.hasMore, "boolean");
    
    await kv.close();
  });

  await t.step("should count documents", async () => {
    const kv = await Deno.openKv(":memory:");
    const UserModel = createModelClass("users", userEntity, kv);
    
    // Create documents
    await UserModel.create({ id: "1", name: "John", email: "john@example.com" });
    await UserModel.create({ id: "2", name: "Jane", email: "jane@example.com" });
    
    const count = await UserModel.count();
    assertEquals(count, 2);
    
    await kv.close();
  });
});

Deno.test("Model Implementation - Atomic Operations", async (t) => {
  await t.step("should get atomic utils", async () => {
    const kv = await Deno.openKv(":memory:");
    const UserModel = createModelClass("users", userEntity, kv);
    
    const utils = UserModel.atomicUtils();
    assertEquals(typeof utils, "object");
    assertEquals(typeof utils.incrementField, "function");
    
    await kv.close();
  });

  await t.step("should handle field counters", async () => {
    const kv = await Deno.openKv(":memory:");
    const UserModel = createModelClass("users", userEntity, kv);
    
    // Create document
    const user = await UserModel.create({
      id: "1",
      name: "John",
      email: "john@example.com",
      age: 30,
    });
    
    // Increment field
    await user.incrementField("age", 1);
    
    // Check counter value
    const counters = await user.getCounters();
    assertEquals(typeof counters, "object");
    
    await kv.close();
  });
});