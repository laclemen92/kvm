import { afterEach, beforeEach, describe, it } from "jsr:@std/testing/bdd";
import { expect } from "jsr:@std/expect";
import { stub } from "@std/testing/mock";
import type { z } from "zod/mod.ts";
import { create } from "./create.ts";
import { update, updateMany } from "./update.ts";
import { postEntity, userByValueEntity } from "./fixtures.ts";

type Post = z.infer<typeof postEntity.schema>;
type User = z.infer<typeof userByValueEntity.schema>;

describe("update", () => {
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

  beforeEach(async () => {
    kv = await Deno.openKv(":memory:");
    // let's create some test data
    await create<Post>(postEntity, kv, post1);
    await create<Post>(postEntity, kv, post2);
    await create<User>(userByValueEntity, kv, user1);
    await create<User>(userByValueEntity, kv, user2);
  });

  afterEach(async () => {
    const allEntries = await Array.fromAsync(kv.list({ prefix: [] }));

    for await (const value of allEntries) {
      await kv.delete(value.key);
    }

    await kv.close();
  });

  describe("update", () => {
    it("should throw an error because the value isn't found", async () => {
      await expect(
        update<Post>(postEntity, kv, "post3", {
          slug: "/a-whole-new-post",
        }, {
          onlyChangedFields: true,
        }),
      ).rejects.toThrow("Record not found");
    });

    it("should throw error on bad atomic operation commit", async () => {
      stub(
        kv,
        "atomic",
        (): Deno.AtomicOperation => {
          const operation = new Deno.AtomicOperation();
          operation.commit = async (): Promise<
            Deno.KvCommitResult | Deno.KvCommitError
          > => {
            return await { ok: false };
          };

          return operation;
        },
      );

      await expect(
        update<Post>(postEntity, kv, "post1", {
          slug: "/a-whole-new-post",
        }, {
          onlyChangedFields: true,
        }),
      ).rejects.toThrow("Record could not be updated");
    });
  });

  it("should update a post with only changedFields", async () => {
    const updatedValue = await update<Post>(postEntity, kv, "post1", {
      slug: "/hello-world-1",
    }, {
      onlyChangedFields: true,
    });

    expect(updatedValue?.value?.id).toBe("post1");
    expect(updatedValue?.value?.slug).toBe("/hello-world-1");
    expect(updatedValue?.value?.title).toBe("Hello World");
  });

  it("should successfully update with secondaryIndex by value", async () => {
    const updatedUser = await update<User>(userByValueEntity, kv, "user1", {
      age: 99,
    }, {
      onlyChangedFields: true,
    });

    expect(updatedUser?.value?.id).toBe("user1");
    expect(updatedUser?.value?.age).toBe(99);
  });

  it("should successfully update with the whole value changed", async () => {
    const updatedUser = await update<User>(userByValueEntity, kv, "user2", {
      ...user2,
      age: 32,
    });

    expect(updatedUser?.value).toMatchObject({
      ...user2,
      age: 32,
    });
  });

  it("should updateMany", async () => {
    const updatedValues = await updateMany<Post>(postEntity, kv, [
      {
        id: "post1",
        value: {
          slug: "/hello-world-update-1",
        },
        options: {
          onlyChangedFields: true,
        },
      },
      {
        id: "post2",
        value: {
          slug: "/hello-again-luke",
        },
        options: {
          onlyChangedFields: true,
        },
      },
    ]);

    expect(updatedValues).toHaveLength(2);
    expect(updatedValues[0]?.value?.id).toBe("post1");
    expect(updatedValues[0]?.value?.slug).toBe("/hello-world-update-1");
    expect(updatedValues[0]?.value?.title).toBe("Hello World");

    expect(updatedValues[1]?.value?.id).toBe("post2");
    expect(updatedValues[1]?.value?.slug).toBe("/hello-again-luke");
    expect(updatedValues[1]?.value?.title).toBe("Hello Luke");
  });
});
