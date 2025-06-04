import { assertEquals, assertExists } from "jsr:@std/assert";
import { z } from "zod";
import { AtomicUtils } from "./atomic-utils.ts";
import { createModelClass } from "./model.ts";
import type { KVMEntity } from "./types.ts";

// Test entity
const postEntity: KVMEntity = {
  name: "post",
  primaryKey: [{ name: "post", key: "id" }],
  schema: z.object({
    id: z.string(),
    title: z.string(),
    content: z.string(),
    authorId: z.string(),
  }),
};

Deno.test("AtomicCounter - basic operations", async () => {
  const kv = await Deno.openKv(":memory:");

  const counter = AtomicUtils.counter(kv, ["test", "counter"]);

  // Test initial value
  assertEquals(await counter.get(), 0n);

  // Test increment
  const result1 = await counter.increment();
  assertEquals(result1.ok, true);
  assertEquals(await counter.get(), 1n);

  // Test increment by amount
  await counter.increment(5);
  assertEquals(await counter.get(), 6n);

  // Test decrement
  await counter.decrement(2);
  assertEquals(await counter.get(), 4n);

  // Test set
  await counter.set(10);
  assertEquals(await counter.get(), 10n);

  // Test reset
  await counter.reset();
  assertEquals(await counter.get(), 0n);

  kv.close();
});

Deno.test("AtomicCounter - conditional increment", async () => {
  const kv = await Deno.openKv(":memory:");

  const counter = AtomicUtils.counter(kv, ["test", "conditional"]);

  // Set initial value
  await counter.set(5);

  // Test conditional increment with correct expected value
  const result1 = await counter.conditionalIncrement(5n, 2);
  assertEquals(result1.ok, true);
  assertEquals(await counter.get(), 7n);

  // Test conditional increment with incorrect expected value
  const result2 = await counter.conditionalIncrement(5n, 2);
  assertEquals(result2.ok, false); // Should fail due to version mismatch
  assertEquals(await counter.get(), 7n); // Value should remain unchanged

  kv.close();
});

Deno.test("Model atomic utilities - field counters", async () => {
  const kv = await Deno.openKv(":memory:");
  const Post = createModelClass("Post", postEntity, kv);

  // Create a test post
  const post = await Post.create({
    id: "post1",
    title: "Test Post",
    content: "Test content",
    authorId: "author1",
  });

  // Test incrementing field counters
  await post.incrementField("views");
  await post.incrementField("likes", 3);
  await post.incrementFields({
    "comments": 2,
    "shares": 1,
  });

  // Test getting counters
  const counters = await post.getCounters();
  assertEquals(counters["views"], 1n);
  assertEquals(counters["likes"], 3n);
  assertEquals(counters["comments"], 2n);
  assertEquals(counters["shares"], 1n);

  // Test static methods
  await Post.incrementField("post1", "views", 2);
  await Post.incrementFields("post1", {
    "likes": 1,
    "comments": 3,
  });

  const updatedCounters = await Post.getCounters("post1");
  assertEquals(updatedCounters["views"], 3n);
  assertEquals(updatedCounters["likes"], 4n);
  assertEquals(updatedCounters["comments"], 5n);
  assertEquals(updatedCounters["shares"], 1n);

  // Test creating field counter
  const viewsCounter = post.createFieldCounter("views");
  await viewsCounter.increment(10);
  assertEquals(await viewsCounter.get(), 13n);

  kv.close();
});

Deno.test("Model atomic utilities - other utilities", async () => {
  const kv = await Deno.openKv(":memory:");
  const Post = createModelClass("Post", postEntity, kv);

  // Test creating various atomic utilities
  const counter = Post.createCounter(["custom", "counter"]);
  // Test basic operations
  await counter.increment(5);
  assertEquals(await counter.get(), 5n);

  kv.close();
});
