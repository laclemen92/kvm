import { afterAll, beforeAll, describe, it } from "jsr:@std/testing/bdd";
import { expect } from "jsr:@std/expect";
import type { z } from "zod";
import {
  findFirst,
  findFirstOrThrow,
  findMany,
  findUnique,
  findUniqueOrThrow,
} from "./find.ts";
import { create } from "./create.ts";
import { postEntity, productEntity, voteEntity } from "./fixtures.ts";

type Post = z.infer<typeof postEntity.schema>;
type Product = z.infer<typeof productEntity.schema>;
type Vote = z.infer<typeof voteEntity.schema>;

describe("find", () => {
  let kv: Deno.Kv;

  beforeAll(async () => {
    kv = await Deno.openKv(":memory:");

    // let's create some test data
    await create<Post>(postEntity, kv, {
      id: "post1",
      slug: "/hello-world",
      title: "Hello World",
      content: "It sure is big and bright here",
      userId: "user1",
    });
    await create<Post>(postEntity, kv, {
      id: "post2",
      slug: "/hello-luke",
      title: "Hello Luke",
      content: "Welcome new user Luke!",
      userId: "user1",
    });
    await create<Product>(productEntity, kv, {
      id: "product1",
      sku: "0987412",
      brand: "apple",
      category: "electronics",
      subcategory: "smartphones",
      name: "iphone 14",
      price: 999.00,
    });
  });

  // afterEach(async () => {
  //   const allEntries = await Array.fromAsync(kv.list({ prefix: [] }));

  //   for await (const value of allEntries) {
  //     await kv.delete(value.key);
  //   }
  // });

  afterAll(async () => {
    await kv.close();
  });

  it("should findMany posts", async () => {
    const many = await findMany<Post>(postEntity, kv);

    expect(many.length).toBe(2);

    many.forEach((entry: Deno.KvEntry<Post>) => {
      if (entry.value.id === "post1") {
        expect(entry.value.slug).toBe("/hello-world");
      } else if (entry.value.id === "post2") {
        expect(entry.value.slug).toBe("/hello-luke");
      }
    });
  });

  it("should findUnique post by id", async () => {
    const post = await findUnique<Post>(postEntity, kv, "post1");

    expect(post?.value?.id).toBe("post1");
  });

  it("should findUnique post by secondaryIndex", async () => {
    const post = await findUnique<Post>(
      postEntity,
      kv,
      "/hello-luke",
      "posts_by_slug",
      true,
    );

    expect(post?.value?.id).toBe("post2");
  });

  it("should findUnique post by secondaryIndex", async () => {
    const post = await findUnique<Post>(
      postEntity,
      kv,
      "/hello-luke",
      "posts_by_slug",
    );

    expect(post?.value).toBe("post2");
  });

  it("should findUnique post by id", async () => {
    const post = await findUniqueOrThrow<Post>(postEntity, kv, "post1");

    expect(post?.value?.id).toBe("post1");
  });

  it("should findUnique post by secondaryIndex", async () => {
    const post = await findUniqueOrThrow<Post>(
      postEntity,
      kv,
      "/hello-luke",
      "posts_by_slug",
      true,
    );

    expect(post?.value?.id).toBe("post2");
  });

  it("should findUnique post by secondaryIndex", async () => {
    const post = await findUniqueOrThrow<Post>(
      postEntity,
      kv,
      "/hello-luke",
      "posts_by_slug",
    );

    expect(post?.value).toBe("post2");
  });

  it("should findFirst post", async () => {
    const post = await findFirst<Post>(
      postEntity,
      kv,
    );

    expect(post?.value?.id).toBe("post1");
  });

  it("should findFirstOrThrow post", async () => {
    const post = await findFirstOrThrow<Post>(
      postEntity,
      kv,
    );

    expect(post?.value?.id).toBe("post1");
  });

  it("should findMany products by complex secondaryIndex", async () => {
    const many = await findMany<Product>(productEntity, kv);
    expect(many.length).toBe(2);

    many.forEach((entry: Deno.KvEntry<Product>) => {
      if (entry?.value?.id) {
        expect(entry.value.id).toBe("product1");
      } else {
        expect(entry.value).toBe("product1");
      }
    });

    const manyBySecondary = await findMany<Product>(productEntity, kv, {
      prefix: ["products", "electronics", "smartphones", "apple"],
    });

    expect(manyBySecondary).toHaveLength(1);
    expect(manyBySecondary[0].value).toBe("product1");
  });

  it("should findUnique by object of values", async () => {
    const postId = "post1";
    const userLogin = "user2";
    await create<Vote>(voteEntity, kv, {
      postId: "post1",
      userLogin: "user2",
    });

    const vote = await findUnique<Vote>(voteEntity, kv, { postId, userLogin });

    expect(vote?.value?.postId).toBe(postId);
    expect(vote?.value?.userLogin).toBe(userLogin);
  });

  it("should return null when secondary index not found", async () => {
    const result = await findUnique<Post>(
      postEntity,
      kv,
      "test-value",
      "non_existent_index",
    );

    expect(result).toBeNull();
  });

  it("should handle number key type", async () => {
    // Test using a number as key which goes through else branch
    // Create a custom entity that uses numeric IDs
    const numericEntity = {
      ...postEntity,
      primaryKey: [{ name: "numeric_posts" }],
    };
    
    // Set a record with numeric key
    await kv.set(["numeric_posts", 123], { id: 123, title: "Numeric Post" });
    
    // Find using direct numeric key - tests else branch at line 77
    const result = await findUnique<{ id: number; title: string }>(numericEntity, kv, 123);
    
    expect(result?.value?.id).toBe(123);
  });

  it("should throw when findUniqueOrThrow doesn't find record", async () => {
    await expect(
      findUniqueOrThrow<Post>(postEntity, kv, "non-existent-post")
    ).rejects.toThrow("Not found");
  });

  it("should throw when findUniqueOrThrow doesn't find by secondary index", async () => {
    await expect(
      findUniqueOrThrow<Post>(
        postEntity,
        kv,
        "/non-existent-slug",
        "posts_by_slug",
      )
    ).rejects.toThrow("Not found");
  });

  it("should return null when findFirst finds no records", async () => {
    // Create a custom entity that won't have any records
    const emptyEntity = {
      ...postEntity,
      name: "empty_posts",
      primaryKey: [{ name: "empty_posts", key: "id" }],
    };

    const result = await findFirst(emptyEntity, kv);
    expect(result).toBeNull();
  });

  it("should throw when findFirstOrThrow finds no records", async () => {
    // Create a custom entity that won't have any records
    const emptyEntity = {
      ...postEntity,
      name: "empty_posts",
      primaryKey: [{ name: "empty_posts", key: "id" }],
    };

    await expect(
      findFirstOrThrow(emptyEntity, kv)
    ).rejects.toThrow("Not found");
  });

  it("should handle limit option in findMany", async () => {
    // Test limit option
    const limited = await findMany<Post>(postEntity, kv, { limit: 1 });
    expect(limited.length).toBe(1);

    // Test with different limit
    const allPosts = await findMany<Post>(postEntity, kv, { limit: 10 });
    expect(allPosts.length).toBe(2); // We only have 2 posts
  });

  it("should handle reverse option in findMany", async () => {
    const normalOrder = await findMany<Post>(postEntity, kv);
    const reverseOrder = await findMany<Post>(postEntity, kv, { reverse: true });

    expect(normalOrder[0].value.id).toBe("post1");
    expect(reverseOrder[0].value.id).toBe("post2");
  });
});
