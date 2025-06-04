import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  it,
} from "jsr:@std/testing/bdd";
import { expect } from "jsr:@std/expect";
import type { z } from "zod";
import { create } from "./create.ts";
import { commentEntity, postEntity, productEntity } from "./fixtures.ts";
import type { KVMEntity } from "./types.ts";
import { RelationType, ValueType } from "./types.ts";

describe("create", () => {
  let kv: Deno.Kv;

  beforeAll(async () => {
    kv = await Deno.openKv(":memory:");
  });

  afterEach(async () => {
    const allEntries = await Array.fromAsync(kv.list({ prefix: [] }));

    for await (const value of allEntries) {
      await kv.delete(value.key);
    }
  });

  afterAll(async () => {
    await kv.close();
  });

  it("should create a post in kv and attach comments", async () => {
    const kv = await Deno.openKv(":memory:");
    type Post = z.infer<typeof postEntity.schema>;

    const result = await create<Post>(postEntity, kv, {
      id: "post1",
      slug: "/hello-world",
      title: "Hello World",
      content: "It sure is big and bright here",
      userId: "user1",
    });

    expect(result?.value?.id).toBe("post1");

    type Comment = z.infer<typeof commentEntity.schema>;
    const comment = await create<Comment>(commentEntity, kv, {
      id: "comment1",
      userId: "user1",
      text: "you suck",
      postId: "post1",
    });

    expect(comment?.value?.id).toBe("comment1");

    const manyComments = await Array.fromAsync(
      kv.list<Comment>({ prefix: ["comments"] }),
    );
    expect(manyComments.length).toBe(1);

    manyComments.forEach((entry: Deno.KvEntry<Comment>) => {
      expect(entry.value.postId).toBe("post1");
    });

    await kv.close();
  });

  it("should handle failed atomic commit", async () => {
    // Mock kv with failing atomic commit
    const mockKv = {
      ...kv,
      atomic: () => {
        const atomicOp = {
          set: () => atomicOp,
          check: () => atomicOp,
          commit: async () => ({ ok: false }),
        };
        return atomicOp;
      },
    } as unknown as Deno.Kv;

    type Post = z.infer<typeof postEntity.schema>;

    await expect(create<Post>(postEntity, mockKv, {
      id: "post1",
      slug: "/hello-world",
      title: "Hello World",
      content: "Test content",
      userId: "user1",
    })).rejects.toThrow("Failed to create posts: key already exists");
  });

  it("should create entity with secondary index using ValueType.KEY", async () => {
    const { userEntity } = await import("./fixtures.ts");
    type User = z.infer<typeof userEntity.schema>;

    const result = await create<User>(userEntity, kv, {
      id: "user1",
      email: "test@example.com",
      age: 25,
      sessionId: "session123",
    });

    expect(result?.value?.id).toBe("user1");

    // Verify secondary index was created with KEY type
    const emailIndex = await kv.get(["users_by_email", "test@example.com"]);
    expect(emailIndex.value).toBe("user1"); // Should store just the ID

    const sessionIndex = await kv.get(["users_by_session", "session123"]);
    expect(sessionIndex.value).toBe("user1"); // Should store just the ID
  });

  it("should create entity with secondary index using ValueType.VALUE", async () => {
    const { userByValueEntity } = await import("./fixtures.ts");
    type User = z.infer<typeof userByValueEntity.schema>;

    const user = {
      id: "user1",
      email: "test@example.com",
      age: 25,
      sessionId: "session123",
    };

    const result = await create<User>(userByValueEntity, kv, user);

    expect(result?.value?.id).toBe("user1");

    // Verify secondary index was created with VALUE type
    const emailIndex = await kv.get(["users_by_email", "test@example.com"]);
    expect(emailIndex.value).toEqual(user); // Should store full object

    const sessionIndex = await kv.get(["users_by_session", "session123"]);
    expect(sessionIndex.value).toEqual(user); // Should store full object
  });

  it("should handle missing findKey error", async () => {
    // Create entity with invalid relation field
    const { manyProductEntity } = await import("./fixtures.ts");
    type Product = z.infer<typeof manyProductEntity.schema>;

    const result = await create<Product>(manyProductEntity, kv, {
      id: "product1",
      sku: "SKU123",
      brand: "TestBrand",
      categoryId: "nonexistent-category", // This category doesn't exist
      subcategory: "Electronics",
      price: 99.99,
      name: "Test Product",
    });

    // Should still create the product but log error
    expect(result?.value?.id).toBe("product1");
  });

  it("should create entity with relation using ValueType.KEY", async () => {
    // Create a custom entity with proper relation setup
    const customProductEntity: KVMEntity = {
      name: "products",
      primaryKey: [{ name: "products", key: "id" }],
      relations: [{
        entityName: "categories",
        fields: ["categoryId"],
        type: RelationType.ONE_TO_MANY,
        valueType: ValueType.KEY,
        valueKey: "id",
      }],
      schema: productEntity.schema,
    };

    // First create a category to relate to
    await kv.set(["categories", "cat1"], { id: "cat1", name: "Electronics" });

    const result = await create(customProductEntity, kv, {
      id: "product1",
      sku: "SKU123",
      brand: "TestBrand",
      category: "Electronics",
      subcategory: "Phones",
      price: 999.99,
      name: "Test Phone",
      categoryId: "cat1",
    });

    expect(result?.value?.id).toBe("product1");

    // Verify relation was created with KEY type
    const relationKey = await kv.get([
      "categories",
      "cat1",
      "products",
      "product1",
    ]);
    expect(relationKey.value).toBe("product1"); // Should store just the ID
  });

  it("should throw error for invalid primary key structure", async () => {
    // Spy on console.error
    const originalError = console.error;
    const errors: unknown[] = [];
    console.error = (...args: unknown[]) => {
      errors.push(...args);
    };

    // Create entity with invalid data to trigger findKey error
    const invalidEntity: KVMEntity = {
      name: "test",
      primaryKey: [{ name: "test" }], // No key field
      schema: postEntity.schema,
    };

    type Post = z.infer<typeof postEntity.schema>;

    // Expect the create function to throw an error
    await expect(create<Post>(invalidEntity, kv, {
      id: "post1",
      slug: "/test",
      title: "Test",
      content: "Test",
      userId: "user1",
    })).rejects.toThrow(
      "couldn't find key",
    );

    // Restore console.error
    console.error = originalError;
  });
});
