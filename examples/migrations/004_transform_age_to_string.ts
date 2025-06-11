/**
 * Example migration: Transform age field from number to string
 */

import type { Migration } from "../../lib/migration-types.ts";

export default {
  version: 4,
  description: "Transform age field from number to string",

  async up(kv, utils) {
    console.log("Converting age field from number to string...");

    // Check if age field exists before transforming
    const hasAge = await utils.fieldExists("users", "age");
    if (!hasAge) {
      console.log("No age field found, skipping transformation");
      return;
    }

    // Transform age from number to string
    await utils.transformField("users", "age", (value, record) => {
      if (typeof value === "number") {
        return String(value);
      }
      // If already a string or other type, leave as-is
      return value;
    });

    const count = await utils.countRecords("users");
    console.log(`Transformed age field to string in ${count} user records`);
  },

  async down(kv, utils) {
    console.log("Converting age field from string back to number...");

    // Transform age from string back to number
    await utils.transformField("users", "age", (value, record) => {
      if (typeof value === "string") {
        const numValue = parseInt(value, 10);
        return isNaN(numValue) ? 0 : numValue;
      }
      // If already a number or other type, leave as-is
      return value;
    });

    const count = await utils.countRecords("users");
    console.log(
      `Transformed age field back to number in ${count} user records`,
    );
  },
} as Migration;
