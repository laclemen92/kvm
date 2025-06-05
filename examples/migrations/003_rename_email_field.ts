/**
 * Example migration: Rename email field to emailAddress for consistency
 */

import type { Migration } from "../../lib/migration-types.ts";

export default {
  version: 3,
  description: "Rename email field to emailAddress",
  
  async up(kv, utils) {
    console.log("Renaming email field to emailAddress...");
    
    // Create backup before making changes
    const backupName = await utils.backupEntity("users", "before_email_rename");
    console.log(`Created backup: ${backupName}`);
    
    // Rename the field
    await utils.renameField("users", "email", "emailAddress");
    
    const count = await utils.countRecords("users");
    console.log(`Renamed email field in ${count} user records`);
  },
  
  async down(kv, utils) {
    console.log("Renaming emailAddress field back to email...");
    
    // Rename back to original field name
    await utils.renameField("users", "emailAddress", "email");
    
    const count = await utils.countRecords("users");
    console.log(`Renamed emailAddress field back to email in ${count} user records`);
  }
} as Migration;