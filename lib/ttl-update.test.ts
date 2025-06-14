import { assertEquals, assertRejects } from "jsr:@std/assert";
import { z } from "zod";
import { create } from "./create.ts";
import { update } from "./update.ts";
import type { findUnique } from "./find.ts";
import type { KVMEntity } from "./types.ts";

const testEntity: KVMEntity = {
  name: "ttl-update-test",
  primaryKey: [{ name: "ttl-update-test", key: "id" }],
  schema: z.object({
    id: z.string(),
    name: z.string(),
    data: z.string().optional(),
    counter: z.number().optional(),
  }),
};

Deno.test("TTL API - update with numeric TTL", async () => {
  const kv = await Deno.openKv(":memory:");

  const testData = {
    id: "update-ttl-numeric",
    name: "Original name",
    data: "original data",
    counter: 1,
  };

  // Create initial record
  await create(testEntity, kv, testData);

  // Update with TTL
  const updatedResult = await update(testEntity, kv, testData.id, {
    name: "Updated name",
    counter: 2,
  }, { expireIn: 10000 });

  assertEquals(updatedResult?.value?.name, "Updated name");
  assertEquals(updatedResult?.value?.counter, 2);
  assertEquals((updatedResult?.value as any)?.data, "original data"); // Should preserve

  kv.close();
});

Deno.test("TTL API - update with string TTL", async () => {
  const kv = await Deno.openKv(":memory:");

  const testData = {
    id: "update-ttl-string",
    name: "Original name",
    data: "original data",
  };

  // Create initial record
  await create(testEntity, kv, testData);

  // Update with string TTL
  const updatedResult = await update(testEntity, kv, testData.id, {
    name: "Updated with string TTL",
  }, { expireIn: "15m" });

  assertEquals(updatedResult?.value?.name, "Updated with string TTL");
  assertEquals((updatedResult?.value as any)?.data, "original data");

  kv.close();
});

Deno.test("TTL API - update with various TTL formats", async () => {
  const kv = await Deno.openKv(":memory:");

  const testCases = [
    { expireIn: "30s", suffix: "30s" },
    { expireIn: "10m", suffix: "10m" },
    { expireIn: "1h", suffix: "1h" },
    { expireIn: "1d", suffix: "1d" },
  ];

  for (const testCase of testCases) {
    const testData = {
      id: `update-ttl-${testCase.suffix}`,
      name: "Original name",
      data: "original data",
    };

    // Create initial record
    await create(testEntity, kv, testData);

    // Update with TTL
    const updatedResult = await update(testEntity, kv, testData.id, {
      name: `Updated with ${testCase.expireIn}`,
    }, { expireIn: testCase.expireIn });

    assertEquals(
      updatedResult?.value?.name,
      `Updated with ${testCase.expireIn}`,
    );
  }

  kv.close();
});

Deno.test("TTL API - update with invalid TTL", async () => {
  const kv = await Deno.openKv(":memory:");

  const testData = {
    id: "update-ttl-invalid",
    name: "Original name",
    data: "original data",
  };

  // Create initial record
  await create(testEntity, kv, testData);

  // Test invalid TTL format
  await assertRejects(
    () =>
      update(testEntity, kv, testData.id, { name: "Should fail" }, {
        expireIn: "invalid-format",
      }),
    Error,
    "Invalid TTL format",
  );

  // Test invalid TTL number
  await assertRejects(
    () =>
      update(testEntity, kv, testData.id, { name: "Should fail" }, {
        expireIn: -5000,
      }),
    Error,
    "Invalid TTL value",
  );

  kv.close();
});

Deno.test("TTL API - update non-existent record", async () => {
  const kv = await Deno.openKv(":memory:");

  // Try to update non-existent record
  await assertRejects(
    () =>
      update(testEntity, kv, "non-existent", { name: "Should fail" }, {
        expireIn: "5m",
      }),
    Error,
    "Record not found",
  );

  kv.close();
});
