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

describe("Model-Based API - Basic Tests", () => {
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

  it("should create and use a basic model", async () => {
    const userSchema = z.object({
      id: z.string(),
      name: z.string(),
    });

    const User = kvm.model("users", {
      schema: userSchema,
      primaryKey: [{ name: "users", key: "id" }],
    });

    // Create a user
    const user = await User.create({
      id: "user1",
      name: "John Doe",
    });

    expect(user.id).toBe("user1");
    expect(user.name).toBe("John Doe");
    expect(typeof user.save).toBe("function");
    expect(typeof user.delete).toBe("function");

    // Find the user
    const foundUser = await User.findById("user1");
    expect(foundUser).not.toBeNull();
    expect(foundUser!.id).toBe("user1");
    expect(foundUser!.name).toBe("John Doe");

    // Update the user
    foundUser!.name = "John Updated";
    await foundUser!.save();

    // Verify update
    const updatedUser = await User.findById("user1");
    expect(updatedUser!.name).toBe("John Updated");

    // Delete the user
    await foundUser!.delete();

    // Verify deletion
    const deletedUser = await User.findById("user1");
    expect(deletedUser).toBeNull();
  });

  it("should register and retrieve models", () => {
    const userSchema = z.object({
      id: z.string(),
      name: z.string(),
    });

    const User = kvm.model("users", {
      schema: userSchema,
      primaryKey: [{ name: "users", key: "id" }],
    });

    expect(User).toBeDefined();
    expect(User.modelName).toBe("users");
    expect(kvm.hasModel("users")).toBe(true);
    expect(kvm.getModelNames()).toContain("users");

    const retrievedUser = kvm.getModel("users");
    expect(retrievedUser).toBe(User);
  });

  it("should find multiple users", async () => {
    const userSchema = z.object({
      id: z.string(),
      name: z.string(),
    });

    const User = kvm.model("users", {
      schema: userSchema,
      primaryKey: [{ name: "users", key: "id" }],
    });

    await User.create({ id: "user1", name: "John" });
    await User.create({ id: "user2", name: "Jane" });

    const users = await User.findMany();
    expect(users).toHaveLength(2);

    const first = await User.findFirst();
    expect(first).not.toBeNull();
    expect(first!.id).toBe("user1");
  });

  it("should handle errors appropriately", async () => {
    const userSchema = z.object({
      id: z.string(),
      name: z.string(),
    });

    const User = kvm.model("users", {
      schema: userSchema,
      primaryKey: [{ name: "users", key: "id" }],
    });

    // Test not found
    const notFound = await User.findById("nonexistent");
    expect(notFound).toBeNull();

    // Test findByIdOrThrow
    await expect(User.findByIdOrThrow("nonexistent"))
      .rejects.toThrow("users not found by id: nonexistent");
  });
});
