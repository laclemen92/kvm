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
import { commentEntity, postEntity } from "./fixtures.ts";

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
});