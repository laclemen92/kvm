/**
 * Comprehensive tests for the migration system
 */

import { assert, assertEquals, assertRejects } from "@std/assert";
import { z } from "zod";
import { createKVM } from "./kvm.ts";
import type { KVM } from "./kvm.ts";
import type { Migration } from "./migration-types.ts";
import { MigrationError, MigrationStateError } from "./migration-types.ts";

// Test migrations
const testMigrations: Migration[] = [
  {
    version: 1,
    description: "Add status field to users",
    up: async (kv, utils) => {
      await utils.addField("users", "status", "active");
    },
    down: async (kv, utils) => {
      await utils.removeField("users", "status");
    },
  },
  {
    version: 2,
    description: "Rename email to emailAddress",
    up: async (kv, utils) => {
      await utils.renameField("users", "email", "emailAddress");
    },
    down: async (kv, utils) => {
      await utils.renameField("users", "emailAddress", "email");
    },
  },
  {
    version: 3,
    description: "Transform age to string",
    up: async (kv, utils) => {
      await utils.transformField("users", "age", (value) => String(value));
    },
    down: async (kv, utils) => {
      await utils.transformField("users", "age", (value) => Number(value));
    },
  },
];

Deno.test("Migration System - Basic Setup", async () => {
  const kvm = await createKVM(":memory:");

  try {
    // Check initial migration status
    const status = await kvm.getMigrationStatus([]); // Pass empty array to avoid file system
    assertEquals(status.currentVersion, 0);
    assertEquals(status.isUpToDate, true);
    assertEquals(status.appliedMigrations.length, 0);
    assertEquals(status.pendingMigrations.length, 0);

    // Validate integrity
    const integrity = await kvm.validateMigrationIntegrity();
    assertEquals(integrity.isValid, true);
    assertEquals(integrity.errors.length, 0);
  } finally {
    await kvm.close();
  }
});

Deno.test("Migration System - Load Migrations from Array", async () => {
  const kvm = await createKVM(":memory:");

  try {
    const migrations = await kvm.loadMigrations(testMigrations);
    assertEquals(migrations.length, 3);
    assertEquals(migrations[0].version, 1);
    assertEquals(migrations[1].version, 2);
    assertEquals(migrations[2].version, 3);
  } finally {
    await kvm.close();
  }
});

Deno.test("Migration System - Invalid Migration Validation", async () => {
  const kvm = await createKVM(":memory:");

  try {
    // Test duplicate versions
    const duplicateMigrations: Migration[] = [
      { ...testMigrations[0] },
      { ...testMigrations[0] }, // Duplicate version 1
    ];

    await assertRejects(
      async () => await kvm.loadMigrations(duplicateMigrations),
      MigrationError,
      "Duplicate migration version: 1",
    );

    // Test gap in sequence
    const gappedMigrations: Migration[] = [
      testMigrations[0], // version 1
      testMigrations[2], // version 3 (missing version 2)
    ];

    await assertRejects(
      async () => await kvm.loadMigrations(gappedMigrations),
      MigrationError,
      "Gap in migration sequence",
    );
  } finally {
    await kvm.close();
  }
});

Deno.test("Migration System - Run Migrations Up", async () => {
  const kvm = await createKVM(":memory:");

  try {
    // Create test data
    const userSchema = z.object({
      id: z.string(),
      name: z.string(),
      email: z.string().email(),
      age: z.number(),
    });

    const User = kvm.model("users", {
      schema: userSchema,
      primaryKey: [{ name: "users", key: "id" }],
    });

    // Create some test users
    await User.create({
      id: "user1",
      name: "John",
      email: "john@example.com",
      age: 25,
    });
    await User.create({
      id: "user2",
      name: "Jane",
      email: "jane@example.com",
      age: 30,
    });

    // Run migrations programmatically
    const result = await kvm.migrate({
      toVersion: 3,
      migrationsPath: testMigrations,
    });

    assertEquals(result.success, true);
    assertEquals(result.previousVersion, 0);
    assertEquals(result.currentVersion, 3);
    assertEquals(result.executedMigrations.length, 3);
    assertEquals(result.failedMigrations.length, 0);

    // Check migration status
    const status = await kvm.getMigrationStatus(testMigrations);
    assertEquals(status.currentVersion, 3);
    assertEquals(status.appliedMigrations.length, 3);
    assertEquals(status.isUpToDate, true);

    // Verify data transformations
    const users = await User.findMany();
    for (const user of users) {
      assert((user as any).status === "active", "Status field should be added");
      assert(
        (user as any).emailAddress,
        "Email should be renamed to emailAddress",
      );
      assert(!(user as any).email, "Old email field should not exist");
      assert(
        typeof (user as any).age === "string",
        "Age should be transformed to string",
      );
    }
  } finally {
    await kvm.close();
  }
});

