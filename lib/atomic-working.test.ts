import { assertEquals } from "jsr:@std/assert";
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

Deno.test("Atomic utilities - basic counter functionality", async () => {
  const kv = await Deno.openKv(":memory:");

  // Test direct KV operations first
  const key = ["test", "counter"];

  // Direct increment
  await kv.atomic().sum(key, 1n).commit();
  let result = await kv.get<Deno.KvU64>(key);
  assertEquals(result.value?.value, 1n);

  // Direct increment by 5
  await kv.atomic().sum(key, 5n).commit();
  result = await kv.get<Deno.KvU64>(key);
  assertEquals(result.value?.value, 6n);

  // Note: Deno KV sum only accepts positive values, so decrement needs special handling

  kv.close();
});

Deno.test("Atomic utilities - AtomicCounter", async () => {
  const kv = await Deno.openKv(":memory:");

  const counter = AtomicUtils.counter(kv, ["test", "counter2"]);

  // Test initial value
  assertEquals(await counter.get(), 0n);

  // Test increment
  await counter.increment();
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

Deno.test("Atomic utilities - Model integration", async () => {
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

  // Test getting counters
  const counters = await post.getCounters();
  assertEquals(counters["views"], 1n);
  assertEquals(counters["likes"], 3n);

  kv.close();
});

Deno.test("Atomic utilities - Conditional increment", async () => {
  const kv = await Deno.openKv(":memory:");

  const counter = AtomicUtils.counter(kv, ["test", "conditional"]);

  // Set initial value
  await counter.set(10);

  // Test conditional increment with correct expected value
  const result1 = await counter.conditionalIncrement(10n, 5);
  assertEquals(result1.ok, true);
  assertEquals(await counter.get(), 15n);

  // Test conditional increment with wrong expected value
  const result2 = await counter.conditionalIncrement(10n, 5); // Should fail because current is 15
  assertEquals(result2.ok, false);
  assertEquals(await counter.get(), 15n); // Should remain unchanged

  kv.close();
});
