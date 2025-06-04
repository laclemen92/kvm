import { assertEquals } from "jsr:@std/assert";

Deno.test("Direct Deno KV atomic operations", async () => {
  const kv = await Deno.openKv(":memory:");

  const key = ["test", "counter"];

  // Test direct atomic sum
  const result1 = await kv.atomic()
    .sum(key, 5n)
    .commit();

  console.log("Sum result:", result1);
  assertEquals(result1.ok, true);

  // Check value
  const check1 = await kv.get<Deno.KvU64>(key);
  console.log("Value after sum:", check1.value);
  assertEquals(check1.value?.value, 5n);

  kv.close();
});
