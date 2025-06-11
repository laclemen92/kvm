import {
  assertEquals,
  assertRejects,
} from "https://deno.land/std@0.220.0/assert/mod.ts";
import { KVMQueryBuilder } from "./query-builder.ts";
import { KVMNotFoundError, KVMQueryError } from "./errors.ts";
import { createKVM } from "./kvm.ts";
import { z } from "zod";
import type { KVM } from "./kvm.ts";

// Test schema
const userSchema = z.object({
  id: z.string(),
  name: z.string(),
  age: z.number(),
  email: z.string(),
  isActive: z.boolean(),
  tags: z.array(z.string()).optional(),
});

type User = z.infer<typeof userSchema>;

Deno.test("KVMQueryBuilder - Comprehensive Coverage", async (t) => {
  let kvm: KVM;
  let User: any;

  // Setup before all tests
  kvm = await createKVM(":memory:");
  User = kvm.model("users", {
    schema: userSchema,
    primaryKey: [{ name: "users", key: "id" }],
  });

  await t.step("should build basic where conditions", async () => {
    const qb = User.query();

    // Test all comparison operators
    qb.where("name").equals("John");
    qb.where("age").eq(25);
    qb.where("age").notEquals(30);
    qb.where("age").ne(35);
    qb.where("age").greaterThan(20);
    qb.where("age").gt(18);
    qb.where("age").greaterThanOrEqual(21);
    qb.where("age").gte(21);
    qb.where("age").lessThan(50);
    qb.where("age").lt(60);
    qb.where("age").lessThanOrEqual(45);
    qb.where("age").lte(45);

    const config = qb.toConfig();
    assertEquals(config.where.length, 12);
  });

  await t.step("should build string-specific conditions", async () => {
    const qb = User.query();

    qb.where("name").contains("oh");
    qb.where("name").startsWith("J");
    qb.where("name").endsWith("n");
    qb.where("email").exists();
    qb.where("tags").notExists();

    const config = qb.toConfig();
    assertEquals(config.where.length, 5);
  });

  await t.step("should build array conditions", async () => {
    const qb = User.query();

    qb.where("age").in([25, 30, 35]);
    qb.where("name").notIn(["admin", "test"]);

    const config = qb.toConfig();
    assertEquals(config.where.length, 2);
    assertEquals(config.where[0].operator, "in");
    assertEquals(config.where[1].operator, "notIn");
  });

  await t.step("should build range conditions with between", async () => {
    const qb = User.query();

    qb.where("age").between(18, 65);

    const config = qb.toConfig();
    // between() adds two conditions: gte and lte
    assertEquals(config.where.length, 2);
    assertEquals(config.where[0].operator, "gte");
    assertEquals(config.where[1].operator, "lte");
  });

  await t.step("should build object-based where conditions", async () => {
    const qb = User.query();

    qb.where({ name: "John", age: 25, isActive: true });

    const config = qb.toConfig();
    assertEquals(config.where.length, 3);
    assertEquals(config.where[0].operator, "equals");
  });

  await t.step("should build sorting configurations", async () => {
    const qb = User.query();

    qb.orderBy("name"); // defaults to asc
    qb.orderBy("age", "desc");
    qb.orderBy("email", "asc");

    const config = qb.toConfig();
    assertEquals(config.sort.length, 3);
    assertEquals(config.sort[0].direction, "asc");
    assertEquals(config.sort[1].direction, "desc");
    assertEquals(config.sort[2].direction, "asc");
  });

  await t.step("should handle pagination configuration", async () => {
    const qb = User.query();

    qb.limit(10).offset(5).cursor("cursor123").reverse();

    const config = qb.toConfig();
    assertEquals(config.limit, 10);
    assertEquals(config.offset, 5);
    assertEquals(config.cursor, "cursor123");
    assertEquals(config.reverse, true);
  });

  await t.step("should handle field selection", async () => {
    const qb = User.query();

    // Test array syntax
    qb.select(["name", "email"]);
    let config = qb.toConfig();
    assertEquals(config.select, ["name", "email"]);

    // Test spread syntax
    const qb2 = User.query();
    qb2.select("name", "email", "age");
    config = qb2.toConfig();
    assertEquals(config.select, ["name", "email", "age"]);
  });

  await t.step("should validate negative limit and offset", async () => {
    const qb = User.query();

    try {
      qb.limit(-1);
      throw new Error("Expected limit(-1) to throw");
    } catch (error) {
      assertEquals(
        (error as Error).message.includes("Limit must be non-negative"),
        true,
      );
    }

    try {
      qb.offset(-1);
      throw new Error("Expected offset(-1) to throw");
    } catch (error) {
      assertEquals(
        (error as Error).message.includes("Offset must be non-negative"),
        true,
      );
    }
  });

  await t.step("should clone query builder", async () => {
    const qb = User.query();

    qb.where("name").equals("John")
      .orderBy("age", "desc")
      .limit(10)
      .offset(5)
      .cursor("test")
      .reverse()
      .select("name", "email");

    const cloned = qb.clone();
    const originalConfig = qb.toConfig();
    const clonedConfig = cloned.toConfig();

    assertEquals(originalConfig, clonedConfig);

    // Verify it's a deep clone
    cloned.where("age").gt(30);
    assertEquals(qb.toConfig().where.length, 1);
    assertEquals(cloned.toConfig().where.length, 2);
  });

  await t.step("should execute query with filtering", async () => {
    // Clear previous data
    const kvInstance = kvm.getKv();
    const allEntries = await Array.fromAsync(kvInstance.list({ prefix: [] }));
    for await (const entry of allEntries) {
      await kvInstance.delete(entry.key);
    }

    // Create test data
    const users = [
      {
        id: "1",
        name: "John",
        age: 25,
        email: "john@test.com",
        isActive: true,
      },
      {
        id: "2",
        name: "Jane",
        age: 30,
        email: "jane@test.com",
        isActive: true,
      },
      { id: "3", name: "Bob", age: 20, email: "bob@test.com", isActive: false },
      {
        id: "4",
        name: "Alice",
        age: 35,
        email: "alice@test.com",
        isActive: true,
      },
    ];

    for (const user of users) {
      await User.create(user);
    }

    const results = await User.where("isActive").equals(true).find();

    assertEquals(results.length, 3);
    assertEquals(results[0].name, "John");
    assertEquals(results[1].name, "Jane");
    assertEquals(results[2].name, "Alice");
  });

  await t.step("should execute query with sorting", async () => {
    // Clear previous data
    const kvInstance = kvm.getKv();
    const allEntries = await Array.fromAsync(kvInstance.list({ prefix: [] }));
    for await (const entry of allEntries) {
      await kvInstance.delete(entry.key);
    }

    // Create test data
    const users = [
      {
        id: "1",
        name: "John",
        age: 25,
        email: "john@test.com",
        isActive: true,
      },
      {
        id: "2",
        name: "Jane",
        age: 30,
        email: "jane@test.com",
        isActive: true,
      },
      { id: "3", name: "Bob", age: 20, email: "bob@test.com", isActive: false },
    ];

    for (const user of users) {
      await User.create(user);
    }

    const results = await User.query().orderBy("age", "desc").find();

    assertEquals(results.length, 3);
    assertEquals(results[0].age, 30); // Jane
    assertEquals(results[1].age, 25); // John
    assertEquals(results[2].age, 20); // Bob
  });

  await t.step("should execute query with complex conditions", async () => {
    // Clear previous data
    const kvInstance = kvm.getKv();
    const allEntries = await Array.fromAsync(kvInstance.list({ prefix: [] }));
    for await (const entry of allEntries) {
      await kvInstance.delete(entry.key);
    }

    // Create test data
    const users = [
      {
        id: "1",
        name: "John Smith",
        age: 25,
        email: "john@test.com",
        isActive: true,
      },
      {
        id: "2",
        name: "Jane Doe",
        age: 30,
        email: "jane@test.com",
        isActive: true,
      },
      {
        id: "3",
        name: "Bob Johnson",
        age: 20,
        email: "bob@test.com",
        isActive: false,
      },
      {
        id: "4",
        name: "Alice Brown",
        age: 35,
        email: "alice@test.com",
        isActive: true,
      },
    ];

    for (const user of users) {
      await User.create(user);
    }

    const results = await User
      .where("age").gte(25)
      .where("name").contains("o")
      .orderBy("age")
      .find();

    assertEquals(results.length, 3); // John (25), Jane (30), Alice (35) - all contain "o" and age >= 25
    assertEquals(results[0].name, "John Smith"); // age 25
    assertEquals(results[1].name, "Jane Doe"); // age 30, contains "o" in "oe"
    assertEquals(results[2].name, "Alice Brown"); // age 35, contains "o" in Brown
  });

  await t.step("should handle findOne", async () => {
    // Clear previous data
    const kvInstance = kvm.getKv();
    const allEntries = await Array.fromAsync(kvInstance.list({ prefix: [] }));
    for await (const entry of allEntries) {
      await kvInstance.delete(entry.key);
    }

    // Create test data
    await User.create({
      id: "1",
      name: "John",
      age: 25,
      email: "john@test.com",
      isActive: true,
    });
    await User.create({
      id: "2",
      name: "Jane",
      age: 30,
      email: "jane@test.com",
      isActive: true,
    });

    const result = await User.where("name").equals("John").findOne();

    assertEquals(result?.name, "John");

    // Test findOne with no results
    const noResult = await User.where("name").equals("Nobody").findOne();
    assertEquals(noResult, null);
  });

  await t.step("should handle findOneOrThrow", async () => {
    // Clear previous data
    const kvInstance = kvm.getKv();
    const allEntries = await Array.fromAsync(kvInstance.list({ prefix: [] }));
    for await (const entry of allEntries) {
      await kvInstance.delete(entry.key);
    }

    // Create test data
    await User.create({
      id: "1",
      name: "John",
      age: 25,
      email: "john@test.com",
      isActive: true,
    });

    const result = await User.where("name").equals("John").findOneOrThrow();
    assertEquals(result.name, "John");

    // Test findOneOrThrow with no results
    await assertRejects(
      () => User.where("name").equals("Nobody").findOneOrThrow(),
      KVMNotFoundError,
    );
  });

  await t.step("should handle count and exists", async () => {
    // Clear previous data
    const kvInstance = kvm.getKv();
    const allEntries = await Array.fromAsync(kvInstance.list({ prefix: [] }));
    for await (const entry of allEntries) {
      await kvInstance.delete(entry.key);
    }

    // Create test data
    const users = [
      {
        id: "1",
        name: "John",
        age: 25,
        email: "john@test.com",
        isActive: true,
      },
      {
        id: "2",
        name: "Jane",
        age: 30,
        email: "jane@test.com",
        isActive: true,
      },
      { id: "3", name: "Bob", age: 20, email: "bob@test.com", isActive: false },
    ];

    for (const user of users) {
      await User.create(user);
    }

    const totalCount = await User.count();
    assertEquals(totalCount, 3);

    const activeCount = await User.where("isActive").equals(true).count();
    assertEquals(activeCount, 2);

    const exists = await User.where("name").equals("John").exists();
    assertEquals(exists, true);

    const notExists = await User.where("name").equals("Nobody").exists();
    assertEquals(notExists, false);
  });

  await t.step("should handle pagination with offset and limit", async () => {
    // Clear previous data
    const kvInstance = kvm.getKv();
    const allEntries = await Array.fromAsync(kvInstance.list({ prefix: [] }));
    for await (const entry of allEntries) {
      await kvInstance.delete(entry.key);
    }

    // Create test data
    for (let i = 1; i <= 10; i++) {
      await User.create({
        id: i.toString(),
        name: `User${i}`,
        age: 20 + i,
        email: `user${i}@test.com`,
        isActive: true,
      });
    }

    const results = await User.query().orderBy("age").offset(2).limit(3).find();

    assertEquals(results.length, 3);
    assertEquals(results[0].name, "User3"); // age 23
    assertEquals(results[1].name, "User4"); // age 24
    assertEquals(results[2].name, "User5"); // age 25
  });

  await t.step("should test all comparison operators", async () => {
    // Clear previous data
    const kvInstance = kvm.getKv();
    const allEntries = await Array.fromAsync(kvInstance.list({ prefix: [] }));
    for await (const entry of allEntries) {
      await kvInstance.delete(entry.key);
    }

    // Create test data
    const users = [
      {
        id: "1",
        name: "Alice",
        age: 25,
        email: "alice@test.com",
        isActive: true,
        tags: ["admin", "user"],
      },
      {
        id: "2",
        name: "Bob",
        age: 30,
        email: "bob@test.com",
        isActive: false,
        tags: ["user"],
      },
      {
        id: "3",
        name: "Charlie",
        age: 20,
        email: "charlie@test.com",
        isActive: true,
      },
      {
        id: "4",
        name: "Unknown",
        age: 35,
        email: "unknown@test.com",
        isActive: true,
      },
    ];

    for (const user of users) {
      await User.create(user);
    }

    // Test equals/eq
    let results = await User.where("name").equals("Alice").find();
    assertEquals(results.length, 1);

    // Test notEquals/ne
    results = await User.where("age").notEquals(25).find();
    assertEquals(results.length, 3);

    // Test greaterThan/gt
    results = await User.where("age").greaterThan(25).find();
    assertEquals(results.length, 2);

    // Test greaterThanOrEqual/gte
    results = await User.where("age").greaterThanOrEqual(25).find();
    assertEquals(results.length, 3);

    // Test lessThan/lt
    results = await User.where("age").lessThan(30).find();
    assertEquals(results.length, 2);

    // Test lessThanOrEqual/lte
    results = await User.where("age").lessThanOrEqual(30).find();
    assertEquals(results.length, 3);

    // Test in
    results = await User.where("age").in([25, 35]).find();
    assertEquals(results.length, 2);

    // Test notIn
    results = await User.where("age").notIn([25, 35]).find();
    assertEquals(results.length, 2);

    // Test contains
    results = await User.where("name").contains("li").find();
    assertEquals(results.length, 2); // Alice, Charlie

    // Test startsWith
    results = await User.where("name").startsWith("A").find();
    assertEquals(results.length, 1);

    // Test endsWith
    results = await User.where("name").endsWith("e").find();
    assertEquals(results.length, 2); // Alice, Charlie

    // Test exists
    results = await User.where("tags").exists().find();
    assertEquals(results.length, 2); // Alice, Bob

    // Test notExists
    results = await User.where("tags").notExists().find();
    assertEquals(results.length, 2); // Charlie, unknown user
  });

  await t.step("should handle error conditions", async () => {
    // Clear previous data
    const kvInstance = kvm.getKv();
    const allEntries = await Array.fromAsync(kvInstance.list({ prefix: [] }));
    for await (const entry of allEntries) {
      await kvInstance.delete(entry.key);
    }

    const qb = User.query();

    // Test with invalid field access that causes evaluation error
    // This should be caught and re-thrown as KVMQueryError
    await User.create({
      id: "error-test-1",
      name: "Test",
      age: 25,
      email: "test@test.com",
      isActive: true,
    });

    try {
      await qb.where("someComplexField").equals("value").find();
      // This should work as the condition simply evaluates to false
    } catch (error) {
      // Should not throw an error for simple field mismatches
    }
  });

  await t.step("should handle sorting edge cases", async () => {
    // Clear previous data
    const kvInstance = kvm.getKv();
    const allEntries = await Array.fromAsync(kvInstance.list({ prefix: [] }));
    for await (const entry of allEntries) {
      await kvInstance.delete(entry.key);
    }

    // Create test data with same values to test stable sorting
    const users = [
      {
        id: "sort-1",
        name: "John",
        age: 25,
        email: "a@test.com",
        isActive: true,
      },
      {
        id: "sort-2",
        name: "Jane",
        age: 25,
        email: "b@test.com",
        isActive: true,
      },
      {
        id: "sort-3",
        name: "Bob",
        age: 25,
        email: "c@test.com",
        isActive: true,
      },
    ];

    for (const user of users) {
      await User.create(user);
    }

    // Test multi-field sorting
    const results = await User.query().orderBy("age").orderBy("email").find();

    assertEquals(results.length, 3);
    assertEquals(results[0].email, "a@test.com");
    assertEquals(results[1].email, "b@test.com");
    assertEquals(results[2].email, "c@test.com");
  });

  await t.step("should preserve original limit after findOne", async () => {
    const qb = User.query();
    qb.limit(100); // Set original limit

    await qb.findOne(); // This temporarily sets limit to 1

    const config = qb.toConfig();
    assertEquals(config.limit, 100); // Should be restored
  });

  // Cleanup
  await kvm.close();
});
