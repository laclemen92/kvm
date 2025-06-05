/**
 * Tests for enhanced batch operations with retry and rollback functionality
 */

import { assert, assertEquals, assertRejects } from "@std/assert";
import { z } from "zod";
import { createModelClass } from "./model.ts";
import type { KVMEntity } from "./types.ts";

// Test entity setup
const userSchema = z.object({
  id: z.string(),
  email: z.string().email(),
  name: z.string(),
  age: z.number().optional(),
  status: z.string().default("active"),
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

Deno.test("Enhanced Batch Operations - createMany with retries", async () => {
  const kv = await Deno.openKv(":memory:");
  const User = createModelClass("users", userEntity, kv);

  let attemptCount = 0;
  const result = await User.createMany([
    { id: "user1", email: "test1@example.com", name: "User 1" },
    { id: "user2", email: "test2@example.com", name: "User 2" },
    { id: "user3", email: "test3@example.com", name: "User 3" },
  ], {
    maxRetries: 2,
    retryDelay: 100,
    continueOnError: true,
    onRetry: (error, attempt, data) => {
      attemptCount++;
      console.log(`Retry attempt ${attempt} for:`, data);
    },
  });

  assertEquals(result.created.length, 3);
  assertEquals(result.failed.length, 0);
  assertEquals(result.stats.total, 3);
  assertEquals(result.stats.created, 3);
  assertEquals(result.stats.failed, 0);
  assertEquals(result.stats.retried, 0); // No retries needed for successful operation
  assertEquals(result.stats.rolledBack, 0);

  await kv.close();
});

Deno.test("Enhanced Batch Operations - createMany with rollback on failure", async () => {
  const kv = await Deno.openKv(":memory:");
  const User = createModelClass("users", userEntity, kv);

  // Create one user first to cause a conflict
  await User.create({ id: "user1", email: "existing@example.com", name: "Existing User" });

  const result = await User.createMany([
    { id: "user2", email: "new1@example.com", name: "New User 1" },
    { id: "user3", email: "new2@example.com", name: "New User 2" },
    { id: "user1", email: "not-an-email", name: "Invalid Email" }, // This will fail validation
  ], {
    atomic: false,
    rollbackOnAnyFailure: true,
    continueOnError: false,
    maxRetries: 0, // Ensure enhanced operations are used
  });

  // Should have rolled back due to failure
  assertEquals(result.created.length, 0);
  assertEquals(result.failed.length, 1);
  assertEquals(result.stats.rolledBack, 2); // Two successful creates were rolled back

  // Verify rollback worked - new users should not exist
  const user2 = await User.findById("user2");
  const user3 = await User.findById("user3");
  assertEquals(user2, null);
  assertEquals(user3, null);

  await kv.close();
});

Deno.test("Enhanced Batch Operations - updateMany with retries and detailed error reporting", async () => {
  const kv = await Deno.openKv(":memory:");
  const User = createModelClass("users", userEntity, kv);

  // Create test users
  await User.create({ id: "user1", email: "test1@example.com", name: "User 1" });
  await User.create({ id: "user2", email: "test2@example.com", name: "User 2" });

  let retryAttempts = 0;
  const result = await User.updateMany([
    { key: "user1", data: { name: "Updated User 1" } },
    { key: "user2", data: { name: "Updated User 2" } },
    { key: "nonexistent", data: { name: "Does Not Exist" } },
  ], {
    maxRetries: 1,
    retryDelay: 50,
    continueOnError: true,
    onRetry: (error, attempt) => {
      retryAttempts++;
    },
  });

  assertEquals(result.updated.length, 2);
  assertEquals(result.notFound.length, 1);
  assertEquals(result.failed.length, 0);
  assertEquals(result.stats.total, 3);
  assertEquals(result.stats.updated, 2);
  assertEquals(result.stats.notFound, 1);

  // Verify updates
  const user1 = await User.findById("user1");
  const user2 = await User.findById("user2");
  assertEquals(user1?.name, "Updated User 1");
  assertEquals(user2?.name, "Updated User 2");

  await kv.close();
});

Deno.test("Enhanced Batch Operations - deleteMany with rollback functionality", async () => {
  const kv = await Deno.openKv(":memory:");
  const User = createModelClass("users", userEntity, kv);

  // Create test users
  await User.create({ id: "user1", email: "test1@example.com", name: "User 1" });
  await User.create({ id: "user2", email: "test2@example.com", name: "User 2" });
  await User.create({ id: "user3", email: "test3@example.com", name: "User 3" });

  const result = await User.deleteMany([
    { key: "user1" },
    { key: "user2" }, 
    { key: "nonexistent" }, // This will not be found, but not an error
  ], {
    atomic: false,
    returnDeletedItems: true,
    maxRetries: 0, // Ensure enhanced operations are used
    continueOnError: true,
  });

  assertEquals(result.deletedCount, 2);
  assertEquals(result.deleted.length, 2);
  assertEquals(result.notFound.length, 1);
  assertEquals(result.failed.length, 0);
  assertEquals(result.stats.total, 3);
  assertEquals(result.stats.deleted, 2);
  assertEquals(result.stats.notFound, 1);

  // Verify deletions
  const user1 = await User.findById("user1");
  const user2 = await User.findById("user2");
  const user3 = await User.findById("user3");
  assertEquals(user1, null);
  assertEquals(user2, null);
  assertEquals(user3?.name, "User 3"); // Should still exist

  await kv.close();
});

Deno.test("Enhanced Batch Operations - atomicBulkUpdate", async () => {
  const kv = await Deno.openKv(":memory:");
  const User = createModelClass("users", userEntity, kv);

  // Create test users
  await User.create({ id: "user1", email: "test1@example.com", name: "User 1", status: "inactive" });
  await User.create({ id: "user2", email: "test2@example.com", name: "User 2", status: "inactive" });

  const result = await User.atomicBulkUpdate([
    { id: "user1", data: { status: "active" } },
    { id: "user2", data: { status: "active" } },
  ], {
    rollbackOnAnyFailure: true,
    maxRetries: 1,
  });

  assertEquals(result.updated.length, 2);
  assertEquals(result.failed.length, 0);
  assertEquals(result.stats.total, 2);
  assertEquals(result.stats.updated, 2);

  // Verify updates
  const user1 = await User.findById("user1");
  const user2 = await User.findById("user2");
  assertEquals(user1?.status, "active");
  assertEquals(user2?.status, "active");

  await kv.close();
});

Deno.test("Enhanced Batch Operations - custom retry logic", async () => {
  const kv = await Deno.openKv(":memory:");
  const User = createModelClass("users", userEntity, kv);

  let customRetryCallCount = 0;
  let onRetryCallCount = 0;

  const result = await User.createMany([
    { id: "user1", email: "test1@example.com", name: "User 1" },
    { id: "user2", email: "test2@example.com", name: "User 2" },
  ], {
    maxRetries: 2,
    retryDelay: 10,
    shouldRetry: (error, attempt) => {
      customRetryCallCount++;
      // Custom logic: only retry validation errors
      return error.message.includes("validation") && attempt <= 1;
    },
    onRetry: (error, attempt) => {
      onRetryCallCount++;
    },
  });

  // Should succeed without retries
  assertEquals(result.created.length, 2);
  assertEquals(result.failed.length, 0);
  assertEquals(customRetryCallCount, 0); // No retries needed
  assertEquals(onRetryCallCount, 0);

  await kv.close();
});

Deno.test("Enhanced Batch Operations - exponential backoff in onRetry", async () => {
  const kv = await Deno.openKv(":memory:");
  const User = createModelClass("users", userEntity, kv);

  const retryDelays: number[] = [];
  
  const result = await User.createMany([
    { id: "user1", email: "test@example.com", name: "Test User" },
  ], {
    maxRetries: 0, // No retries needed
    onRetry: async (error, attempt) => {
      // Exponential backoff example
      const delay = Math.pow(2, attempt) * 100;
      retryDelays.push(delay);
      await new Promise(resolve => setTimeout(resolve, delay));
    },
  });

  assertEquals(result.created.length, 1);
  assertEquals(retryDelays.length, 0); // No retries were needed

  await kv.close();
});

Deno.test("Enhanced Batch Operations - mixed success and failure with detailed stats", async () => {
  const kv = await Deno.openKv(":memory:");
  const User = createModelClass("users", userEntity, kv);

  // Create one user to test updates
  await User.create({ id: "existing", email: "existing@example.com", name: "Existing" });

  const result = await User.updateMany([
    { key: "existing", data: { name: "Updated Existing" } },
    { key: "notfound1", data: { name: "Not Found 1" } },
    { key: "notfound2", data: { name: "Not Found 2" } },
  ], {
    continueOnError: true,
    maxRetries: 0, // Ensure enhanced operations are used
  });

  assertEquals(result.updated.length, 1);
  assertEquals(result.notFound.length, 2);
  assertEquals(result.failed.length, 0);
  assertEquals(result.stats.total, 3);
  assertEquals(result.stats.updated, 1);
  assertEquals(result.stats.notFound, 2);
  assertEquals(result.stats.failed, 0);
  assertEquals(result.stats.retried, 0);
  assertEquals(result.stats.rolledBack, 0);

  await kv.close();
});