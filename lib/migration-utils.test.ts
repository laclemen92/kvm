import {
  assertEquals,
  assertRejects,
} from "https://deno.land/std@0.220.0/assert/mod.ts";
import { KVMMigrationUtils } from "./migration-utils.ts";

Deno.test("KVMMigrationUtils.addField", async () => {
  const kv = await Deno.openKv(":memory:");
  const utils = new KVMMigrationUtils(kv);

  // Add some test data
  await kv.set(["users", "1"], { id: "1", name: "John" });
  await kv.set(["users", "2"], { id: "2", name: "Jane" });
  await kv.set(["users", "3"], { id: "3", name: "Bob", age: 30 });

  // Add field
  await utils.addField("users", "age", 25);

  // Check results
  const user1 = await kv.get(["users", "1"]);
  assertEquals(user1.value, { id: "1", name: "John", age: 25 });

  const user2 = await kv.get(["users", "2"]);
  assertEquals(user2.value, { id: "2", name: "Jane", age: 25 });

  const user3 = await kv.get(["users", "3"]);
  assertEquals(user3.value, { id: "3", name: "Bob", age: 30 }); // Should not be overwritten

  await kv.close();
});

Deno.test("KVMMigrationUtils.removeField", async () => {
  const kv = await Deno.openKv(":memory:");
  const utils = new KVMMigrationUtils(kv);

  // Add test data
  await kv.set(["users", "1"], { id: "1", name: "John", age: 25 });
  await kv.set(["users", "2"], { id: "2", name: "Jane", age: 30 });
  await kv.set(["users", "3"], { id: "3", name: "Bob" });

  // Remove field
  await utils.removeField("users", "age");

  // Check results
  const user1 = await kv.get(["users", "1"]);
  assertEquals(user1.value, { id: "1", name: "John" });

  const user2 = await kv.get(["users", "2"]);
  assertEquals(user2.value, { id: "2", name: "Jane" });

  const user3 = await kv.get(["users", "3"]);
  assertEquals(user3.value, { id: "3", name: "Bob" });

  await kv.close();
});

Deno.test("KVMMigrationUtils.renameField", async () => {
  const kv = await Deno.openKv(":memory:");
  const utils = new KVMMigrationUtils(kv);

  // Add test data
  await kv.set(["users", "1"], { id: "1", username: "john123" });
  await kv.set(["users", "2"], { id: "2", username: "jane456" });
  await kv.set(["users", "3"], { id: "3", name: "Bob" });

  // Rename field
  await utils.renameField("users", "username", "name");

  // Check results
  const user1 = await kv.get(["users", "1"]);
  assertEquals(user1.value, { id: "1", name: "john123" });

  const user2 = await kv.get(["users", "2"]);
  assertEquals(user2.value, { id: "2", name: "jane456" });

  const user3 = await kv.get(["users", "3"]);
  assertEquals(user3.value, { id: "3", name: "Bob" }); // Should remain unchanged

  await kv.close();
});

Deno.test("KVMMigrationUtils.transformField", async () => {
  const kv = await Deno.openKv(":memory:");
  const utils = new KVMMigrationUtils(kv);

  // Add test data
  await kv.set(["users", "1"], { id: "1", name: "john", age: 25 });
  await kv.set(["users", "2"], { id: "2", name: "jane", age: 30 });
  await kv.set(["users", "3"], { id: "3", name: "bob" });

  // Transform field to uppercase
  await utils.transformField("users", "name", (value) => (value as string).toUpperCase());

  // Check results
  const user1 = await kv.get(["users", "1"]);
  assertEquals(user1.value, { id: "1", name: "JOHN", age: 25 });

  const user2 = await kv.get(["users", "2"]);
  assertEquals(user2.value, { id: "2", name: "JANE", age: 30 });

  const user3 = await kv.get(["users", "3"]);
  assertEquals(user3.value, { id: "3", name: "BOB" });

  await kv.close();
});

