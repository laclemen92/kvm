import { afterEach, beforeEach, describe, it } from "jsr:@std/testing/bdd";
import { expect } from "jsr:@std/expect";
import type { z } from "zod";
import { create } from "./create.ts";
import { deleteKey, deleteMany } from "./delete.ts";
import {
  complexPostEntity,
  postEntity,
  userByValueEntity,
} from "./fixtures.ts";

type Post = z.infer<typeof postEntity.schema>;
type User = z.infer<typeof userByValueEntity.schema>;
type ComplexPost = z.infer<typeof complexPostEntity.schema>;

describe("delete", () => {
  let kv: Deno.Kv;

  const post1: Post = {
    id: "post1",
    slug: "/hello-world",
    title: "Hello World",
    content: "It sure is big and bright here",
    userId: "user1",
  };
  const post2: Post = {
    id: "post2",
    slug: "/hello-luke",
    title: "Hello Luke",
    content: "Welcome new user Luke!",
    userId: "user1",
  };

  const user1: User = {
    id: "user1",
    sessionId: "075438",
    email: "user1@gmail.com",
    age: 525600,
  };
  const user2: User = {
    id: "user2",
    sessionId: "75157",
    email: "user2@gmail.com",
    age: 31,
  };

  const complexPost1: ComplexPost = {
    id: "cp1",
    slug: "best-post",
    title: "best post ever",
    content: "read me..",
    userLogin: "laclemen92",
    url: "/best-post",
  };

  beforeEach(async () => {
    kv = await Deno.openKv(":memory:");
    // let's create some test data
    await create<Post>(postEntity, kv, post1);
    await create<Post>(postEntity, kv, post2);
    await create<User>(userByValueEntity, kv, user1);
    await create<User>(userByValueEntity, kv, user2);
    await create<ComplexPost>(complexPostEntity, kv, complexPost1);
  });

  afterEach(async () => {
    const allEntries = await Array.fromAsync(kv.list({ prefix: [] }));

    for await (const value of allEntries) {
      await kv.delete(value.key);
    }

    await kv.close();
  });

  it("should delete a post", async () => {
    const deletedPost = await deleteKey<Post>(postEntity, kv, "post1");

    expect(deletedPost?.value).toMatchObject(post1);
  });

  it("should try to delete a post that doesn't exist", async () => {
    await expect(
      deleteKey<Post>(postEntity, kv, "post3"),
    ).rejects.toThrow("Record not found");
  });

  it("should delete many posts", async () => {
    const deleted = await deleteMany(postEntity, kv, [
      {
        key: post1.id,
      },
      {
        key: post2.id,
        options: {
          cascadeDelete: true,
        },
      },
    ]);

    expect(deleted).toHaveLength(2);
    expect(deleted[0]?.value).toMatchObject(post1);
    expect(deleted[1]?.value).toMatchObject(post2);
  });

  it("should delete all keys for a complex secondary index", async () => {
    const deleted = await deleteKey<ComplexPost>(
      complexPostEntity,
      kv,
      complexPost1.id,
      { cascadeDelete: true },
    );

    expect(deleted?.value).toMatchObject(complexPost1);

    const userSecondary = await kv.get(["user", "cp1", "posts", "cp1"]);
    expect(userSecondary.value).toBe(null);

    const primary = await kv.get(["complex_posts", "cp1"]);
    expect(primary.value).toBe(null);

    const slugSecondary = await kv.get(["complex_posts_by_slug", "cp1"]);
    expect(slugSecondary.value).toBe(null);
  });
  // test for deleting many with one not existing
});
