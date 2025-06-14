/**
 * Tests for upsert operations
 */

import { type assert, assertEquals, assertRejects } from "@std/assert";
import { z } from "zod";
import { createModelClass } from "./model.ts";
import type { KVMEntity } from "./types.ts";

// Test entity setup
const userSchema = z.object({
  id: z.string(),
  email: z.string().email(),
  name: z.string(),
  age: z.number().optional(),
  updatedCount: z.number().default(0),
});

const userEntity: KVMEntity = {
  name: "users",
  primaryKey: [{ name: "users", key: "id" }],
  secondaryIndexes: [
    {
      name: "email",
      key: [{ name: "users_by_email", key: "email" }],
    },
  ],
  schema: userSchema,
};

Deno.test("Upsert Operations - static update by ID", async () => {
  const kv = await Deno.openKv(":memory:");
  const User = createModelClass("users", userEntity, kv);

  // Create a user first
  const created = await User.create({
    id: "user1",
    email: "test@example.com",
    name: "John Doe",
    age: 30,
  });

  assertEquals(created.name, "John Doe");
  assertEquals(created.age, 30);

  // Update the user using static update method
  const updated = await User.update("user1", {
    name: "John Updated",
    age: 31,
  });

  assertEquals(updated.name, "John Updated");
  assertEquals(updated.age, 31);
  assertEquals(updated.email, "test@example.com"); // Should remain unchanged

  // Verify the update persisted
  const found = await User.findById("user1");
  assertEquals(found?.name, "John Updated");
  assertEquals(found?.age, 31);

  await kv.close();
});

Deno.test("Upsert Operations - static update by ID throws when not found", async () => {
  const kv = await Deno.openKv(":memory:");
  const User = createModelClass("users", userEntity, kv);

  // Try to update non-existent user
  await assertRejects(
    () => User.update("nonexistent", { name: "Test" }),
    Error,
    "users not found by id: nonexistent",
  );

  await kv.close();
});

Deno.test("Upsert Operations - upsert creates when not found", async () => {
  const kv = await Deno.openKv(":memory:");
  const User = createModelClass("users", userEntity, kv);

  // Upsert with email criteria (user doesn't exist)
  const result = await User.upsert(
    { email: "new@example.com" }, // find criteria
    { name: "Updated Name", age: 25 }, // update data (won't be used)
    { id: "user1", email: "new@example.com", name: "New User", age: 30 }, // create data
  );

  assertEquals(result.name, "New User");
  assertEquals(result.age, 30);
  assertEquals(result.email, "new@example.com");

  // Verify it was created
  const found = await User.findById("user1");
  assertEquals(found?.name, "New User");

  await kv.close();
});

Deno.test("Upsert Operations - upsert updates when found by email", async () => {
  const kv = await Deno.openKv(":memory:");
  const User = createModelClass("users", userEntity, kv);

  // Create a user first
  await User.create({
    id: "user1",
    email: "existing@example.com",
    name: "Original Name",
    age: 25,
    updatedCount: 0,
  });

  // Upsert with email criteria (user exists)
  const result = await User.upsert(
    { email: "existing@example.com" }, // find criteria
    { name: "Updated Name", updatedCount: 1 }, // update data
    {
      id: "user2",
      email: "existing@example.com",
      name: "Would Create",
      age: 99,
    }, // create data (won't be used)
  );

  assertEquals(result.name, "Updated Name");
  assertEquals(result.updatedCount, 1);
  assertEquals(result.email, "existing@example.com");
  assertEquals(result.id, "user1"); // Should keep original ID

  // Verify no duplicate was created
  const allUsers = await User.findMany();
  assertEquals(allUsers.length, 1);

  await kv.close();
});

Deno.test("Upsert Operations - upsert by primary key", async () => {
  const kv = await Deno.openKv(":memory:");
  const User = createModelClass("users", userEntity, kv);

  // Create a user first
  await User.create({
    id: "user1",
    email: "test@example.com",
    name: "Original",
    age: 25,
  });

  // Upsert by ID (should update)
  const result = await User.upsert(
    { id: "user1" }, // find by primary key
    { name: "Updated via ID", age: 26 }, // update data
    { id: "user1", email: "test@example.com", name: "Would Create", age: 99 }, // create data (won't be used)
  );

  assertEquals(result.name, "Updated via ID");
  assertEquals(result.age, 26);

  await kv.close();
});

