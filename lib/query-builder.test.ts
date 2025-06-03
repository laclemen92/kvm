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
import { ValueType } from "./types.ts";
import type { KVM } from "./kvm.ts";

describe("Query Builder Integration", () => {
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

  it("should support basic where queries", async () => {
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

    // Create test data
    await User.create(
      { id: "user1", name: "John", age: 25, status: "active" },
    );
    await User.create(
      { id: "user2", name: "Jane", age: 30, status: "active" },
    );
    await User.create(
      { id: "user3", name: "Bob", age: 35, status: "inactive" },
    );

    // Test equals query
    const activeUsers = await User
      .where("status")
      .equals("active")
      .find();

    expect(activeUsers).toHaveLength(2);
    expect(activeUsers[0].status).toBe("active");
    expect(activeUsers[1].status).toBe("active");

    // Test greater than query
    const olderUsers = await User
      .where("age")
      .gt(28)
      .find();

    expect(olderUsers).toHaveLength(2);
    expect(olderUsers.every((user) => user.age > 28)).toBe(true);

    // Test chained conditions
    const activeOlderUsers = await User
      .where("status").equals("active")
      .where("age").gte(30)
      .find();

    expect(activeOlderUsers).toHaveLength(1);
    expect(activeOlderUsers[0].name).toBe("Jane");
  });

  it("should support object-style where conditions", async () => {
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

    await User.create(
      { id: "user1", name: "John", age: 25, status: "active" },
    );
    await User.create(
      { id: "user2", name: "Jane", age: 30, status: "active" },
    );

    // Test object-style where
    const users = await User
      .where({ status: "active", age: 25 })
      .find();

    expect(users).toHaveLength(1);
    expect(users[0].name).toBe("John");
  });

  it("should support sorting and pagination", async () => {
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

    await User.create({ id: "user1", name: "Alice", age: 25 });
    await User.create({ id: "user2", name: "Bob", age: 30 });
    await User.create({ id: "user3", name: "Charlie", age: 35 });

    // Test ordering
    const sortedUsers = await User
      .query()
      .orderBy("age", "desc")
      .find();

    expect(sortedUsers[0].age).toBe(35);
    expect(sortedUsers[1].age).toBe(30);
    expect(sortedUsers[2].age).toBe(25);

    // Test limit
    const limitedUsers = await User
      .query()
      .orderBy("age", "asc")
      .limit(2)
      .find();

    expect(limitedUsers).toHaveLength(2);
    expect(limitedUsers[0].age).toBe(25);
    expect(limitedUsers[1].age).toBe(30);

    // Test offset
    const offsetUsers = await User
      .query()
      .orderBy("age", "asc")
      .offset(1)
      .limit(1)
      .find();

    expect(offsetUsers).toHaveLength(1);
    expect(offsetUsers[0].age).toBe(30);
  });

  it("should support string operations", async () => {
    const userSchema = z.object({
      id: z.string(),
      name: z.string(),
      email: z.string(),
    });

    type UserType = z.infer<typeof userSchema>;

    const User = kvm.model("users", {
      schema: userSchema,
      primaryKey: [{ name: "users", key: "id" }],
    });

    await User.create(
      {
        id: "user1",
        name: "John Smith",
        email: "john@example.com",
      },
    );
    await User.create(
      { id: "user2", name: "Jane Doe", email: "jane@test.com" },
    );
    await User.create(
      {
        id: "user3",
        name: "Bob Johnson",
        email: "bob@example.com",
      },
    );

    // Test contains
    const containsUsers = await User
      .where("name")
      .contains("John")
      .find();

    expect(containsUsers).toHaveLength(2);

    // Test startsWith
    const startsWithUsers = await User
      .where("name")
      .startsWith("J")
      .find();

    expect(startsWithUsers).toHaveLength(2);

    // Test endsWith
    const exampleUsers = await User
      .where("email")
      .endsWith("@example.com")
      .find();

    expect(exampleUsers).toHaveLength(2);
  });

  it("should support array operations", async () => {
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

    await User.create(
      { id: "user1", name: "John", age: 25, status: "active" },
    );
    await User.create(
      { id: "user2", name: "Jane", age: 30, status: "pending" },
    );
    await User.create(
      { id: "user3", name: "Bob", age: 35, status: "inactive" },
    );

    // Test in operation
    const inUsers = await User
      .where("status")
      .in(["active", "pending"])
      .find();

    expect(inUsers).toHaveLength(2);

    // Test notIn operation
    const notInUsers = await User
      .where("status")
      .notIn(["inactive"])
      .find();

    expect(notInUsers).toHaveLength(2);

    // Test between operation
    const betweenUsers = await User
      .where("age")
      .between(25, 30)
      .find();

    expect(betweenUsers).toHaveLength(2);
  });

  it("should support findOne and count operations", async () => {
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

    await User.create({ id: "user1", name: "John", age: 25 });
    await User.create({ id: "user2", name: "Jane", age: 30 });

    // Test findOne
    const user = await User
      .where("age")
      .gt(25)
      .findOne();

    expect(user).not.toBeNull();
    expect(user!.age).toBeGreaterThan(25);

    // Test count
    const count = await User
      .query()
      .count();

    expect(count).toBe(2);

    // Test exists
    const exists = await User
      .where("name")
      .equals("John")
      .exists();

    expect(exists).toBe(true);

    const notExists = await User
      .where("name")
      .equals("NonExistent")
      .exists();

    expect(notExists).toBe(false);
  });

  it("should support query cloning", async () => {
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

    await User.create({ id: "user1", name: "John", age: 25 });
    await User.create({ id: "user2", name: "Jane", age: 30 });

    const baseQuery = User
      .where("age")
      .gt(20);

    // Clone and add different conditions
    const query1 = baseQuery.clone().where("name").equals("John");
    const query2 = baseQuery.clone().where("name").equals("Jane");

    const johnResults = await query1.find();
    const janeResults = await query2.find();

    expect(johnResults).toHaveLength(1);
    expect(johnResults[0].name).toBe("John");

    expect(janeResults).toHaveLength(1);
    expect(janeResults[0].name).toBe("Jane");
  });

  it("should handle empty results gracefully", async () => {
    const userSchema = z.object({
      id: z.string(),
      name: z.string(),
    });

    type UserType = z.infer<typeof userSchema>;

    const User = kvm.model("users", {
      schema: userSchema,
      primaryKey: [{ name: "users", key: "id" }],
    });

    // Test with no data
    const noResults = await User
      .where("name")
      .equals("NonExistent")
      .find();

    expect(noResults).toHaveLength(0);

    const noOne = await User
      .where("name")
      .equals("NonExistent")
      .findOne();

    expect(noOne).toBeNull();

    const zeroCount = await User
      .query()
      .count();

    expect(zeroCount).toBe(0);
  });
});