Deno.test("Migration System - Rollback Migrations", async () => {
  const kvm = await createKVM(":memory:");

  try {
    // Create test data and run migrations
    const userSchema = z.object({
      id: z.string(),
      name: z.string(),
      email: z.string().email(),
      age: z.number(),
    });

    const User = kvm.model("users", {
      schema: userSchema,
      primaryKey: [{ name: "users", key: "id" }],
    });

    await User.create({
      id: "user1",
      name: "John",
      email: "john@example.com",
      age: 25,
    });

    // Run migrations first
    await kvm.migrate({
      migrationsPath: testMigrations,
    });

    // Verify migrations were applied
    let status = await kvm.getMigrationStatus(testMigrations);
    assertEquals(status.currentVersion, 3);

    // Rollback to version 1
    const rollbackResult = await kvm.rollback(1, testMigrations);

    assertEquals(rollbackResult.success, true);
    assertEquals(rollbackResult.previousVersion, 3);
    assertEquals(rollbackResult.currentVersion, 1);
    assertEquals(rollbackResult.executedMigrations.length, 2); // Rollback migrations 3 and 2

    // Check final status
    status = await kvm.getMigrationStatus(testMigrations);
    assertEquals(status.currentVersion, 1);
    assertEquals(status.appliedMigrations.length, 1);

    // Verify data state after rollback
    const users = await User.findMany();
    for (const user of users) {
      assert(
        (user as any).status === "active",
        "Status field should still exist",
      );
      assert((user as any).email, "Email field should be restored");
      assert(
        !(user as any).emailAddress,
        "EmailAddress field should be removed",
      );
      assert(
        typeof (user as any).age === "number",
        "Age should be back to number",
      );
    }
  } finally {
    await kvm.close();
  }
});

Deno.test("Migration System - Partial Migration Run", async () => {
  const kvm = await createKVM(":memory:");

  try {
    // Run only first two migrations
    const result = await kvm.migrate({
      toVersion: 2,
      migrationsPath: testMigrations,
    });

    assertEquals(result.success, true);
    assertEquals(result.currentVersion, 2);
    assertEquals(result.executedMigrations.length, 2);

    const status = await kvm.getMigrationStatus(testMigrations);
    assertEquals(status.currentVersion, 2);
    assertEquals(status.appliedMigrations.length, 2);
    assertEquals(status.pendingMigrations.length, 1); // Version 3 is still pending
    assertEquals(status.isUpToDate, false);
  } finally {
    await kvm.close();
  }
});

Deno.test("Migration System - Dry Run", async () => {
  const kvm = await createKVM(":memory:");

  try {
    // Create test data
    const userSchema = z.object({
      id: z.string(),
      name: z.string(),
      email: z.string().email(),
      age: z.number(),
    });

    const User = kvm.model("users", {
      schema: userSchema,
      primaryKey: [{ name: "users", key: "id" }],
    });

    await User.create({
      id: "user1",
      name: "John",
      email: "john@example.com",
      age: 25,
    });

    // Run dry run
    const result = await kvm.migrate({
      migrationsPath: testMigrations,
      dryRun: true,
    });

    assertEquals(result.success, true);
    assertEquals(result.executedMigrations.length, 3);

    // Verify no actual changes were made
    const status = await kvm.getMigrationStatus(testMigrations);
    assertEquals(status.currentVersion, 0); // Should still be 0
    assertEquals(status.appliedMigrations.length, 0);

    // Verify data is unchanged
    const users = await User.findMany();
    for (const user of users) {
      assert(
        !(user as any).status,
        "Status field should not be added in dry run",
      );
      assert((user as any).email, "Email field should still exist");
      assert(
        typeof (user as any).age === "number",
        "Age should still be number",
      );
    }
  } finally {
    await kvm.close();
  }
});

Deno.test("Migration System - Migration Utils", async () => {
  const kvm = await createKVM(":memory:");

  try {
    // Create test data
    const userSchema = z.object({
      id: z.string(),
      name: z.string(),
      email: z.string().email(),
      age: z.number(),
    });

    const User = kvm.model("users", {
      schema: userSchema,
      primaryKey: [{ name: "users", key: "id" }],
    });

    await User.create({
      id: "user1",
      name: "John",
      email: "john@example.com",
      age: 25,
    });
    await User.create({
      id: "user2",
      name: "Jane",
      email: "jane@example.com",
      age: 30,
    });

    // Test various utility functions through migrations
    const utilMigrations: Migration[] = [
      {
        version: 1,
        description: "Test field operations",
        up: async (kv, utils) => {
          // Test addField
          await utils.addField("users", "isActive", true);

          // Test fieldExists
          const hasIsActive = await utils.fieldExists("users", "isActive");
          assert(hasIsActive, "isActive field should exist");

          // Test countRecords
          const count = await utils.countRecords("users");
          assertEquals(count, 2);
        },
        down: async (kv, utils) => {
          await utils.removeField("users", "isActive");
        },
      },
      {
        version: 2,
        description: "Test entity operations",
        up: async (kv, utils) => {
          // Test backup and restore
          const backupName = await utils.backupEntity("users");
          assert(
            backupName.includes("users_backup_"),
            "Backup name should contain timestamp",
          );

          // Test truncate and restore
          await utils.truncateEntity("users");
          const countAfterTruncate = await utils.countRecords("users");
          assertEquals(countAfterTruncate, 0);

          await utils.restoreEntity("users", backupName);
          const countAfterRestore = await utils.countRecords("users");
          assertEquals(countAfterRestore, 2);
        },
        down: async (kv, utils) => {
          // No-op for this test
        },
      },
    ];

    const result = await kvm.migrate({
      migrationsPath: utilMigrations,
    });

    assertEquals(result.success, true);
    assertEquals(result.executedMigrations.length, 2);
  } finally {
    await kvm.close();
  }
});