Deno.test("Upsert Operations - upsertMany creates and updates", async () => {
  const kv = await Deno.openKv(":memory:");
  const User = createModelClass("users", userEntity, kv);

  // Create one user that will be updated
  await User.create({
    id: "existing",
    email: "existing@example.com",
    name: "Will Be Updated",
    age: 20,
  });

  // Perform batch upsert
  const result = await User.upsertMany([
    {
      findCriteria: { email: "existing@example.com" },
      updateData: { name: "Updated Name", age: 21 },
      createData: {
        id: "existing",
        email: "existing@example.com",
        name: "Updated Name",
        age: 21,
      },
    },
    {
      findCriteria: { email: "new1@example.com" },
      updateData: { name: "Won't be used" },
      createData: {
        id: "new1",
        email: "new1@example.com",
        name: "New User 1",
        age: 25,
      },
    },
    {
      findCriteria: { email: "new2@example.com" },
      updateData: { name: "Won't be used" },
      createData: {
        id: "new2",
        email: "new2@example.com",
        name: "New User 2",
        age: 30,
      },
    },
  ]);

  assertEquals(result.created.length, 3);
  assertEquals(result.failed.length, 0);
  assertEquals(result.stats.total, 3);
  assertEquals(result.stats.created, 3);
  assertEquals(result.stats.failed, 0);

  // Verify the results
  const allUsers = await User.findMany();
  assertEquals(allUsers.length, 3);

  const existing = await User.findById("existing");
  assertEquals(existing?.name, "Updated Name");
  assertEquals(existing?.age, 21);

  const new1 = await User.findById("new1");
  assertEquals(new1?.name, "New User 1");

  const new2 = await User.findById("new2");
  assertEquals(new2?.name, "New User 2");

  await kv.close();
});

Deno.test("Upsert Operations - upsertMany with errors and continueOnError", async () => {
  const kv = await Deno.openKv(":memory:");
  const User = createModelClass("users", userEntity, kv);

  // Perform batch upsert with one invalid operation
  const result = await User.upsertMany([
    {
      findCriteria: { email: "valid@example.com" },
      updateData: { name: "Valid User" },
      createData: {
        id: "valid",
        email: "valid@example.com",
        name: "Valid User",
        age: 25,
      },
    },
    {
      findCriteria: { email: "invalid@example.com" },
      updateData: { name: "Invalid User" },
      createData: {
        id: "invalid",
        email: "not-an-email",
        name: "Invalid",
        age: 25,
      }, // Invalid email
    },
  ], { continueOnError: true });

  assertEquals(result.created.length, 1);
  assertEquals(result.failed.length, 1);
  assertEquals(result.stats.total, 2);
  assertEquals(result.stats.created, 1);
  assertEquals(result.stats.failed, 1);

  // Check that the valid one was created
  const valid = await User.findById("valid");
  assertEquals(valid?.name, "Valid User");

  await kv.close();
});

Deno.test("Upsert Operations - upsert by multiple criteria", async () => {
  const kv = await Deno.openKv(":memory:");
  const User = createModelClass("users", userEntity, kv);

  // Create a user
  await User.create({
    id: "user1",
    email: "test@example.com",
    name: "John Doe",
    age: 30,
  });

  // Upsert by multiple criteria (should find and update)
  const result = await User.upsert(
    { name: "John Doe", age: 30 }, // find by multiple fields
    { name: "John Updated" }, // update data
    { id: "user2", email: "test2@example.com", name: "John New", age: 30 }, // create data (won't be used)
  );

  assertEquals(result.name, "John Updated");
  assertEquals(result.age, 30);
  assertEquals(result.id, "user1");

  // Verify only one user exists
  const allUsers = await User.findMany();
  assertEquals(allUsers.length, 1);

  await kv.close();
});
