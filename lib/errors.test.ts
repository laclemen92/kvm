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
  KVMConcurrencyError,
  KVMConfigurationError,
  KVMConnectionError,
  KVMConstraintError,
  KVMError,
  KVMErrorUtils,
  KVMNotFoundError,
  KVMOperationError,
  KVMQueryError,
  KVMValidationError,
} from "./errors.ts";

describe("Enhanced Error Handling", () => {
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

  describe("Error Classes", () => {
    it("should create KVMValidationError with correct properties", () => {
      const error = new KVMValidationError(
        "age",
        -5,
        "must be positive",
        "User",
      );

      // KVMError is abstract, so we check for the concrete type instead
      expect(error).toBeInstanceOf(KVMValidationError);
      expect(error.name).toBe("KVMValidationError");
      expect(error.code).toBe("KVM_VALIDATION_ERROR");
      expect(error.field).toBe("age");
      expect(error.value).toBe(-5);
      expect(error.rule).toBe("must be positive");
      expect(error.modelName).toBe("User");
      expect(error.message).toBe(
        "User: Validation failed for field 'age': must be positive",
      );
    });

    it("should create KVMNotFoundError with correct properties", () => {
      const error = new KVMNotFoundError("User", "user123", "id");

      // KVMError is abstract, so we check for the concrete type instead
      expect(error).toBeInstanceOf(KVMNotFoundError);
      expect(error.name).toBe("KVMNotFoundError");
      expect(error.code).toBe("KVM_NOT_FOUND_ERROR");
      expect(error.modelName).toBe("User");
      expect(error.identifier).toBe("user123");
      expect(error.searchType).toBe("id");
      expect(error.message).toBe("User not found by id: user123");
    });

    it("should create KVMNotFoundError with object identifier", () => {
      const error = new KVMNotFoundError(
        "User",
        { email: "test@example.com" },
        "unique",
      );

      expect(error.identifier).toEqual({ email: "test@example.com" });
      expect(error.message).toBe(
        'User not found by unique: {"email":"test@example.com"}',
      );
    });

    it("should create KVMQueryError with query context", () => {
      const error = new KVMQueryError(
        "Invalid field name",
        { field: "nonexistentField", operator: "equals" },
      );

      // KVMError is abstract, so we check for the concrete type instead
      expect(error.name).toBe("KVMQueryError");
      expect(error.code).toBe("KVM_QUERY_ERROR");
      expect(error.message).toBe("Query error: Invalid field name");
      expect(error.queryContext).toEqual({
        field: "nonexistentField",
        operator: "equals",
      });
    });

    it("should serialize error to JSON", () => {
      const error = new KVMValidationError(
        "email",
        "invalid",
        "must be valid email",
        "User",
      );
      const json = error.toJSON();

      expect(json).toEqual({
        name: "KVMValidationError",
        code: "KVM_VALIDATION_ERROR",
        message:
          "User: Validation failed for field 'email': must be valid email",
        context: {
          field: "email",
          value: "invalid",
          rule: "must be valid email",
          modelName: "User",
        },
        stack: expect.any(String),
      });
    });
  });

  describe("Error Utils", () => {
    it("should correctly identify error types", () => {
      const validationError = new KVMValidationError("field", "value", "rule");
      const notFoundError = new KVMNotFoundError("Model", "id");
      const regularError = new Error("Regular error");

      expect(KVMErrorUtils.isKVMError(validationError)).toBe(true);
      expect(KVMErrorUtils.isKVMError(notFoundError)).toBe(true);
      expect(KVMErrorUtils.isKVMError(regularError)).toBe(false);

      expect(KVMErrorUtils.isValidationError(validationError)).toBe(true);
      expect(KVMErrorUtils.isValidationError(notFoundError)).toBe(false);

      expect(KVMErrorUtils.isNotFoundError(notFoundError)).toBe(true);
      expect(KVMErrorUtils.isNotFoundError(validationError)).toBe(false);
    });

    it("should wrap non-KVM errors", () => {
      const originalError = new Error("Database connection failed");
      const wrappedError = KVMErrorUtils.wrap(originalError, "create", "User");

      expect(wrappedError).toBeInstanceOf(KVMOperationError);
      expect(wrappedError.operation).toBe("create");
      expect(wrappedError.modelName).toBe("User");
      expect(wrappedError.message).toBe(
        "User: create operation failed: Database connection failed",
      );
      expect(wrappedError.originalError).toBe(originalError);
      expect(wrappedError.context?.originalError).toBe(
        "Database connection failed",
      );
    });

    it("should not wrap KVM errors", () => {
      const kvmError = new KVMValidationError("field", "value", "rule");
      const result = KVMErrorUtils.wrap(kvmError as any, "create");

      expect(result).toBe(kvmError);
    });

    it("should create validation error from Zod error", () => {
      const zodError = {
        name: "ZodError",
        errors: [{
          path: ["email"],
          message: "Invalid email format",
          received: "invalid-email",
        }],
      };

      const kvmError = KVMErrorUtils.fromZodError(zodError, "User");

      expect(kvmError).toBeInstanceOf(KVMValidationError);
      expect(kvmError.field).toBe("email");
      expect(kvmError.rule).toBe("Invalid email format");
      expect(kvmError.value).toBe("invalid-email");
      expect(kvmError.modelName).toBe("User");
    });

    it("should get user-friendly error messages", () => {
      const kvmError = new KVMNotFoundError("User", "user123");
      const zodError = { name: "ZodError", message: "Validation failed" };
      const regularError = new Error("Something went wrong");

      expect(KVMErrorUtils.getUserMessage(kvmError)).toBe(
        "User not found by id: user123",
      );
      expect(KVMErrorUtils.getUserMessage(zodError)).toBe(
        "Invalid data provided",
      );
      expect(KVMErrorUtils.getUserMessage(regularError)).toBe(
        "An unexpected error occurred",
      );
    });

    it("should identify retryable errors", () => {
      const connectionError = new KVMConnectionError();
      const concurrencyError = new KVMConcurrencyError("update");
      const atomicError = new KVMOperationError("atomic", "Failed");
      const validationError = new KVMValidationError("field", "value", "rule");

      expect(KVMErrorUtils.isRetryable(connectionError)).toBe(true);
      expect(KVMErrorUtils.isRetryable(concurrencyError)).toBe(true);
      expect(KVMErrorUtils.isRetryable(atomicError)).toBe(true);
      expect(KVMErrorUtils.isRetryable(validationError)).toBe(false);
    });
  });

  describe("Model Error Integration", () => {
    it("should throw KVMValidationError for invalid data", async () => {
      const userSchema = z.object({
        id: z.string(),
        email: z.string().email(),
        age: z.number().positive(),
      });

      type UserType = z.infer<typeof userSchema>;

      const User = kvm.model("users", {
        schema: userSchema,
        primaryKey: [{ name: "users", key: "id" }],
      });

      // Test create with invalid data (negative age which violates positive() constraint)
      await expect(
        User.create({
          id: "user1",
          email: "valid@example.com",
          age: -5,
        } as any), // Force type bypass to test validation
      ).rejects.toThrow(KVMValidationError);

      try {
        await User.create({
          id: "user1",
          email: "valid@example.com",
          age: -5,
        } as any);
      } catch (error) {
        expect(error).toBeInstanceOf(KVMValidationError);
        expect((error as KVMValidationError).field).toBe("age");
        expect((error as KVMValidationError).modelName).toBe("users");
      }
    });

    it("should throw KVMNotFoundError for missing documents", async () => {
      const userSchema = z.object({
        id: z.string(),
        name: z.string(),
      });

      type UserType = z.infer<typeof userSchema>;

      const User = kvm.model("users", {
        schema: userSchema,
        primaryKey: [{ name: "users", key: "id" }],
      });

      // Test findByIdOrThrow
      await expect(
        User.findByIdOrThrow("nonexistent"),
      ).rejects.toThrow(KVMNotFoundError);

      try {
        await User.findByIdOrThrow("nonexistent");
      } catch (error) {
        expect(error).toBeInstanceOf(KVMNotFoundError);
        expect((error as KVMNotFoundError).modelName).toBe("users");
        expect((error as KVMNotFoundError).identifier).toBe("nonexistent");
        expect((error as KVMNotFoundError).searchType).toBe("id");
      }

      // Test findFirstOrThrow
      await expect(
        User.findFirstOrThrow(),
      ).rejects.toThrow(KVMNotFoundError);

      try {
        await User.findFirstOrThrow();
      } catch (error) {
        expect(error).toBeInstanceOf(KVMNotFoundError);
        expect((error as KVMNotFoundError).searchType).toBe("first");
      }
    });

    it("should throw KVMNotFoundError for reload on deleted document", async () => {
      const userSchema = z.object({
        id: z.string(),
        name: z.string(),
      });

      type UserType = z.infer<typeof userSchema>;

      const User = kvm.model("users", {
        schema: userSchema,
        primaryKey: [{ name: "users", key: "id" }],
      });

      // Create and then delete a user
      const user = await User.create({
        id: "user1",
        name: "John",
      });

      await user.delete();

      // Try to reload the deleted user
      await expect(user.reload()).rejects.toThrow(KVMNotFoundError);
    });
  });

  describe("Query Builder Error Integration", () => {
    it("should throw KVMQueryError for invalid query parameters", async () => {
      const userSchema = z.object({
        id: z.string(),
        name: z.string(),
        age: z.number(),
      });

      type UserType = z.infer<typeof userSchema>;

      const User = kvm.model("users", {
        schema: userSchema,
        primaryKey: [{ name: "users", key: "id" }],
      });

      // Test negative limit
      expect(() => {
        User.query().limit(-1);
      }).toThrow(KVMQueryError);

      // Test negative offset
      expect(() => {
        User.query().offset(-1);
      }).toThrow(KVMQueryError);
    });

    it("should throw KVMNotFoundError for findOneOrThrow with no results", async () => {
      const userSchema = z.object({
        id: z.string(),
        name: z.string(),
        age: z.number(),
      });

      type UserType = z.infer<typeof userSchema>;

      const User = kvm.model("users", {
        schema: userSchema,
        primaryKey: [{ name: "users", key: "id" }],
      });

      await expect(
        User.where("name").equals("NonExistent").findOneOrThrow(),
      ).rejects.toThrow(KVMNotFoundError);

      try {
        await User.where("name").equals("NonExistent").findOneOrThrow();
      } catch (error) {
        expect(error).toBeInstanceOf(KVMNotFoundError);
        expect((error as KVMNotFoundError).searchType).toBe("query");
      }
    });
  });

  describe("Error Context and Debugging", () => {
    it("should provide helpful context in error messages", () => {
      const constraintError = new KVMConstraintError(
        "unique",
        "email",
        "duplicate@example.com",
        "User",
      );

      expect(constraintError.message).toBe(
        "User: Constraint violation (unique) on field 'email' with value: duplicate@example.com",
      );
      expect(constraintError.context).toEqual({
        constraintType: "unique",
        field: "email",
        value: "duplicate@example.com",
        modelName: "User",
      });
    });

    it("should preserve stack traces for wrapped errors", () => {
      const originalError = new Error("Original error");
      const wrappedError = KVMErrorUtils.wrap(originalError, "create", "User");

      expect(wrappedError.stack).toBe(originalError.stack);
    });

    it("should handle configuration errors", () => {
      const configError = new KVMConfigurationError(
        "Invalid schema definition",
        "models.user.schema",
      );

      expect(configError.message).toBe(
        "Configuration error in models.user.schema: Invalid schema definition",
      );
      expect(configError.configPath).toBe("models.user.schema");
    });
  });
});