Deno.test("Migration System - Error Handling", async () => {
  const kvm = await createKVM(":memory:");

  try {
    // Migration that will fail
    const failingMigrations: Migration[] = [
      {
        version: 1,
        description: "Failing migration",
        up: async (kv, utils) => {
          throw new Error("Intentional failure");
        },
        down: async (kv, utils) => {
          // No-op
        },
      },
      {
        version: 2,
        description: "Second migration",
        up: async (kv, utils) => {
          await utils.addField("users", "test", "value");
        },
        down: async (kv, utils) => {
          await utils.removeField("users", "test");
        },
      },
    ];

    // Test with continueOnError: false (default)
    const result1 = await kvm.migrate({
      migrationsPath: failingMigrations,
    });

    assertEquals(result1.success, false);
    assertEquals(result1.executedMigrations.length, 0);
    assertEquals(result1.failedMigrations.length, 1);
    assertEquals(result1.errors.length, 1);

    // Reset for next test
    await kvm.resetMigrations();

    // Test with continueOnError: true
    const result2 = await kvm.migrate({
      migrationsPath: failingMigrations,
      continueOnError: true,
    });

    assertEquals(result2.success, false); // Still false because there were failures
    assertEquals(result2.executedMigrations.length, 1); // Second migration should run
    assertEquals(result2.failedMigrations.length, 1);
    assertEquals(result2.currentVersion, 2); // Should advance to version 2
  } finally {
    await kvm.close();
  }
});

Deno.test("Migration System - Statistics and Monitoring", async () => {
  const kvm = await createKVM(":memory:");

  try {
    // Create test data
    const userSchema = z.object({
      id: z.string(),
      name: z.string(),
      email: z.string().email(),
    });

    const User = kvm.model("users", {
      schema: userSchema,
      primaryKey: [{ name: "users", key: "id" }],
    });

    await User.create({ id: "user1", name: "John", email: "john@example.com" });

    // Run migrations
    await kvm.migrate({
      migrationsPath: testMigrations.slice(0, 2), // Only first 2 migrations
    });

    // Get statistics
    const stats = await kvm.getMigrationStats();

    assert(stats.storage.currentVersion === 2);
    assert(stats.storage.totalAppliedMigrations === 2);
    assert(stats.storage.firstMigrationDate instanceof Date);
    assert(stats.storage.lastMigrationDate instanceof Date);

    assert(stats.utils.totalRecords >= 1);
    assert(stats.utils.entityCounts.users >= 1);
  } finally {
    await kvm.close();
  }
});

Deno.test("Migration System - Integrity Validation", async () => {
  const kvm = await createKVM(":memory:");

  try {
    // Run some migrations
    await kvm.migrate({
      migrationsPath: testMigrations.slice(0, 2),
    });

    // Validate integrity
    const integrity1 = await kvm.validateMigrationIntegrity();
    assertEquals(integrity1.isValid, true);
    assertEquals(integrity1.errors.length, 0);

    // Manually corrupt the migration state (simulate inconsistency)
    const kvInstance = kvm.getKv();
    await kvInstance.set(["__migrations", "version"], 5); // Set wrong version

    const integrity2 = await kvm.validateMigrationIntegrity();
    assertEquals(integrity2.isValid, false);
    assert(integrity2.errors.length > 0);
    assert(integrity2.errors[0].includes("Version mismatch"));
  } finally {
    await kvm.close();
  }
});

Deno.test("Migration System - Rollback Error Handling", async () => {
  const kvm = await createKVM(":memory:");

  try {
    // Try to rollback when no migrations have been applied
    await assertRejects(
      async () => await kvm.rollback(1),
      MigrationStateError,
      "Cannot rollback to version 1: current version is 0",
    );

    // Run migrations first
    await kvm.migrate({
      migrationsPath: testMigrations.slice(0, 2),
    });

    // Try to rollback to a higher version
    await assertRejects(
      async () => await kvm.rollback(5, testMigrations),
      MigrationStateError,
      "Cannot rollback to version 5: current version is 2",
    );
  } finally {
    await kvm.close();
  }
});
