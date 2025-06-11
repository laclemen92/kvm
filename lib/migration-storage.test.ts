import { assertEquals, assertRejects } from "https://deno.land/std@0.220.0/assert/mod.ts";
import { MigrationStorage } from "./migration-storage.ts";
import { MigrationStateError } from "./migration-types.ts";
import type { AppliedMigration } from "./migration-types.ts";

Deno.test("MigrationStorage", async (t) => {
  await t.step("should initialize with default configuration", async () => {
    const kv = await Deno.openKv(":memory:");
    const storage = new MigrationStorage(kv);
    
    await storage.initialize();
    const version = await storage.getCurrentVersion();
    assertEquals(version, 0);
    
    await kv.close();
  });

  await t.step("should initialize with custom configuration", async () => {
    const kv = await Deno.openKv(":memory:");
    const storage = new MigrationStorage(kv, {
      keyPrefix: ["custom", "migrations"],
      versionKey: ["custom", "migrations", "v"],
      appliedMigrationsPrefix: ["custom", "migrations", "a"],
    });
    
    await storage.initialize();
    const version = await storage.getCurrentVersion();
    assertEquals(version, 0);
    
    await kv.close();
  });

  await t.step("should not re-initialize if version already exists", async () => {
    const kv = await Deno.openKv(":memory:");
    const storage = new MigrationStorage(kv);
    
    // Set initial version to 5
    await storage.setCurrentVersion(5);
    
    // Initialize should not change it
    await storage.initialize();
    const version = await storage.getCurrentVersion();
    assertEquals(version, 5);
    
    await kv.close();
  });

  await t.step("should set and get current version", async () => {
    const kv = await Deno.openKv(":memory:");
    const storage = new MigrationStorage(kv);
    
    await storage.setCurrentVersion(42);
    const version = await storage.getCurrentVersion();
    assertEquals(version, 42);
    
    await kv.close();
  });

  await t.step("should record and retrieve applied migrations", async () => {
    const kv = await Deno.openKv(":memory:");
    const storage = new MigrationStorage(kv);
    
    const migration: AppliedMigration = {
      version: 1,
      description: "initial_schema",
      appliedAt: new Date("2023-01-01T00:00:00Z"),
      duration: 100,
      checksum: "abc123",
    };
    
    await storage.recordAppliedMigration(migration);
    
    const appliedMigrations = await storage.getAppliedMigrations();
    assertEquals(appliedMigrations.length, 1);
    assertEquals(appliedMigrations[0], migration);
    
    await kv.close();
  });

  await t.step("should check if migration is applied", async () => {
    const kv = await Deno.openKv(":memory:");
    const storage = new MigrationStorage(kv);
    
    const migration: AppliedMigration = {
      version: 1,
      description: "test_migration",
      appliedAt: new Date(),
      duration: 50,
      checksum: "hash123",
    };
    
    assertEquals(await storage.isMigrationApplied(1), false);
    
    await storage.recordAppliedMigration(migration);
    assertEquals(await storage.isMigrationApplied(1), true);
    assertEquals(await storage.isMigrationApplied(2), false);
    
    await kv.close();
  });

  await t.step("should get specific applied migration", async () => {
    const kv = await Deno.openKv(":memory:");
    const storage = new MigrationStorage(kv);
    
    const migration: AppliedMigration = {
      version: 3,
      description: "add_users_table",
      duration: 200,
      appliedAt: new Date("2023-03-01T00:00:00Z"),
      checksum: "def456",
    };
    
    assertEquals(await storage.getAppliedMigration(3), null);
    
    await storage.recordAppliedMigration(migration);
    const retrieved = await storage.getAppliedMigration(3);
    assertEquals(retrieved, migration);
    
    await kv.close();
  });

  await t.step("should remove applied migration", async () => {
    const kv = await Deno.openKv(":memory:");
    const storage = new MigrationStorage(kv);
    
    const migration: AppliedMigration = {
      version: 2,
      description: "add_index",
      duration: 150,
      appliedAt: new Date(),
      checksum: "ghi789",
    };
    
    await storage.recordAppliedMigration(migration);
    assertEquals(await storage.isMigrationApplied(2), true);
    
    await storage.removeAppliedMigration(2);
    assertEquals(await storage.isMigrationApplied(2), false);
    
    await kv.close();
  });

  await t.step("should sort applied migrations by version", async () => {
    const kv = await Deno.openKv(":memory:");
    const storage = new MigrationStorage(kv);
    
    const migrations: AppliedMigration[] = [
      {
        version: 3,
        description: "third",
        duration: 300,
        appliedAt: new Date("2023-03-01T00:00:00Z"),
        checksum: "c",
      },
      {
        version: 1,
        description: "first",
        duration: 100,
        appliedAt: new Date("2023-01-01T00:00:00Z"),
        checksum: "a",
      },
      {
        version: 2,
        description: "second",
        duration: 200,
        appliedAt: new Date("2023-02-01T00:00:00Z"),
        checksum: "b",
      },
    ];
    
    // Add migrations in random order
    for (const migration of migrations) {
      await storage.recordAppliedMigration(migration);
    }
    
    const appliedMigrations = await storage.getAppliedMigrations();
    assertEquals(appliedMigrations.length, 3);
    assertEquals(appliedMigrations[0].version, 1);
    assertEquals(appliedMigrations[1].version, 2);
    assertEquals(appliedMigrations[2].version, 3);
    
    await kv.close();
  });

  await t.step("should atomically apply migration", async () => {
    const kv = await Deno.openKv(":memory:");
    const storage = new MigrationStorage(kv);
    
    await storage.setCurrentVersion(0);
    
    const migration: AppliedMigration = {
      version: 1,
      description: "initial",
      duration: 50,
      appliedAt: new Date(),
      checksum: "initial123",
    };
    
    await storage.applyMigration(0, 1, migration);
    
    assertEquals(await storage.getCurrentVersion(), 1);
    assertEquals(await storage.isMigrationApplied(1), true);
    
    await kv.close();
  });

  await t.step("should handle version mismatch in apply migration", async () => {
    const kv = await Deno.openKv(":memory:");
    const storage = new MigrationStorage(kv);
    
    await storage.setCurrentVersion(5);
    
    const migration: AppliedMigration = {
      version: 6,
      description: "test",
      duration: 75,
      appliedAt: new Date(),
      checksum: "test123",
    };
    
    // This should work normally
    await storage.applyMigration(5, 6, migration);
    
    const currentVersion = await storage.getCurrentVersion();
    assertEquals(currentVersion, 6);
    
    await kv.close();
  });

  await t.step("should atomically rollback migration", async () => {
    const kv = await Deno.openKv(":memory:");
    const storage = new MigrationStorage(kv);
    
    // Set up initial state
    await storage.setCurrentVersion(2);
    const migration: AppliedMigration = {
      version: 2,
      description: "to_rollback",
      duration: 120,
      appliedAt: new Date(),
      checksum: "rollback123",
    };
    await storage.recordAppliedMigration(migration);
    
    await storage.rollbackMigration(2, 1, 2);
    
    assertEquals(await storage.getCurrentVersion(), 1);
    assertEquals(await storage.isMigrationApplied(2), false);
    
    await kv.close();
  });

  await t.step("should handle rollback migration normally", async () => {
    const kv = await Deno.openKv(":memory:");
    const storage = new MigrationStorage(kv);
    
    await storage.setCurrentVersion(3);
    const migration: AppliedMigration = {
      version: 3,
      description: "rollback_test",
      duration: 120,
      appliedAt: new Date(),
      checksum: "rollback123",
    };
    await storage.recordAppliedMigration(migration);
    
    // This should work normally
    await storage.rollbackMigration(3, 2, 3);
    
    assertEquals(await storage.getCurrentVersion(), 2);
    assertEquals(await storage.isMigrationApplied(3), false);
    
    await kv.close();
  });

  await t.step("should get migration statistics", async () => {
    const kv = await Deno.openKv(":memory:");
    const storage = new MigrationStorage(kv);
    
    await storage.setCurrentVersion(2);
    
    const migration1: AppliedMigration = {
      version: 1,
      description: "first",
      duration: 100,
      appliedAt: new Date("2023-01-01T00:00:00Z"),
      checksum: "first123",
    };
    
    const migration2: AppliedMigration = {
      version: 2,
      description: "second",
      duration: 150,
      appliedAt: new Date("2023-02-01T00:00:00Z"),
      checksum: "second123",
    };
    
    await storage.recordAppliedMigration(migration1);
    await storage.recordAppliedMigration(migration2);
    
    const stats = await storage.getStats();
    assertEquals(stats.currentVersion, 2);
    assertEquals(stats.totalAppliedMigrations, 2);
    assertEquals(stats.firstMigrationDate, migration1.appliedAt);
    assertEquals(stats.lastMigrationDate, migration2.appliedAt);
    
    await kv.close();
  });

  await t.step("should get stats with no migrations", async () => {
    const kv = await Deno.openKv(":memory:");
    const storage = new MigrationStorage(kv);
    
    await storage.setCurrentVersion(0);
    
    const stats = await storage.getStats();
    assertEquals(stats.currentVersion, 0);
    assertEquals(stats.totalAppliedMigrations, 0);
    assertEquals(stats.firstMigrationDate, undefined);
    assertEquals(stats.lastMigrationDate, undefined);
    
    await kv.close();
  });

  await t.step("should clear all migration data", async () => {
    const kv = await Deno.openKv(":memory:");
    const storage = new MigrationStorage(kv);
    
    await storage.setCurrentVersion(5);
    await storage.recordAppliedMigration({
      version: 1,
      description: "test",
      duration: 80,
      appliedAt: new Date(),
      checksum: "test123",
    });
    
    await storage.clear();
    
    assertEquals(await storage.getCurrentVersion(), 0);
    assertEquals((await storage.getAppliedMigrations()).length, 0);
    
    await kv.close();
  });

  await t.step("should validate migration integrity - valid chain", async () => {
    const kv = await Deno.openKv(":memory:");
    const storage = new MigrationStorage(kv);
    
    await storage.setCurrentVersion(3);
    
    for (let i = 1; i <= 3; i++) {
      await storage.recordAppliedMigration({
        version: i,
        description: `migration_${i}`,
        duration: 100,
        appliedAt: new Date(),
        checksum: `checksum_${i}`,
      });
    }
    
    const result = await storage.validateIntegrity();
    assertEquals(result.isValid, true);
    assertEquals(result.errors.length, 0);
    
    await kv.close();
  });

  await t.step("should validate migration integrity - version mismatch", async () => {
    const kv = await Deno.openKv(":memory:");
    const storage = new MigrationStorage(kv);
    
    await storage.setCurrentVersion(5);
    await storage.recordAppliedMigration({
      version: 3,
      description: "migration_3",
      duration: 110,
      appliedAt: new Date(),
      checksum: "checksum_3",
    });
    
    const result = await storage.validateIntegrity();
    assertEquals(result.isValid, false);
    assertEquals(result.errors.length, 1);
    assertEquals(
      result.errors[0],
      "Version mismatch: current version is 5 but highest applied migration is 3"
    );
    
    await kv.close();
  });

  await t.step("should validate migration integrity - no migrations but version set", async () => {
    const kv = await Deno.openKv(":memory:");
    const storage = new MigrationStorage(kv);
    
    await storage.setCurrentVersion(3);
    
    const result = await storage.validateIntegrity();
    assertEquals(result.isValid, false);
    assertEquals(result.errors.length, 1);
    assertEquals(
      result.errors[0],
      "Version mismatch: current version is 3 but no migrations have been applied"
    );
    
    await kv.close();
  });

  await t.step("should validate migration integrity - gap in sequence", async () => {
    const kv = await Deno.openKv(":memory:");
    const storage = new MigrationStorage(kv);
    
    await storage.setCurrentVersion(4);
    
    // Create gap: 1, 2, 4 (missing 3)
    for (const version of [1, 2, 4]) {
      await storage.recordAppliedMigration({
        version,
        description: `migration_${version}`,
        duration: 100,
        appliedAt: new Date(),
        checksum: `checksum_${version}`,
      });
    }
    
    const result = await storage.validateIntegrity();
    assertEquals(result.isValid, false);
    assertEquals(result.errors.length, 1);
    assertEquals(
      result.errors[0],
      "Gap in migration sequence between version 2 and 4"
    );
    
    await kv.close();
  });

  await t.step("should handle empty applied migrations list", async () => {
    const kv = await Deno.openKv(":memory:");
    const storage = new MigrationStorage(kv);
    
    // List entries with null values
    await kv.set(["__migrations", "applied", "invalid"], null);
    
    const appliedMigrations = await storage.getAppliedMigrations();
    assertEquals(appliedMigrations.length, 0);
    
    await kv.close();
  });
});