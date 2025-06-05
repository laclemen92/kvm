/**
 * Simple CLI tool for running migrations
 * Usage: deno run --allow-read --allow-write --unstable-kv migration-cli.ts [command] [options]
 */

import { createKVM } from "../lib/kvm.ts";
import { parseArgs } from "@std/cli/parse-args";

interface CliArgs {
  _: string[];
  help?: boolean;
  database?: string;
  migrations?: string;
  version?: number;
  dryRun?: boolean;
}

const HELP_TEXT = `
KVM Migration CLI

Usage:
  deno run --allow-read --allow-write --unstable-kv migration-cli.ts [command] [options]

Commands:
  status      Show current migration status
  up          Run pending migrations
  down        Rollback migrations
  reset       Reset migration state (dangerous!)

Options:
  --database <path>     Database path (default: ./database.db)
  --migrations <path>   Migrations directory (default: ./migrations)
  --version <number>    Target version for up/down commands
  --dry-run            Perform a dry run without making changes
  --help               Show this help message

Examples:
  migration-cli.ts status
  migration-cli.ts up --migrations ./migrations
  migration-cli.ts down --version 2
  migration-cli.ts up --dry-run
`;

async function showStatus(kvm: any, migrationsPath: string) {
  console.log("📊 Migration Status");
  console.log("==================");
  
  try {
    const status = await kvm.getMigrationStatus(migrationsPath);
    console.log(`Current version: ${status.currentVersion}`);
    console.log(`Available migrations: ${status.availableMigrations.length}`);
    console.log(`Applied migrations: ${status.appliedMigrations.length}`);
    console.log(`Pending migrations: ${status.pendingMigrations.length}`);
    console.log(`Is up to date: ${status.isUpToDate ? "✅" : "❌"}`);
    
    if (status.appliedMigrations.length > 0) {
      console.log("\nApplied migrations:");
      status.appliedMigrations.forEach(migration => {
        console.log(`  ${migration.version}: ${migration.description} (${migration.appliedAt.toISOString()})`);
      });
    }
    
    if (status.pendingMigrations.length > 0) {
      console.log("\nPending migrations:");
      status.pendingMigrations.forEach(migration => {
        console.log(`  ${migration.version}: ${migration.description}`);
      });
    }
    
    // Show integrity check
    const integrity = await kvm.validateMigrationIntegrity();
    console.log(`\nIntegrity: ${integrity.isValid ? "✅ Valid" : "❌ Invalid"}`);
    if (!integrity.isValid) {
      console.log("Integrity errors:");
      integrity.errors.forEach(error => console.log(`  - ${error}`));
    }
    
  } catch (error) {
    console.error("❌ Failed to get migration status:", error.message);
    Deno.exit(1);
  }
}

async function runMigrations(kvm: any, migrationsPath: string, targetVersion?: number, dryRun = false) {
  console.log("🔄 Running Migrations");
  console.log("====================");
  
  if (dryRun) {
    console.log("🔍 DRY RUN MODE - No changes will be made");
  }
  
  try {
    const result = await kvm.migrate({
      migrationsPath,
      toVersion: targetVersion,
      dryRun,
      onBeforeMigration: (migration) => {
        console.log(`⏳ ${dryRun ? "[DRY RUN] " : ""}Running migration ${migration.version}: ${migration.description}`);
      },
      onAfterMigration: (migration, result) => {
        if (result.success) {
          console.log(`✅ ${dryRun ? "[DRY RUN] " : ""}Completed migration ${migration.version} (${result.duration}ms)`);
        } else {
          console.log(`❌ ${dryRun ? "[DRY RUN] " : ""}Failed migration ${migration.version}: ${result.error?.message}`);
        }
      }
    });
    
    console.log("\n📊 Results:");
    console.log(`Success: ${result.success ? "✅" : "❌"}`);
    console.log(`Version: ${result.previousVersion} → ${result.currentVersion}`);
    console.log(`Executed: ${result.executedMigrations.length}`);
    console.log(`Failed: ${result.failedMigrations.length}`);
    console.log(`Duration: ${result.totalDuration}ms`);
    
    if (result.errors.length > 0) {
      console.log("\n❌ Errors:");
      result.errors.forEach(error => console.log(`  - ${error.message}`));
    }
    
    if (!result.success) {
      Deno.exit(1);
    }
    
  } catch (error) {
    console.error("❌ Failed to run migrations:", error.message);
    Deno.exit(1);
  }
}

async function rollbackMigrations(kvm: any, migrationsPath: string, targetVersion?: number) {
  console.log("⏪ Rolling Back Migrations");
  console.log("=========================");
  
  try {
    // Load migrations to pass to rollback
    const migrations = await kv.loadMigrations(migrationsPath);
    
    const result = await kvm.rollback(targetVersion, migrations);
    
    console.log("\n📊 Rollback Results:");
    console.log(`Success: ${result.success ? "✅" : "❌"}`);
    console.log(`Version: ${result.previousVersion} → ${result.currentVersion}`);
    console.log(`Rolled back: ${result.executedMigrations.length} migrations`);
    console.log(`Duration: ${result.totalDuration}ms`);
    
    if (result.errors.length > 0) {
      console.log("\n❌ Errors:");
      result.errors.forEach(error => console.log(`  - ${error.message}`));
    }
    
    if (!result.success) {
      Deno.exit(1);
    }
    
  } catch (error) {
    console.error("❌ Failed to rollback migrations:", error.message);
    Deno.exit(1);
  }
}

async function resetMigrations(kvm: any) {
  console.log("🔥 Resetting Migration State");
  console.log("============================");
  console.log("⚠️  WARNING: This will delete all migration history!");
  
  // In a real CLI, you'd want to prompt for confirmation
  // For this example, we'll just proceed
  
  try {
    await kvm.resetMigrations();
    console.log("✅ Migration state has been reset");
    
  } catch (error) {
    console.error("❌ Failed to reset migrations:", error.message);
    Deno.exit(1);
  }
}

async function main() {
  const args = parseArgs(Deno.args) as CliArgs;
  
  if (args.help || args._.length === 0) {
    console.log(HELP_TEXT);
    Deno.exit(0);
  }
  
  const command = args._[0];
  const databasePath = args.database || "./database.db";
  const migrationsPath = args.migrations || "./migrations";
  const targetVersion = args.version;
  const dryRun = args.dryRun || false;
  
  console.log(`🗄️  Database: ${databasePath}`);
  console.log(`📁 Migrations: ${migrationsPath}`);
  console.log("");
  
  // Create KVM instance
  let kvm;
  try {
    kv = await createKVM(databasePath);
  } catch (error) {
    console.error("❌ Failed to connect to database:", error.message);
    Deno.exit(1);
  }
  
  try {
    switch (command) {
      case "status":
        await showStatus(kvm, migrationsPath);
        break;
        
      case "up":
        await runMigrations(kvm, migrationsPath, targetVersion, dryRun);
        break;
        
      case "down":
        await rollbackMigrations(kvm, migrationsPath, targetVersion);
        break;
        
      case "reset":
        await resetMigrations(kvm);
        break;
        
      default:
        console.error(`❌ Unknown command: ${command}`);
        console.log(HELP_TEXT);
        Deno.exit(1);
    }
    
  } finally {
    await kvm.close();
  }
}

if (import.meta.main) {
  main().catch(error => {
    console.error("❌ CLI Error:", error);
    Deno.exit(1);
  });
}