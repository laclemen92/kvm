import { assertEquals, assertRejects } from "jsr:@std/assert";
import { z } from "zod";
import { create } from "./create.ts";
import { TTL } from "./ttl-utils.ts";
import type { KVMEntity } from "./types.ts";

const testEntity: KVMEntity = {
  name: "ttl-test",
  primaryKey: [{ name: "ttl-test", key: "id" }],
  schema: z.object({
    id: z.string(),
    name: z.string(),
    data: z.string().optional(),
  }),
};

Deno.test("TTL API - create with numeric TTL", async () => {
  const kv = await Deno.openKv(":memory:");

  const testData = {
    id: "ttl-numeric",
    name: "Test with numeric TTL",
    data: "some data",
  };

  // Create with 5 second TTL
  const result = await create(testEntity, kv, testData, { expireIn: 5000 });

  assertEquals(result?.value?.id, testData.id);
  assertEquals(result?.value?.name, testData.name);

  kv.close();
});

Deno.test("TTL API - create with string TTL", async () => {
  const kv = await Deno.openKv(":memory:");

  const testData = {
    id: "ttl-string",
    name: "Test with string TTL",
    data: "some data",
  };

  // Create with 5 minute TTL
  const result = await create(testEntity, kv, testData, { expireIn: "5m" });

  assertEquals(result?.value?.id, testData.id);
  assertEquals(result?.value?.name, testData.name);

  kv.close();
});

Deno.test("TTL API - create with various string formats", async () => {
  const kv = await Deno.openKv(":memory:");

  const testCases = [
    { expireIn: "30s", id: "ttl-seconds" },
    { expireIn: "5m", id: "ttl-minutes" },
    { expireIn: "2h", id: "ttl-hours" },
    { expireIn: "7d", id: "ttl-days" },
    { expireIn: "1w", id: "ttl-weeks" },
    { expireIn: "1y", id: "ttl-years" },
  ];

  for (const testCase of testCases) {
    const testData = {
      id: testCase.id,
      name: `Test with ${testCase.expireIn} TTL`,
      data: "some data",
    };

    const result = await create(testEntity, kv, testData, {
      expireIn: testCase.expireIn,
    });
    assertEquals(result?.value?.id, testData.id);
  }

  kv.close();
});

Deno.test("TTL API - create with invalid TTL string", async () => {
  const kv = await Deno.openKv(":memory:");

  const testData = {
    id: "ttl-invalid",
    name: "Test with invalid TTL",
    data: "some data",
  };

  // Test invalid format
  await assertRejects(
    () => create(testEntity, kv, testData, { expireIn: "invalid" }),
    Error,
    "Invalid TTL format",
  );

  // Test invalid number
  await assertRejects(
    () => create(testEntity, kv, testData, { expireIn: -1000 }),
    Error,
    "Invalid TTL value",
  );

  kv.close();
});

Deno.test("TTL API - TTL utility functions", () => {
  // Test parsing
  assertEquals(TTL.parse("5m"), 5 * 60 * 1000);
  assertEquals(TTL.parse("1h"), 60 * 60 * 1000);
  assertEquals(TTL.parse("2d"), 2 * 24 * 60 * 60 * 1000);

  // Test validation
  assertEquals(TTL.isValid(5000), true);
  assertEquals(TTL.isValid(-1000), false);
  assertEquals(TTL.isValid(0), false);
  assertEquals(TTL.isValid(NaN), false);

  // Test formatting
  assertEquals(TTL.format(5000), "5s");
  assertEquals(TTL.format(5 * 60 * 1000), "5m");
  assertEquals(TTL.format(2 * 60 * 60 * 1000), "2h");
});

Deno.test("TTL API - presets and helpers", () => {
  // Test presets
  assertEquals(TTL.PRESETS.VERY_SHORT, 5 * 60 * 1000);
  assertEquals(TTL.PRESETS.SHORT, 15 * 60 * 1000);
  assertEquals(TTL.PRESETS.MEDIUM, 60 * 60 * 1000);

  // Test fromNow helper
  assertEquals(TTL.fromNow(5, "minutes"), 5 * 60 * 1000);
  assertEquals(TTL.fromNow(2, "hours"), 2 * 60 * 60 * 1000);
  assertEquals(TTL.fromNow(1, "days"), 24 * 60 * 60 * 1000);
});