Deno.test("KVMMigrationUtils.copyEntity", async () => {
  const kv = await Deno.openKv(":memory:");
  const utils = new KVMMigrationUtils(kv);

  // Add test data
  await kv.set(["users", "1"], { id: "1", name: "John" });
  await kv.set(["users", "2"], { id: "2", name: "Jane" });
  await kv.set(["posts", "1"], { id: "1", title: "Post 1" });

  // Copy entity
  await utils.copyEntity("users", "customers");

  // Check original data still exists
  const user1 = await kv.get(["users", "1"]);
  assertEquals(user1.value, { id: "1", name: "John" });

  // Check copied data
  const customer1 = await kv.get(["customers", "1"]);
  assertEquals(customer1.value, { id: "1", name: "John" });

  const customer2 = await kv.get(["customers", "2"]);
  assertEquals(customer2.value, { id: "2", name: "Jane" });

  // Posts should not be copied
  const customerPost = await kv.get(["customers", "posts", "1"]);
  assertEquals(customerPost.value, null);

  await kv.close();
});

Deno.test("KVMMigrationUtils.renameEntity", async () => {
  const kv = await Deno.openKv(":memory:");
  const utils = new KVMMigrationUtils(kv);

  // Add test data
  await kv.set(["users", "1"], { id: "1", name: "John" });
  await kv.set(["users", "2"], { id: "2", name: "Jane" });

  // Rename entity
  await utils.renameEntity("users", "customers");

  // Check old entity is deleted
  const user1 = await kv.get(["users", "1"]);
  assertEquals(user1.value, null);

  // Check new entity exists
  const customer1 = await kv.get(["customers", "1"]);
  assertEquals(customer1.value, { id: "1", name: "John" });

  const customer2 = await kv.get(["customers", "2"]);
  assertEquals(customer2.value, { id: "2", name: "Jane" });

  await kv.close();
});

Deno.test("KVMMigrationUtils.truncateEntity", async () => {
  const kv = await Deno.openKv(":memory:");
  const utils = new KVMMigrationUtils(kv);

  // Add test data
  await kv.set(["users", "1"], { id: "1", name: "John" });
  await kv.set(["users", "2"], { id: "2", name: "Jane" });
  await kv.set(["posts", "1"], { id: "1", title: "Post 1" });

  // Truncate entity
  await utils.truncateEntity("users");

  // Check users are deleted
  const user1 = await kv.get(["users", "1"]);
  assertEquals(user1.value, null);

  const user2 = await kv.get(["users", "2"]);
  assertEquals(user2.value, null);

  // Posts should remain
  const post1 = await kv.get(["posts", "1"]);
  assertEquals(post1.value, { id: "1", title: "Post 1" });

  await kv.close();
});

Deno.test("KVMMigrationUtils.countRecords", async () => {
  const kv = await Deno.openKv(":memory:");
  const utils = new KVMMigrationUtils(kv);

  // Add test data
  await kv.set(["users", "1"], { id: "1", name: "John" });
  await kv.set(["users", "2"], { id: "2", name: "Jane" });
  await kv.set(["users", "3"], { id: "3", name: "Bob" });
  await kv.set(["posts", "1"], { id: "1", title: "Post 1" });

  // Count records
  const userCount = await utils.countRecords("users");
  assertEquals(userCount, 3);

  const postCount = await utils.countRecords("posts");
  assertEquals(postCount, 1);

  const emptyCount = await utils.countRecords("empty");
  assertEquals(emptyCount, 0);

  await kv.close();
});

Deno.test("KVMMigrationUtils.fieldExists", async () => {
  const kv = await Deno.openKv(":memory:");
  const utils = new KVMMigrationUtils(kv);

  // Add test data
  await kv.set(["users", "1"], { id: "1", name: "John", age: 25 });
  await kv.set(["users", "2"], { id: "2", name: "Jane" });

  // Check field existence
  const hasName = await utils.fieldExists("users", "name");
  assertEquals(hasName, true);

  const hasAge = await utils.fieldExists("users", "age");
  assertEquals(hasAge, true);

  const hasEmail = await utils.fieldExists("users", "email");
  assertEquals(hasEmail, false);

  const emptyEntity = await utils.fieldExists("empty", "name");
  assertEquals(emptyEntity, false);

  await kv.close();
});

