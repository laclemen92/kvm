/**
 * Example migration: Create initial users table structure
 */

import type { Migration } from "../../lib/migration-types.ts";

export default {
  version: 1,
  description: "Create initial users table structure",

  async up(kv, utils) {
    // This migration sets up the initial structure
    // In this case, we're just documenting the expected schema
    // The actual table creation happens when users are first created

    console.log("Setting up users table structure...");

    // You could create initial indexes here if needed
    // await utils.createIndex("users", "email", "users_by_email");

    console.log("Users table structure ready");
  },

  async down(kv, utils) {
    // Remove all users (be careful with this in production!)
    console.log("Removing all users...");
    await utils.truncateEntity("users");

    // Remove any custom indexes
    // await utils.dropIndex("users_by_email");

    console.log("Users table cleaned up");
  },
} as Migration;
