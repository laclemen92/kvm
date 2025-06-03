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
import {
  auditPlugin,
  KVMHookManager,
  timestampsPlugin,
  validationPlugin,
} from "./middleware.ts";
import { HookExecutionError, HookTimeoutError } from "./middleware-types.ts";

describe("Middleware/Hooks System", () => {
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

  describe("Hook Manager", () => {
    it("should register and execute pre-hooks", async () => {
      const hookManager = new KVMHookManager();
      const executionOrder: string[] = [];

      hookManager.pre("create", function (context, next) {
        executionOrder.push("pre-create-1");
        next();
      });

      hookManager.pre("create", function (context, next) {
        executionOrder.push("pre-create-2");
        next();
      }, { priority: 10 }); // Higher priority, should run first

      const context = {
        modelName: "test",
        operation: "create" as const,
      };

      const result = await hookManager.executePreHooks("create", context);

      expect(result.success).toBe(true);
      expect(result.executed).toBe(2);
      expect(executionOrder).toEqual(["pre-create-2", "pre-create-1"]);
    });

    it("should register and execute post-hooks", async () => {
      const hookManager = new KVMHookManager();
      const executionOrder: string[] = [];

      hookManager.post("create", function (context, result) {
        executionOrder.push("post-create-1");
      });

      hookManager.post("create", function (context, result) {
        executionOrder.push("post-create-2");
      });

      const context = {
        modelName: "test",
        operation: "create" as const,
      };

      const result = await hookManager.executePostHooks("create", context, {});

      expect(result.success).toBe(true);
      expect(result.executed).toBe(2);
      expect(executionOrder).toEqual(["post-create-1", "post-create-2"]);
    });

    it("should handle hook errors gracefully", async () => {
      const hookManager = new KVMHookManager();

      hookManager.pre("create", function (context, next) {
        next(new Error("Hook failed"));
      });

      const context = {
        modelName: "test",
        operation: "create" as const,
      };

      const result = await hookManager.executePreHooks("create", context);

      expect(result.success).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toBeInstanceOf(HookExecutionError);
    });

    it("should handle hook timeouts", async () => {
      const hookManager = new KVMHookManager();

      hookManager.pre("create", function (context, next) {
        // Never call next() - this will timeout
      }, { timeout: 100 });

      const context = {
        modelName: "test",
        operation: "create" as const,
      };

      const result = await hookManager.executePreHooks("create", context);

      expect(result.success).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toBeInstanceOf(HookTimeoutError);
    });

    it("should execute parallel hooks concurrently", async () => {
      const hookManager = new KVMHookManager();
      const executionTimes: number[] = [];

      hookManager.pre("create", async function (context, next) {
        const start = Date.now();
        await new Promise((resolve) => setTimeout(resolve, 50));
        executionTimes.push(Date.now() - start);
        next();
      }, { parallel: true });

      hookManager.pre("create", async function (context, next) {
        const start = Date.now();
        await new Promise((resolve) => setTimeout(resolve, 50));
        executionTimes.push(Date.now() - start);
        next();
      }, { parallel: true });

      const context = {
        modelName: "test",
        operation: "create" as const,
      };

      const start = Date.now();
      const result = await hookManager.executePreHooks("create", context);
      const totalTime = Date.now() - start;

      expect(result.success).toBe(true);
      expect(result.executed).toBe(2);
      // Parallel execution should be faster than sequential
      expect(totalTime).toBeLessThan(80); // Much less than 100ms if truly parallel
    });

    it("should remove hooks by ID", () => {
      const hookManager = new KVMHookManager();

      hookManager.pre("create", function (context, next) {
        next();
      });
      hookManager.pre("update", function (context, next) {
        next();
      });

      const hooks = hookManager.getHooks();
      expect(hooks).toHaveLength(2);

      const removed = hookManager.removeHook(hooks[0].id);
      expect(removed).toBe(true);
      expect(hookManager.getHooks()).toHaveLength(1);
    });

    it("should remove hooks by type", () => {
      const hookManager = new KVMHookManager();

      hookManager.pre("create", function (context, next) {
        next();
      });
      hookManager.post("create", function (context, result) {});
      hookManager.pre("update", function (context, next) {
        next();
      });

      expect(hookManager.getHooks()).toHaveLength(3);

      const removed = hookManager.removeHooks("create");
      expect(removed).toBe(2);
      expect(hookManager.getHooks()).toHaveLength(1);
      expect(hookManager.getHooks()[0].type).toBe("update");
    });
  });

  describe("Model Integration", () => {
    it("should execute hooks during create operations", async () => {
      const userSchema = z.object({
        id: z.string(),
        name: z.string(),
        email: z.string().email(),
        createdAt: z.date().optional(),
      });

      type UserType = z.infer<typeof userSchema>;

      const User = kvm.model("users", {
        schema: userSchema,
        primaryKey: [{ name: "users", key: "id" }],
      });

      const executionOrder: string[] = [];

      // Register hooks
      User.pre("create", function (context, next) {
        executionOrder.push("pre-create");
        if (context.input) {
          (context.input as any).createdAt = new Date();
        }
        next();
      });

      User.post("create", function (context, result) {
        executionOrder.push("post-create");
      });

      User.pre("save", function (context, next) {
        executionOrder.push("pre-save");
        next();
      });

      User.post("save", function (context, result) {
        executionOrder.push("post-save");
      });

      const user = await User.create({
        id: "user1",
        name: "John Doe",
        email: "john@example.com",
      } as UserType);

      expect(executionOrder).toEqual([
        "pre-create",
        "pre-save",
        "post-create",
        "post-save",
      ]);
      expect(user.createdAt).toBeInstanceOf(Date);
    });

    it("should execute hooks during update operations", async () => {
      const userSchema = z.object({
        id: z.string(),
        name: z.string(),
        email: z.string().email(),
        updatedAt: z.date().optional(),
      });

      type UserType = z.infer<typeof userSchema>;

      const User = kvm.model("users", {
        schema: userSchema,
        primaryKey: [{ name: "users", key: "id" }],
      });

      const executionOrder: string[] = [];

      User.pre("update", function (context, next) {
        executionOrder.push("pre-update");
        if (context.input) {
          (context.input as any).updatedAt = new Date();
        }
        next();
      });

      User.post("update", function (context, result) {
        executionOrder.push("post-update");
      });

      const user = await User.create({
        id: "user1",
        name: "John Doe",
        email: "john@example.com",
      } as UserType);

      await user.update({ name: "Jane Doe" });

      expect(executionOrder).toEqual(["pre-update", "post-update"]);
      expect(user.updatedAt).toBeInstanceOf(Date);
    });

    it("should execute hooks during delete operations", async () => {
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

      const executionOrder: string[] = [];
      let deletedUser: any = null;

      User.pre("delete", function (context, next) {
        executionOrder.push("pre-delete");
        deletedUser = { ...this };
        next();
      });

      User.post("delete", function (context, result) {
        executionOrder.push("post-delete");
      });

      const user = await User.create({
        id: "user1",
        name: "John Doe",
        email: "john@example.com",
      } as UserType);

      await user.delete();

      expect(executionOrder).toEqual(["pre-delete", "post-delete"]);
      expect(deletedUser.name).toBe("John Doe");
    });

    it("should execute hooks during find operations", async () => {
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

      const executionOrder: string[] = [];

      User.pre("findOne", function (context, next) {
        executionOrder.push("pre-find");
        next();
      });

      User.post("findOne", function (context, result) {
        executionOrder.push("post-find");
      });

      await User.create({
        id: "user1",
        name: "John Doe",
        email: "john@example.com",
      } as UserType);

      const found = await User.findById("user1");

      expect(executionOrder).toEqual(["pre-find", "post-find"]);
      expect(found?.name).toBe("John Doe");
    });
  });

  describe("Built-in Plugins", () => {
    it("should apply timestamps plugin correctly", async () => {
      const userSchema = z.object({
        id: z.string(),
        name: z.string(),
        email: z.string().email(),
        createdAt: z.date().optional(),
        updatedAt: z.date().optional(),
      });

      type UserType = z.infer<typeof userSchema>;

      const User = kvm.model("users", {
        schema: userSchema,
        primaryKey: [{ name: "users", key: "id" }],
      });

      // Apply timestamps plugin
      User.use(timestampsPlugin());

      const user = await User.create({
        id: "user1",
        name: "John Doe",
        email: "john@example.com",
      } as UserType);

      expect(user.createdAt).toBeInstanceOf(Date);
      expect(user.updatedAt).toBeInstanceOf(Date);

      const originalUpdatedAt = user.updatedAt;

      // Wait a bit to ensure different timestamps
      await new Promise((resolve) => setTimeout(resolve, 10));

      await user.update({ name: "Jane Doe" });

      expect(user.updatedAt).toBeInstanceOf(Date);
      expect(user.updatedAt!.getTime()).toBeGreaterThan(
        originalUpdatedAt!.getTime(),
      );
    });

    it("should apply validation plugin correctly", async () => {
      const userSchema = z.object({
        id: z.string(),
        name: z.string(),
        email: z.string().email(),
        age: z.number(),
      });

      type UserType = z.infer<typeof userSchema>;

      const User = kvm.model("users", {
        schema: userSchema,
        primaryKey: [{ name: "users", key: "id" }],
      });

      // Apply validation plugin with custom rules
      User.use(validationPlugin({
        rules: {
          age: (value) => value >= 18, // Must be 18 or older
          name: (value) => value.length >= 2, // Name must be at least 2 characters
        },
      }));

      // This should work (valid data)
      const user = await User.create({
        id: "user1",
        name: "John Doe",
        email: "john@example.com",
        age: 25,
      } as UserType);

      expect(user.name).toBe("John Doe");

      // This should fail (age < 18)
      await expect(User.create({
        id: "user2",
        name: "Jane Doe",
        email: "jane@example.com",
        age: 16,
      } as UserType)).rejects.toThrow();
    });

    it("should apply audit plugin correctly", async () => {
      const userSchema = z.object({
        id: z.string(),
        name: z.string(),
        email: z.string().email(),
        createdBy: z.string().optional(),
        updatedBy: z.string().optional(),
      });

      type UserType = z.infer<typeof userSchema>;

      const User = kvm.model("users", {
        schema: userSchema,
        primaryKey: [{ name: "users", key: "id" }],
      });

      // Apply audit plugin
      User.use(auditPlugin({
        getCurrentUser: () => "admin-user",
      }));

      const user = await User.create({
        id: "user1",
        name: "John Doe",
        email: "john@example.com",
      } as UserType);

      expect(user.createdBy).toBe("admin-user");

      await user.update({ name: "Jane Doe" });

      expect(user.updatedBy).toBe("admin-user");
    });
  });

  describe("Error Handling", () => {
    it("should handle hook failures during create", async () => {
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

      User.pre("create", function (context, next) {
        next(new Error("Pre-create hook failed"));
      });

      await expect(User.create({
        id: "user1",
        name: "John Doe",
        email: "john@example.com",
      } as UserType)).rejects.toThrow("Pre-create hook failed");
    });

    it("should allow disabling hooks", async () => {
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

      let hookExecuted = false;

      User.pre("create", function (context, next) {
        hookExecuted = true;
        next();
      });

      // Disable hooks
      User.setHooksEnabled(false);

      await User.create({
        id: "user1",
        name: "John Doe",
        email: "john@example.com",
      } as UserType);

      expect(hookExecuted).toBe(false);

      // Re-enable hooks
      User.setHooksEnabled(true);
      hookExecuted = false;

      await User.create({
        id: "user2",
        name: "Jane Doe",
        email: "jane@example.com",
      } as UserType);

      expect(hookExecuted).toBe(true);
    });

    it("should handle async hooks that return promises", async () => {
      const userSchema = z.object({
        id: z.string(),
        name: z.string(),
        email: z.string().email(),
        processedBy: z.string().optional(),
      });

      type UserType = z.infer<typeof userSchema>;

      const User = kvm.model("users", {
        schema: userSchema,
        primaryKey: [{ name: "users", key: "id" }],
      });

      User.pre("create", async function (context, next) {
        // Simulate async operation
        await new Promise((resolve) => setTimeout(resolve, 10));
        if (context.input) {
          (context.input as any).processedBy = "async-hook";
        }
        next();
      });

      const user = await User.create({
        id: "user1",
        name: "John Doe",
        email: "john@example.com",
      } as UserType);

      expect(user.processedBy).toBe("async-hook");
    });
  });

  describe("Hook Management", () => {
    it("should clear all hooks", () => {
      const userSchema = z.object({
        id: z.string(),
        name: z.string(),
      });

      const User = kvm.model("users", {
        schema: userSchema,
        primaryKey: [{ name: "users", key: "id" }],
      });

      User.pre("create", function (context, next) {
        next();
      });
      User.post("create", function (context, result) {});
      User.pre("update", function (context, next) {
        next();
      });

      expect(User.getHooks()).toHaveLength(3);

      User.clearHooks();

      expect(User.getHooks()).toHaveLength(0);
    });

    it("should get hooks by type and timing", () => {
      const userSchema = z.object({
        id: z.string(),
        name: z.string(),
      });

      const User = kvm.model("users", {
        schema: userSchema,
        primaryKey: [{ name: "users", key: "id" }],
      });

      User.pre("create", function (context, next) {
        next();
      });
      User.post("create", function (context, result) {});
      User.pre("update", function (context, next) {
        next();
      });

      expect(User.getHooks("create")).toHaveLength(2);
      expect(User.getHooks("create", "pre")).toHaveLength(1);
      expect(User.getHooks("create", "post")).toHaveLength(1);
      expect(User.getHooks("update")).toHaveLength(1);
    });
  });
});