Deno.test("KVMMigrationUtils.batchProcess", async () => {
  const kv = await Deno.openKv(":memory:");
  const utils = new KVMMigrationUtils(kv);

  // Add test data
  for (let i = 1; i <= 25; i++) {
    await kv.set(["users", i.toString()], {
      id: i.toString(),
      name: `User ${i}`,
    });
  }

  // Process in batches
  const batchSizes: number[] = [];
  let totalProcessed = 0;

  await utils.batchProcess(
    "users",
    async (records) => {
      batchSizes.push(records.length);
      totalProcessed += records.length;
    },
    10, // batch size
  );

  // Should have 3 batches: 10, 10, 5
  assertEquals(batchSizes.length, 3);
  assertEquals(batchSizes[0], 10);
  assertEquals(batchSizes[1], 10);
  assertEquals(batchSizes[2], 5);
  assertEquals(totalProcessed, 25);

  await kv.close();
});

Deno.test("KVMMigrationUtils.backupEntity", async () => {
  const kv = await Deno.openKv(":memory:");
  const utils = new KVMMigrationUtils(kv);

  // Add test data
  await kv.set(["users", "1"], { id: "1", name: "John" });
  await kv.set(["users", "2"], { id: "2", name: "Jane" });

  // Create backup
  const backupName = await utils.backupEntity("users", "test_backup");
  assertEquals(backupName, "test_backup");

  // Check backup exists
  const backup1 = await kv.get([`__backups_test_backup`, "1"]);
  assertEquals(backup1.value, { id: "1", name: "John" });

  const backup2 = await kv.get([`__backups_test_backup`, "2"]);
  assertEquals(backup2.value, { id: "2", name: "Jane" });

  // Check metadata
  const meta = await kv.get<{
    originalEntity: string;
    backupName: string;
    createdAt: Date;
    recordCount: number;
  }>(["__backup_meta", "test_backup"]);
  assertEquals(meta.value?.originalEntity, "users");
  assertEquals(meta.value?.backupName, "test_backup");
  assertEquals(meta.value?.recordCount, 2);

  await kv.close();
});

Deno.test("KVMMigrationUtils.restoreEntity", async () => {
  const kv = await Deno.openKv(":memory:");
  const utils = new KVMMigrationUtils(kv);

  // Add test data
  await kv.set(["users", "1"], { id: "1", name: "John" });
  await kv.set(["users", "2"], { id: "2", name: "Jane" });

  // Create backup
  await utils.backupEntity("users", "test_backup");

  // Modify original data
  await kv.set(["users", "1"], { id: "1", name: "John Modified" });
  await kv.set(["users", "3"], { id: "3", name: "New User" });

  // Restore from backup
  await utils.restoreEntity("users", "test_backup");

  // Check restored data
  const user1 = await kv.get(["users", "1"]);
  assertEquals(user1.value, { id: "1", name: "John" });

  const user2 = await kv.get(["users", "2"]);
  assertEquals(user2.value, { id: "2", name: "Jane" });

  const user3 = await kv.get(["users", "3"]);
  assertEquals(user3.value, null); // Should be deleted

  // Test restore of non-existent backup
  await assertRejects(
    () => utils.restoreEntity("users", "non_existent"),
    Error,
    "Backup non_existent not found or empty",
  );

  await kv.close();
});

Deno.test("KVMMigrationUtils.listBackups", async () => {
  const kv = await Deno.openKv(":memory:");
  const utils = new KVMMigrationUtils(kv);

  // Add test data and create backups
  await kv.set(["users", "1"], { id: "1", name: "John" });
  await kv.set(["posts", "1"], { id: "1", title: "Post 1" });

  await utils.backupEntity("users", "backup1");
  await new Promise((resolve) => setTimeout(resolve, 10)); // Small delay
  await utils.backupEntity("posts", "backup2");

  // List backups
  const backups = await utils.listBackups();
  assertEquals(backups.length, 2);

  // Should be sorted by creation date (newest first)
  assertEquals(backups[0].backupName, "backup2");
  assertEquals(backups[0].originalEntity, "posts");
  assertEquals(backups[1].backupName, "backup1");
  assertEquals(backups[1].originalEntity, "users");

  await kv.close();
});

