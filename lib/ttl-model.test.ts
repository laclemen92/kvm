import { assertEquals } from "jsr:@std/assert";
import { z } from "zod";
import { createModelClass } from "./model.ts";
import { TTL, TTLConfig } from "./ttl-utils.ts";
import type { KVMEntity } from "./types.ts";

const userEntity: KVMEntity = {
  name: "user",
  primaryKey: [{ name: "user", key: "id" }],
  schema: z.object({
    id: z.string(),
    name: z.string(),
    email: z.string(),
    sessionToken: z.string().optional(),
    isActive: z.boolean().default(true),
  }),
};

Deno.test("TTL Model API - create with TTL options", async () => {
  const kv = await Deno.openKv(":memory:");
  const User = createModelClass("User", userEntity, kv);

  // Test with numeric TTL
  const user1 = await User.create({
    id: "user1",
    name: "John Doe",
    email: "john@example.com",
    sessionToken: "token123",
  }, { expireIn: 3600000 }); // 1 hour in ms

  assertEquals(user1.id, "user1");
  assertEquals(user1.name, "John Doe");

  // Test with string TTL
  const user2 = await User.create({
    id: "user2",
    name: "Jane Doe",
    email: "jane@example.com",
    sessionToken: "token456",
  }, { expireIn: "30m" }); // 30 minutes

  assertEquals(user2.id, "user2");
  assertEquals(user2.name, "Jane Doe");

  kv.close();
});

Deno.test("TTL Model API - save with TTL options", async () => {
  const kv = await Deno.openKv(":memory:");
  const User = createModelClass("User", userEntity, kv);

  // Create user without TTL
  const user = await User.create({
    id: "user3",
    name: "Bob Smith",
    email: "bob@example.com",
  });

  // Update and save with TTL
  user.sessionToken = "new-token";
  await user.save({ expireIn: "1h" });

  assertEquals(user.sessionToken, "new-token");

  kv.close();
});

Deno.test("TTL Model API - update with TTL options", async () => {
  const kv = await Deno.openKv(":memory:");
  const User = createModelClass("User", userEntity, kv);

  // Create user
  const user = await User.create({
    id: "user4",
    name: "Alice Brown",
    email: "alice@example.com",
  });

  // Update with TTL
  await user.update({
    sessionToken: "updated-token",
  }, { expireIn: "2h" });

  assertEquals(user.sessionToken, "updated-token");

  kv.close();
});

Deno.test("TTL Model API - using TTL presets", async () => {
  const kv = await Deno.openKv(":memory:");
  const User = createModelClass("User", userEntity, kv);

  // Test various TTL preset scenarios
  const testCases = [
    { expireIn: TTL.PRESETS.SHORT, name: "Short session" },
    { expireIn: TTL.PRESETS.MEDIUM, name: "Medium session" },
    { expireIn: TTL.PRESETS.LONG, name: "Long session" },
    { expireIn: TTLConfig.SESSION.STANDARD, name: "Standard session" },
    {
      expireIn: TTLConfig.TOKEN.EMAIL_VERIFICATION,
      name: "Email verification",
    },
  ];

  for (let i = 0; i < testCases.length; i++) {
    const testCase = testCases[i];
    const user = await User.create({
      id: `preset-user-${i}`,
      name: testCase.name,
      email: `preset${i}@example.com`,
      sessionToken: `token-${i}`,
    }, { expireIn: testCase.expireIn });

    assertEquals(user.name, testCase.name);
  }

  kv.close();
});

Deno.test("TTL Model API - TTL utility integration", () => {
  // Test that we can use TTL utilities seamlessly
  const sessionTTL = TTL.fromNow(30, "minutes");
  const tokenTTL = TTL.parse("24h");
  const cacheTTL = TTLConfig.CACHE.STANDARD;

  assertEquals(sessionTTL, 30 * 60 * 1000);
  assertEquals(tokenTTL, 24 * 60 * 60 * 1000);
  assertEquals(typeof cacheTTL, "number");
  assertEquals(cacheTTL > 0, true);
});
