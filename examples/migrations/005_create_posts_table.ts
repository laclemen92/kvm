/**
 * Example migration: Create posts table and establish relationship with users
 */

import type { Migration } from "../../lib/migration-types.ts";

export default {
  version: 5,
  description: "Create posts table with user relationship",
  
  async up(kv, utils) {
    console.log("Setting up posts table...");
    
    // Create indexes for posts
    await utils.createIndex("posts", "authorId", "posts_by_author");
    await utils.createIndex("posts", "createdAt", "posts_by_date");
    
    console.log("Created indexes for posts table");
    
    // You could seed some initial data here
    // Note: In a real migration, you'd typically create actual post records
    // This is just demonstrating the structure
    
    console.log("Posts table setup complete");
  },
  
  async down(kv, utils) {
    console.log("Removing posts table and indexes...");
    
    // Remove all posts
    await utils.truncateEntity("posts");
    
    // Remove indexes
    await utils.dropIndex("posts_by_author");
    await utils.dropIndex("posts_by_date");
    
    console.log("Posts table and indexes removed");
  }
} as Migration;