Deno.test("KVMMigrationUtils.deleteBackup", async () => {
  const kv = await Deno.openKv(":memory:");
  const utils = new KVMMigrationUtils(kv);

  // Add test data and create backup
  await kv.set(["users", "1"], { id: "1", name: "John" });
  await utils.backupEntity("users", "test_backup");

  // Verify backup exists
  const backupBefore = await kv.get([`__backups_test_backup`, "1"]);
  assertEquals(backupBefore.value, { id: "1", name: "John" });

  // Delete backup
  await utils.deleteBackup("test_backup");

  // Verify backup is deleted
  const backupAfter = await kv.get([`__backups_test_backup`, "1"]);
  assertEquals(backupAfter.value, null);

  const metaAfter = await kv.get(["__backup_meta", "test_backup"]);
  assertEquals(metaAfter.value, null);

  await kv.close();
});

Deno.test("KVMMigrationUtils.createIndex", async () => {
  const kv = await Deno.openKv(":memory:");
  const utils = new KVMMigrationUtils(kv);

  // Add test data
  await kv.set(["users", "1"], { id: "1", email: "john@example.com" });
  await kv.set(["users", "2"], { id: "2", email: "jane@example.com" });
  await kv.set(["users", "3"], { id: "3", name: "Bob" }); // No email

  // Create index
  await utils.createIndex("users", "email");

  // Check index entries
  const index1 = await kv.get(["users_by_email", "john@example.com"]);
  assertEquals(index1.value, ["users", "1"]);

  const index2 = await kv.get(["users_by_email", "jane@example.com"]);
  assertEquals(index2.value, ["users", "2"]);

  // No index for user without email
  const entries = [];
  for await (const entry of kv.list({ prefix: ["users_by_email"] })) {
    entries.push(entry);
  }
  assertEquals(entries.length, 2);

  await kv.close();
});

Deno.test("KVMMigrationUtils.dropIndex", async () => {
  const kv = await Deno.openKv(":memory:");
  const utils = new KVMMigrationUtils(kv);

  // Add test data
  await kv.set(["users_by_email", "john@example.com"], ["users", "1"]);
  await kv.set(["users_by_email", "jane@example.com"], ["users", "2"]);

  // Drop index
  await utils.dropIndex("users_by_email");

  // Check index is deleted
  const index1 = await kv.get(["users_by_email", "john@example.com"]);
  assertEquals(index1.value, null);

  const index2 = await kv.get(["users_by_email", "jane@example.com"]);
  assertEquals(index2.value, null);

  await kv.close();
});

Deno.test("KVMMigrationUtils.getMigrationStats", async () => {
  const kv = await Deno.openKv(":memory:");
  const utils = new KVMMigrationUtils(kv);

  // Add test data
  await kv.set(["users", "1"], { id: "1", name: "John" });
  await kv.set(["users", "2"], { id: "2", name: "Jane" });
  await kv.set(["posts", "1"], { id: "1", title: "Post 1" });
  await kv.set(["posts", "2"], { id: "2", title: "Post 2" });
  await kv.set(["posts", "3"], { id: "3", title: "Post 3" });

  // Create a backup
  await utils.backupEntity("users", "backup1");

  // Get stats
  const stats = await utils.getMigrationStats();

  assertEquals(stats.entityCounts.users, 2);
  assertEquals(stats.entityCounts.posts, 3);
  assertEquals(stats.totalRecords, 5);
  assertEquals(stats.backupCount, 1);

  // Internal keys should not be included
  assertEquals(stats.entityCounts.__backups_backup1, undefined);
  assertEquals(stats.entityCounts.__backup_meta, undefined);

  await kv.close();
});
