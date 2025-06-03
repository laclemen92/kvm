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

    const userSecondary = await Array.fromAsync(
      await kv.list({
        prefix: ["user", "laclemen92", "posts"],
      }),
    );
    expect(userSecondary).toMatchObject([]);

    const primary = await Array.fromAsync(
      await kv.list({ prefix: ["complex_posts"] }),
    );
    expect(primary).toMatchObject([]);

    const slugSecondary = await Array.fromAsync(
      await kv.list({ prefix: ["complex_posts_by_slug"] }),
    );
    expect(slugSecondary).toMatchObject([]);
  });

  it("should delete with object key using StringKeyedValueObject", async () => {
    // Test deletion using an object with key-value pairs
    const objectKey = { id: "post1" };
    
    const deleted = await deleteKey<Post>(postEntity, kv, objectKey);
    
    expect(deleted?.value).toMatchObject(post1);
    
    // Verify it was deleted
    const afterDelete = await kv.get(["posts", "post1"]);
    expect(afterDelete.value).toBeNull();
  });

  it("should delete without cascadeDelete option", async () => {
    // Delete without cascade - should only delete primary key
    const deleted = await deleteKey<ComplexPost>(
      complexPostEntity,
      kv,
      complexPost1.id,
      // No cascadeDelete option
    );

    expect(deleted?.value).toMatchObject(complexPost1);

    // Verify secondary indexes still exist (not cascaded)
    const userSecondary = await kv.get(["user", "laclemen92", "posts", "cp1"]);
    expect(userSecondary.value).toBe("cp1");
  });

  it("should handle deleteMany with one record not existing", async () => {
    await expect(
      deleteMany(postEntity, kv, [
        { key: post1.id },
        { key: "nonexistent-post" }, // This doesn't exist - will throw
        { key: post2.id },
      ])
    ).rejects.toThrow("Record not found");

    // Verify first post was deleted before error
    const post1Check = await kv.get(["posts", "post1"]);
    expect(post1Check.value).toBeNull();

    // Verify second post was NOT deleted due to error
    const post2Check = await kv.get(["posts", "post2"]);
    expect(post2Check.value).not.toBeNull();
  });

  it("should handle entity with relations and cascade delete", async () => {
    // The postEntity has relations to users, not comments
    // When we delete a post with cascade, it should clean up the user relation
    const deleted = await deleteKey<Post>(postEntity, kv, "post1", {
      cascadeDelete: true,
    });

    expect(deleted?.value).toMatchObject(post1);

    // Verify the user relation was deleted
    const userRelation = await kv.get(["users", "user1", "posts", "post1"]);
    expect(userRelation.value).toBeNull();
  });

  it("should handle async operations in forEach for cascade delete", async () => {
    // This test ensures the async forEach operations are covered
    // Create a user with secondary indexes using VALUE type
    const userToDelete = await kv.get(["users", "user1"]);
    expect(userToDelete.value).not.toBeNull();

    // Delete with cascade to trigger async forEach operations
    const deleted = await deleteKey<User>(userByValueEntity, kv, "user1", {
      cascadeDelete: true,
    });

    expect(deleted?.value).toMatchObject(user1);

    // Verify secondary indexes were deleted (now properly awaited)
    const emailIndex = await kv.get(["users_by_email", user1.email]);
    expect(emailIndex.value).toBeNull();

    const sessionIndex = await kv.get(["users_by_session", user1.sessionId]);
    expect(sessionIndex.value).toBeNull();
  });

  it("should test else branch when not using cascadeDelete with string key", async () => {
    // This tests line 77-79 in delete.ts
    const deleted = await deleteKey<Post>(postEntity, kv, "post1");
    
    expect(deleted?.value).toMatchObject(post1);
    
    // Verify primary key was deleted
    const afterDelete = await kv.get(["posts", "post1"]);
    expect(afterDelete.value).toBeNull();
    
    // Verify secondary index still exists (not cascaded)
    const slugIndex = await kv.get(["posts_by_slug", post1.slug]);
    expect(slugIndex.value).toBe("post1");
  });

  it("should handle failed atomic commit in cascade delete", async () => {
    // Mock kv with failing atomic commit
    const mockKv = {
      ...kv,
      get: kv.get.bind(kv),
      list: kv.list.bind(kv),
      atomic: () => {
        const atomicOp = {
          delete: () => atomicOp,
          commit: async () => ({ ok: false }),
        };
        return atomicOp;
      },
    } as unknown as Deno.Kv;

    await expect(
      deleteKey<User>(userByValueEntity, mockKv, "user1", { cascadeDelete: true })
    ).rejects.toThrow("Failed to delete users");
  });
});
