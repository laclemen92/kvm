import { assertEquals } from "jsr:@std/assert";
import { createAtomicBuilder } from "./atomic-builder.ts";

Deno.test("Simple atomic operations", async () => {
  const kv = await Deno.openKv(":memory:");

  const key = ["test", "counter"];

  // Test sum operation
  const result1 = await createAtomicBuilder(kv)
    .sum(key, 5n)
    .commit();

  assertEquals(result1.ok, true);

  // Check value
  const check1 = await kv.get<Deno.KvU64>(key);
  assertEquals(check1.value?.value, 5n);

  // Test negative sum (decrement) - this should fail as Deno KV doesn't support negative sums
  const result2 = await createAtomicBuilder(kv)
    .sum(key, -2n)
    .commit();

  assertEquals(result2.ok, false); // Negative sums are not supported

  // Check value (should still be 5n since the negative sum failed)
  const check2 = await kv.get<Deno.KvU64>(key);
  assertEquals(check2.value?.value, 5n);

  // Test max operation
  const result3 = await createAtomicBuilder(kv)
    .max(key, 10n)
    .commit();

  assertEquals(result3.ok, true);

  // Check value
  const check3 = await kv.get<Deno.KvU64>(key);
  assertEquals(check3.value?.value, 10n);

  // Test max with lower value (should not change)
  const result4 = await createAtomicBuilder(kv)
    .max(key, 5n)
    .commit();

  assertEquals(result4.ok, true);

  // Check value (should still be 10)
  const check4 = await kv.get<Deno.KvU64>(key);
  assertEquals(check4.value?.value, 10n);

  kv.close();
});
