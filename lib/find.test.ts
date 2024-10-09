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
import { postEntity, productEntity } from "./fixtures.ts";

type Post = z.infer<typeof postEntity.schema>;
type Product = z.infer<typeof productEntity.schema>;

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
});