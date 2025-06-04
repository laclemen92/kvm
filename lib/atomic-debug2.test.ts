import { assertEquals } from "jsr:@std/assert";
import { AtomicUtils } from "./atomic-utils.ts";

Deno.test("Debug decrement operation", async () => {
  const kv = await Deno.openKv(":memory:");

  const counter = AtomicUtils.counter(kv, ["debug", "counter"]);

  // Test increment to 6
  await counter.increment();
  await counter.increment(5);
  const value1 = await counter.get();
  console.log("After increments:", value1);
  assertEquals(value1, 6n);

  // Test decrement by 2
  console.log("About to decrement by 2...");
  const decrementResult = await counter.decrement(2);
  console.log("Decrement result:", decrementResult);

  const value2 = await counter.get();
  console.log("After decrement:", value2);

  kv.close();
});
