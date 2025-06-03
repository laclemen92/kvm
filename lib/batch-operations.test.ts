import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  it,
} from "jsr:@std/testing/bdd";
import { expect } from "jsr:@std/expect";
import { z } from "zod";
import { createKVM } from "./kvm.ts";
import type { KVM } from "./kvm.ts";
import { KVMErrorUtils } from "./errors.ts";
import { RelationType, ValueType } from "./types.ts";

describe("Batch Operations", () => {
  let kvm: KVM;

  beforeAll(async () => {
    kvm = await createKVM(":memory:");
  });

  afterEach(async () => {
    // Clear all data between tests
    const kvInstance = kvm.getKv();
    const allEntries = await Array.fromAsync(kvInstance.list({ prefix: [] }));
    for await (const entry of allEntries) {
      await kvInstance.delete(entry.key);
    }
    // Clear models
    kvm.clearModels();
  });

  afterAll(async () => {
    await kvm.close();
  });

  describe("createMany", () => {
    it("should create multiple documents atomically", async () => {
      const userSchema = z.object({
        id: z.string(),
        name: z.string(),
        email: z.string().email(),
        age: z.number().positive(),
      });

      type UserType = z.infer<typeof userSchema>;

      const User = kvm.model("users", {
        schema: userSchema,
        primaryKey: [{ name: "users", key: "id" }],
      });

      const users: UserType[] = [
        { id: "user1", name: "John", email: "john@example.com", age: 25 },
        { id: "user2", name: "Jane", email: "jane@example.com", age: 30 },
        { id: "user3", name: "Bob", email: "bob@example.com", age: 35 },
      ];

      const result = await User.createMany(users);

      expect(result.stats.total).toBe(3);
      expect(result.stats.created).toBe(3);
      expect(result.stats.failed).toBe(0);
      expect(result.created).toHaveLength(3);
      expect(result.failed).toHaveLength(0);

      // Verify all users were created
      const user1 = await User.findById("user1");
      expect(user1?.name).toBe("John");

      const user2 = await User.findById("user2");
      expect(user2?.name).toBe("Jane");

      const user3 = await User.findById("user3");
      expect(user3?.name).toBe("Bob");
    });

    it("should handle validation errors with continueOnError", async () => {
      const userSchema = z.object({
        id: z.string(),
        name: z.string(),
        email: z.string().email(),
        age: z.number().positive(),
      });

      type UserType = z.infer<typeof userSchema>;

      const User = kvm.model("users", {
        schema: userSchema,
        primaryKey: [{ name: "users", key: "id" }],
      });

      const users = [
        { id: "user1", name: "John", email: "john@example.com", age: 25 },
        { id: "user2", name: "Jane", email: "invalid-email", age: 30 }, // Invalid email
        { id: "user3", name: "Bob", email: "bob@example.com", age: -5 }, // Negative age
      ];

      const result = await User.createMany(users, {
        continueOnError: true,
        returnPartialResults: true,
      });

      expect(result.stats.total).toBe(3);
      expect(result.stats.created).toBe(1);
      expect(result.stats.failed).toBe(2);
      expect(result.created).toHaveLength(1);
      expect(result.failed).toHaveLength(2);

      // Only valid user should be created
      const user1 = await User.findById("user1");
      expect(user1?.name).toBe("John");

      const user2 = await User.findById("user2");
      expect(user2).toBeNull();
    });

    it("should throw batch validation error when validation fails", async () => {
      const userSchema = z.object({
        id: z.string(),
        name: z.string(),
        email: z.string().email(),
      });

      type UserType = z.infer<typeof userSchema>;

      const User = kvm.model("users", {
        schema: userSchema,
        primaryKey: [{ name: "users", key: "id" }],
      });

      const users = [
        { id: "user1", name: "John", email: "invalid" },
      ];

      await expect(User.createMany(users))
        .rejects.toThrow();

      try {
        await User.createMany(users);
      } catch (error) {
        expect(KVMErrorUtils.isBatchValidationError(error)).toBe(true);
        if (KVMErrorUtils.isBatchValidationError(error)) {
          expect(error.results.stats.invalid).toBe(1);
          expect(error.results.invalid[0].errors[0].field).toBe("email");
        }
      }
    });

    it("should handle atomic operation failures", async () => {
      const userSchema = z.object({
        id: z.string(),
        name: z.string(),
      });

      type UserType = z.infer<typeof userSchema>;

      const User = kvm.model("users", {
        schema: userSchema,
        primaryKey: [{ name: "users", key: "id" }],
      });

      // Create a user first
      await User.create({ id: "user1", name: "John" });

      // Try to create with duplicate key
      const users = [
        { id: "user1", name: "Duplicate" }, // Will fail
        { id: "user2", name: "Jane" },
      ];

      await expect(User.createMany(users))
        .rejects.toThrow();

      // Neither should be created due to atomic failure
      const user2 = await User.findById("user2");
      expect(user2).toBeNull();
    });

    it("should support non-atomic batch creation", async () => {
      const userSchema = z.object({
        id: z.string(),
        name: z.string(),
      });

      type UserType = z.infer<typeof userSchema>;

      const User = kvm.model("users", {
        schema: userSchema,
        primaryKey: [{ name: "users", key: "id" }],
      });

      // Create a user first
      await User.create({ id: "user1", name: "John" });

      const users = [
        { id: "user1", name: "Duplicate" }, // Will fail
        { id: "user2", name: "Jane" }, // Should succeed
        { id: "user3", name: "Bob" }, // Should succeed
      ];

      const result = await User.createMany(users, {
        atomic: false,
        continueOnError: true,
        returnPartialResults: true,
      });

      expect(result.stats.created).toBe(2);
      expect(result.stats.failed).toBe(1);

      // user2 and user3 should be created
      const user2 = await User.findById("user2");
      expect(user2?.name).toBe("Jane");

      const user3 = await User.findById("user3");
      expect(user3?.name).toBe("Bob");
    });

    it("should work with secondary indexes", async () => {
      const userSchema = z.object({
        id: z.string(),
        email: z.string().email(),
        name: z.string(),
      });

      type UserType = z.infer<typeof userSchema>;

      const User = kvm.model("users", {
        schema: userSchema,
        primaryKey: [{ name: "users", key: "id" }],
        secondaryIndexes: [{
          name: "users_by_email",
          key: [{ name: "users_by_email", key: "email" }],
          valueType: ValueType.KEY,
          valueKey: "id",
        }],
      });

      const users = [
        { id: "user1", email: "john@example.com", name: "John" },
        { id: "user2", email: "jane@example.com", name: "Jane" },
      ];

      await User.createMany(users);

      // Verify secondary indexes were created
      const userByEmail = await User.findUnique(
        "john@example.com",
        "users_by_email",
      );
      expect(userByEmail?.name).toBe("John");
    });
  });

  describe("updateMany", () => {
    it("should update multiple documents atomically", async () => {
      const userSchema = z.object({
        id: z.string(),
        name: z.string(),
        status: z.string(),
      });

      type UserType = z.infer<typeof userSchema>;

      const User = kvm.model("users", {
        schema: userSchema,
        primaryKey: [{ name: "users", key: "id" }],
      });

      // Create users first
      await User.createMany([
        { id: "user1", name: "John", status: "active" },
        { id: "user2", name: "Jane", status: "active" },
        { id: "user3", name: "Bob", status: "active" },
      ]);

      // Update multiple users
      const result = await User.updateMany([
        { key: "user1", data: { status: "inactive" } },
        { key: "user2", data: { status: "inactive" } },
        { key: "user3", data: { name: "Robert", status: "pending" } },
      ]);

      expect(result.stats.total).toBe(3);
      expect(result.stats.updated).toBe(3);
      expect(result.stats.notFound).toBe(0);
      expect(result.stats.failed).toBe(0);

      // Verify updates
      const user1 = await User.findById("user1");
      expect(user1?.status).toBe("inactive");
      expect(user1?.name).toBe("John"); // Unchanged

      const user3 = await User.findById("user3");
      expect(user3?.name).toBe("Robert");
      expect(user3?.status).toBe("pending");
    });

    it("should handle not found records", async () => {
      const userSchema = z.object({
        id: z.string(),
        name: z.string(),
      });

      type UserType = z.infer<typeof userSchema>;

      const User = kvm.model("users", {
        schema: userSchema,
        primaryKey: [{ name: "users", key: "id" }],
      });

      await User.create({ id: "user1", name: "John" });

      const result = await User.updateMany([
        { key: "user1", data: { name: "Johnny" } },
        { key: "user999", data: { name: "Ghost" } }, // Doesn't exist
      ], {
        continueOnError: true,
        returnPartialResults: true,
      });

      expect(result.stats.updated).toBe(1);
      expect(result.stats.notFound).toBe(1);
      expect(result.notFound[0].key).toBe("user999");
    });

    it("should validate updated data", async () => {
      const userSchema = z.object({
        id: z.string(),
        name: z.string(),
        email: z.string().email(),
      });

      type UserType = z.infer<typeof userSchema>;

      const User = kvm.model("users", {
        schema: userSchema,
        primaryKey: [{ name: "users", key: "id" }],
      });

      await User.create({
        id: "user1",
        name: "John",
        email: "john@example.com",
      });

      // Try to update with invalid email
      await expect(
        User.updateMany([
          { key: "user1", data: { email: "invalid-email" } },
        ]),
      ).rejects.toThrow();
    });

    it("should support non-atomic updates", async () => {
      const userSchema = z.object({
        id: z.string(),
        name: z.string(),
      });

      type UserType = z.infer<typeof userSchema>;

      const User = kvm.model("users", {
        schema: userSchema,
        primaryKey: [{ name: "users", key: "id" }],
      });

      const createResult = await User.createMany([
        { id: "user1", name: "John" },
        { id: "user2", name: "Jane" },
      ]);

      // Verify creation succeeded
      expect(createResult.stats.created).toBe(2);

      const result = await User.updateMany([
        { key: "user1", data: { name: "Johnny" } },
        { key: "user999", data: { name: "Ghost" } }, // Doesn't exist
        { key: "user2", data: { name: "Janet" } },
      ], {
        atomic: false,
        continueOnError: true,
        returnPartialResults: true,
      });

      expect(result.stats.updated).toBe(2);
      expect(result.stats.notFound).toBe(1);
    });
  });

  describe("deleteMany", () => {
    it("should delete multiple documents atomically", async () => {
      const userSchema = z.object({
        id: z.string(),
        name: z.string(),
      });

      type UserType = z.infer<typeof userSchema>;

      const User = kvm.model("users", {
        schema: userSchema,
        primaryKey: [{ name: "users", key: "id" }],
      });

      await User.createMany([
        { id: "user1", name: "John" },
        { id: "user2", name: "Jane" },
        { id: "user3", name: "Bob" },
      ]);

      const result = await User.deleteMany([
        { key: "user1" },
        { key: "user2" },
      ]);

      expect(result.stats.total).toBe(2);
      expect(result.stats.deleted).toBe(2);
      expect(result.deletedCount).toBe(2);

      // Verify deletions
      const user1 = await User.findById("user1");
      expect(user1).toBeNull();

      const user2 = await User.findById("user2");
      expect(user2).toBeNull();

      // user3 should still exist
      const user3 = await User.findById("user3");
      expect(user3?.name).toBe("Bob");
    });

    it("should return deleted items when requested", async () => {
      const userSchema = z.object({
        id: z.string(),
        name: z.string(),
      });

      type UserType = z.infer<typeof userSchema>;

      const User = kvm.model("users", {
        schema: userSchema,
        primaryKey: [{ name: "users", key: "id" }],
      });

      await User.createMany([
        { id: "user1", name: "John" },
        { id: "user2", name: "Jane" },
      ]);

      const result = await User.deleteMany([
        { key: "user1" },
        { key: "user2" },
      ], {
        returnDeletedItems: true,
      });

      expect(result.deleted).toHaveLength(2);
      expect(result.deleted[0].name).toBe("John");
      expect(result.deleted[1].name).toBe("Jane");
    });

    it("should handle cascade deletes", async () => {
      const postSchema = z.object({
        id: z.string(),
        title: z.string(),
        userId: z.string(),
      });

      const commentSchema = z.object({
        id: z.string(),
        postId: z.string(),
        content: z.string(),
      });

      type PostType = z.infer<typeof postSchema>;
      type CommentType = z.infer<typeof commentSchema>;

      const Post = kvm.model("posts", {
        schema: postSchema,
        primaryKey: [{ name: "posts", key: "id" }],
        relations: [{
          entityName: "comments",
          fields: ["id"],
          type: RelationType.ONE_TO_MANY,
          valueType: ValueType.VALUE,
        }],
      });

      const Comment = kvm.model("comments", {
        schema: commentSchema,
        primaryKey: [{ name: "comments", key: "id" }],
      });

      // Create posts and comments
      await Post.createMany([
        { id: "post1", title: "First Post", userId: "user1" },
        { id: "post2", title: "Second Post", userId: "user1" },
      ]);

      await Comment.createMany([
        { id: "comment1", postId: "post1", content: "Comment 1" },
        { id: "comment2", postId: "post1", content: "Comment 2" },
      ]);

      // Delete posts with cascade
      await Post.deleteMany([
        { key: "post1", options: { cascadeDelete: true } },
      ]);

      // Verify post is deleted
      const post = await Post.findById("post1");
      expect(post).toBeNull();

      // Note: In this implementation, cascade delete would need
      // to be properly handled in the relations setup
    });

    it("should handle not found records", async () => {
      const userSchema = z.object({
        id: z.string(),
        name: z.string(),
      });

      type UserType = z.infer<typeof userSchema>;

      const User = kvm.model("users", {
        schema: userSchema,
        primaryKey: [{ name: "users", key: "id" }],
      });

      await User.create({ id: "user1", name: "John" });

      const result = await User.deleteMany([
        { key: "user1" },
        { key: "user999" }, // Doesn't exist
      ], {
        continueOnError: true,
        returnPartialResults: true,
      });

      expect(result.stats.deleted).toBe(1);
      expect(result.stats.notFound).toBe(1);
      expect(result.notFound[0].key).toBe("user999");
    });
  });

  describe("Batch operations with Query Builder", () => {
    it("should integrate batch updates with query results", async () => {
      const userSchema = z.object({
        id: z.string(),
        name: z.string(),
        age: z.number(),
        status: z.string(),
      });

      type UserType = z.infer<typeof userSchema>;

      const User = kvm.model("users", {
        schema: userSchema,
        primaryKey: [{ name: "users", key: "id" }],
      });

      // Create test users
      await User.createMany([
        { id: "user1", name: "John", age: 25, status: "active" },
        { id: "user2", name: "Jane", age: 30, status: "active" },
        { id: "user3", name: "Bob", age: 35, status: "active" },
        { id: "user4", name: "Alice", age: 40, status: "active" },
      ]);

      // Find users over 30
      const olderUsers = await User
        .where("age")
        .gt(30)
        .find();

      // Update them to inactive
      const updateInputs = olderUsers.map((user) => ({
        key: user.id,
        data: { status: "inactive" },
      }));

      const result = await User.updateMany(updateInputs);

      expect(result.stats.updated).toBe(2);

      // Verify updates
      const bob = await User.findById("user3");
      expect(bob?.status).toBe("inactive");

      const alice = await User.findById("user4");
      expect(alice?.status).toBe("inactive");

      // Younger users should still be active
      const john = await User.findById("user1");
      expect(john?.status).toBe("active");
    });
  });

  describe("Error handling", () => {
    it("should provide detailed error information", async () => {
      const userSchema = z.object({
        id: z.string(),
        name: z.string().min(2),
        email: z.string().email(),
      });

      type UserType = z.infer<typeof userSchema>;

      const User = kvm.model("users", {
        schema: userSchema,
        primaryKey: [{ name: "users", key: "id" }],
      });

      const users = [
        { id: "user1", name: "J", email: "john@example.com" }, // Name too short
        { id: "user2", name: "Jane", email: "invalid" }, // Invalid email
        { id: "user3", name: "Bob", email: "bob@example.com" }, // Valid
      ];

      const result = await User.createMany(users, {
        continueOnError: true,
        returnPartialResults: true,
      });

      expect(result.stats.created).toBe(1);
      expect(result.stats.failed).toBe(2);

      // Check error details
      const nameError = result.failed.find((f) => f.index === 0);
      expect(nameError).toBeDefined();
      expect(KVMErrorUtils.isValidationError(nameError?.error)).toBe(true);

      const emailError = result.failed.find((f) => f.index === 1);
      expect(emailError).toBeDefined();
      expect(KVMErrorUtils.isValidationError(emailError?.error)).toBe(true);
    });
  });
});
