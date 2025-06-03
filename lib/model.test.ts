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
import { ValueType } from "./types.ts";

describe("Model-Based API", () => {
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

  describe("KVM Class", () => {
    it("should create and register models", () => {
      const userSchema = z.object({
        id: z.string(),
        name: z.string(),
        email: z.string().email(),
      });

      const User = kvm.model('users', {
        schema: userSchema,
        primaryKey: [{ name: "users", key: "id" }],
      });

      expect(User).toBeDefined();
      expect(User.modelName).toBe("users");
      expect(kvm.hasModel("users")).toBe(true);
      expect(kvm.getModelNames()).toContain("users");
    });

    it("should return existing model when called again", () => {
      const userSchema = z.object({
        id: z.string(),
        name: z.string(),
      });

      const User1 = kvm.model('users', {
        schema: userSchema,
        primaryKey: [{ name: "users", key: "id" }],
      });

      const User2 = kvm.model('users', {
        schema: userSchema,
        primaryKey: [{ name: "users", key: "id" }],
      });

      expect(User1).toBe(User2);
    });

    it("should get model by name", () => {
      const userSchema = z.object({
        id: z.string(),
        name: z.string(),
      });

      const User = kvm.model('users', {
        schema: userSchema,
        primaryKey: [{ name: "users", key: "id" }],
      });

      const retrievedUser = kvm.getModel('users');
      expect(retrievedUser).toBe(User);
    });

    it("should remove models", () => {
      const userSchema = z.object({
        id: z.string(),
        name: z.string(),
      });

      kvm.model('users', {
        schema: userSchema,
        primaryKey: [{ name: "users", key: "id" }],
      });

      expect(kvm.hasModel("users")).toBe(true);
      expect(kvm.removeModel("users")).toBe(true);
      expect(kvm.hasModel("users")).toBe(false);
    });
  });

  describe("Model CRUD Operations", () => {
    let User: any;

    beforeAll(() => {
      const userSchema = z.object({
        id: z.string(),
        name: z.string(),
        email: z.string().email(),
        age: z.number(),
      });

      User = kvm.model('users', {
        schema: userSchema,
        primaryKey: [{ name: "users", key: "id" }],
        secondaryIndexes: [{
          name: "users_by_email",
          key: [{ name: "users_by_email", key: "email" }],
          valueType: ValueType.KEY,
          valueKey: "id",
        }],
      });
    });

    it("should create a document", async () => {
      const userData = {
        id: "user1",
        name: "John Doe",
        email: "john@example.com",
        age: 30,
      };

      const user = await User.create(userData);

      expect(user.id).toBe("user1");
      expect(user.name).toBe("John Doe");
      expect(user.email).toBe("john@example.com");
      expect(user.age).toBe(30);
      expect(typeof user.save).toBe("function");
      expect(typeof user.delete).toBe("function");
    });

    it("should find document by ID", async () => {
      const userData = {
        id: "user1",
        name: "John Doe",
        email: "john@example.com",
        age: 30,
      };

      await User.create(userData);
      const user = await User.findById("user1");

      expect(user).not.toBeNull();
      expect(user!.id).toBe("user1");
      expect(user!.name).toBe("John Doe");
    });

    it("should return null when document not found", async () => {
      const user = await User.findById("nonexistent");
      expect(user).toBeNull();
    });

    it("should throw when findByIdOrThrow doesn't find document", async () => {
      await expect(User.findByIdOrThrow("nonexistent"))
        .rejects.toThrow("users with id 'nonexistent' not found");
    });

    it("should find document by secondary index", async () => {
      const userData = {
        id: "user1",
        name: "John Doe",
        email: "john@example.com",
        age: 30,
      };

      await User.create(userData);
      const user = await User.findUnique("john@example.com", "users_by_email");

      expect(user).not.toBeNull();
      expect(user!.email).toBe("john@example.com");
    });

    it("should find multiple documents", async () => {
      await User.create({
        id: "user1",
        name: "John Doe",
        email: "john@example.com",
        age: 30,
      });

      await User.create({
        id: "user2",
        name: "Jane Doe",
        email: "jane@example.com",
        age: 25,
      });

      const users = await User.findMany();
      expect(users).toHaveLength(2);
    });

    it("should find first document", async () => {
      await User.create({
        id: "user1",
        name: "John Doe",
        email: "john@example.com",
        age: 30,
      });

      const user = await User.findFirst();
      expect(user).not.toBeNull();
      expect(user!.id).toBe("user1");
    });

    it("should update a document via save", async () => {
      const user = await User.create({
        id: "user1",
        name: "John Doe",
        email: "john@example.com",
        age: 30,
      });

      user.age = 31;
      user.name = "John Updated";
      await user.save();

      const updatedUser = await User.findById("user1");
      expect(updatedUser!.age).toBe(31);
      expect(updatedUser!.name).toBe("John Updated");
    });

    it("should update a document via update method", async () => {
      const user = await User.create({
        id: "user1",
        name: "John Doe",
        email: "john@example.com",
        age: 30,
      });

      await user.update({ age: 32, name: "John Again" });

      expect(user.age).toBe(32);
      expect(user.name).toBe("John Again");

      const reloadedUser = await User.findById("user1");
      expect(reloadedUser!.age).toBe(32);
    });

    it("should reload a document", async () => {
      const user = await User.create({
        id: "user1",
        name: "John Doe",
        email: "john@example.com",
        age: 30,
      });

      // Simulate external change
      await User.create({
        id: "user1",
        name: "John Modified",
        email: "john@example.com",
        age: 35,
      });

      await user.reload();
      expect(user.name).toBe("John Modified");
      expect(user.age).toBe(35);
    });

    it("should delete a document", async () => {
      const user = await User.create({
        id: "user1",
        name: "John Doe",
        email: "john@example.com",
        age: 30,
      });

      await user.delete();

      const deletedUser = await User.findById("user1");
      expect(deletedUser).toBeNull();
    });

    it("should handle batch operations", async () => {
      await User.create({
        id: "user1",
        name: "John",
        email: "john@example.com",
        age: 30,
      });

      await User.create({
        id: "user2",
        name: "Jane",
        email: "jane@example.com",
        age: 25,
      });

      // Test updateMany
      const updated = await User.updateMany([
        { key: "user1", data: { age: 31 } },
        { key: "user2", data: { age: 26 } },
      ]);

      expect(updated).toHaveLength(2);
      expect(updated[0].age).toBe(31);
      expect(updated[1].age).toBe(26);

      // Test deleteMany
      const deleted = await User.deleteMany([
        { key: "user1" },
        { key: "user2" },
      ]);

      expect(deleted).toHaveLength(2);
    });
  });

  describe("Error Handling", () => {
    let User: any;

    beforeAll(() => {
      const userSchema = z.object({
        id: z.string(),
        name: z.string(),
      });

      User = kvm.model('users', {
        schema: userSchema,
        primaryKey: [{ name: "users", key: "id" }],
      });
    });

    it("should handle creation failures", async () => {
      // Mock failing KV
      const originalKv = kvm.getKv();
      const mockKv = {
        ...originalKv,
        atomic: () => ({
          set: () => ({ commit: async () => ({ ok: false }) }),
          commit: async () => ({ ok: false }),
        }),
      } as unknown as Deno.Kv;

      // Temporarily replace KV
      (User as any).kv = mockKv;

      await expect(User.create({ id: "user1", name: "John" }))
        .rejects.toThrow("Failed to create users");

      // Restore original KV
      (User as any).kv = originalKv;
    });

    it("should handle findUniqueOrThrow errors", async () => {
      await expect(User.findUniqueOrThrow("nonexistent"))
        .rejects.toThrow("Not found");
    });

    it("should handle findFirstOrThrow errors", async () => {
      await expect(User.findFirstOrThrow())
        .rejects.toThrow("Not found");
    });
  });
});