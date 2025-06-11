/**
 * Example script demonstrating how to run migrations
 */

import { createKVM } from "../lib/kvm.ts";
import type { Migration } from "../lib/migration-types.ts";

// Import example migrations
import migration001 from "./migrations/001_create_users.ts";
import migration002 from "./migrations/002_add_user_status.ts";
import migration003 from "./migrations/003_rename_email_field.ts";
import migration004 from "./migrations/004_transform_age_to_string.ts";
import migration005 from "./migrations/005_create_posts_table.ts";

// Collect all migrations
const migrations: Migration[] = [
  migration001,
  migration002,
  migration003,
  migration004,
  migration005,
];

async function main() {
  // Create KVM instance
  const kvm = await createKVM(":memory:"); // Use in-memory DB for demo

  try {
    console.log("🚀 Starting migration example...\n");

    // Check initial migration status
    console.log("📊 Initial migration status:");
    let status = await kvm.getMigrationStatus(migrations);
    console.log(`Current version: ${status.currentVersion}`);
    console.log(`Available migrations: ${status.availableMigrations.length}`);
    console.log(`Pending migrations: ${status.pendingMigrations.length}`);
    console.log(`Is up to date: ${status.isUpToDate}\n`);

    // Set up some test data first
    console.log("📝 Creating test data...");
    const userSchema = await import("zod").then((z) =>
      z.z.object({
        id: z.z.string(),
        name: z.z.string(),
        email: z.z.string().email(),
        age: z.z.number(),
      })
    );

    const User = kvm.model("users", {
      schema: userSchema,
      primaryKey: [{ name: "users", key: "id" }],
    });

    // Create some test users
    await User.create({
      id: "user1",
      name: "John Doe",
      email: "john@example.com",
      age: 25,
    });
    await User.create({
      id: "user2",
      name: "Jane Smith",
      email: "jane@example.com",
      age: 30,
    });
    await User.create({
      id: "user3",
      name: "Bob Johnson",
      email: "bob@example.com",
      age: 35,
    });

    console.log("✅ Created 3 test users\n");

    // Run migrations
    console.log("🔄 Running migrations...");
    const result = await kvm.migrate({
      migrationsPath: migrations,
      onBeforeMigration: (migration) => {
        console.log(
          `⏳ Running migration ${migration.version}: ${migration.description}`,
        );
      },
      onAfterMigration: (migration, result) => {
        if (result.success) {
          console.log(
            `✅ Completed migration ${migration.version} (${result.duration}ms)`,
          );
        } else {
          console.log(
            `❌ Failed migration ${migration.version}: ${result.error?.message}`,
          );
        }
      },
    });

    console.log("\n📊 Migration Results:");
    console.log(`Success: ${result.success}`);
    console.log(`Previous version: ${result.previousVersion}`);
    console.log(`Current version: ${result.currentVersion}`);
    console.log(`Executed migrations: ${result.executedMigrations.length}`);
    console.log(`Failed migrations: ${result.failedMigrations.length}`);
    console.log(`Total duration: ${result.totalDuration}ms`);

    if (result.errors.length > 0) {
      console.log("\n❌ Errors:");
      result.errors.forEach((error) => console.log(`  - ${error.message}`));
    }

    // Check final status
    console.log("\n📊 Final migration status:");
    status = await kvm.getMigrationStatus(migrations);
    console.log(`Current version: ${status.currentVersion}`);
    console.log(`Applied migrations: ${status.appliedMigrations.length}`);
    console.log(`Is up to date: ${status.isUpToDate}`);

    // Show statistics
    console.log("\n📈 Database statistics:");
    const stats = await kvm.getMigrationStats();
    console.log(`Total records: ${stats.utils.totalRecords}`);
    console.log(`Entity counts:`, stats.utils.entityCounts);
    console.log(
      `Total applied migrations: ${stats.storage.totalAppliedMigrations}`,
    );

    // Demonstrate rollback
    console.log("\n🔄 Demonstrating rollback...");
    console.log("Rolling back to version 3...");

    const rollbackResult = await kvm.rollback(3, migrations);
    console.log(`Rollback success: ${rollbackResult.success}`);
    console.log(
      `Rolled back from version ${rollbackResult.previousVersion} to ${rollbackResult.currentVersion}`,
    );
    console.log(
      `Rollback migrations: ${rollbackResult.executedMigrations.length}`,
    );

    // Final status after rollback
    status = await kvm.getMigrationStatus(migrations);
    console.log(`Final version after rollback: ${status.currentVersion}`);
    console.log(`Pending migrations: ${status.pendingMigrations.length}`);

    console.log("\n✅ Migration example completed successfully!");
  } catch (error) {
    console.error("❌ Migration example failed:", error);
  } finally {
    await kvm.close();
  }
}

// Run the example
if (import.meta.main) {
  main().catch(console.error);
}
