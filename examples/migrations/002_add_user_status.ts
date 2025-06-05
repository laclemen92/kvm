/**
 * Example migration: Add status field to existing users
 */

import type { Migration } from "../../lib/migration-types.ts";

export default {
  version: 2,
  description: "Add status field to users",
  
  async up(kv, utils) {
    console.log("Adding status field to users...");
    
    // Add status field with default value "active" to all existing users
    await utils.addField("users", "status", "active");
    
    // Get count to show progress
    const count = await utils.countRecords("users");
    console.log(`Updated ${count} user records with status field`);
  },
  
  async down(kv, utils) {
    console.log("Removing status field from users...");
    
    // Remove the status field from all users
    await utils.removeField("users", "status");
    
    const count = await utils.countRecords("users");
    console.log(`Removed status field from ${count} user records`);
  }
} as Migration;