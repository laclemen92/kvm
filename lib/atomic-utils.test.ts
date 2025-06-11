import {
  assertEquals,
  assertInstanceOf,
} from "https://deno.land/std@0.220.0/assert/mod.ts";
import {
  AtomicCounter,
  AtomicUtils,
  ModelAtomicUtils,
} from "./atomic-utils.ts";
import type { KVMEntity } from "./types.ts";
import { z } from "zod";

Deno.test("AtomicCounter", async (t) => {
  await t.step("increment - increments counter by default amount", async () => {
    const kv = await Deno.openKv(":memory:");
    const counter = new AtomicCounter(kv, ["test", "counter"]);

    await counter.increment();
    const value = await counter.get();
    assertEquals(value, 1n);

    await kv.close();
  });

  await t.step(
    "increment - increments counter by specified amount",
    async () => {
      const kv = await Deno.openKv(":memory:");
      const counter = new AtomicCounter(kv, ["test", "counter"]);

      await counter.increment(5);
      const value = await counter.get();
      assertEquals(value, 5n);

      await counter.increment(3n);
      const value2 = await counter.get();
      assertEquals(value2, 8n);

      await kv.close();
    },
  );

  await t.step("decrement - decrements counter by default amount", async () => {
    const kv = await Deno.openKv(":memory:");
    const counter = new AtomicCounter(kv, ["test", "counter"]);

    await counter.set(10);
    await counter.decrement();
    const value = await counter.get();
    assertEquals(value, 9n);

    await kv.close();
  });

  await t.step(
    "decrement - decrements counter by specified amount",
    async () => {
      const kv = await Deno.openKv(":memory:");
      const counter = new AtomicCounter(kv, ["test", "counter"]);

      await counter.set(10);
      await counter.decrement(3);
      const value = await counter.get();
      assertEquals(value, 7n);

      await counter.decrement(2n);
      const value2 = await counter.get();
      assertEquals(value2, 5n);

      await kv.close();
    },
  );

  await t.step("decrement - does not go below zero", async () => {
    const kv = await Deno.openKv(":memory:");
    const counter = new AtomicCounter(kv, ["test", "counter"]);

    await counter.set(2);
    await counter.decrement(5);
    const value = await counter.get();
    assertEquals(value, 0n);

    await kv.close();
  });

  await t.step("get - returns zero for non-existent counter", async () => {
    const kv = await Deno.openKv(":memory:");
    const counter = new AtomicCounter(kv, ["test", "counter"]);

    const value = await counter.get();
    assertEquals(value, 0n);

    await kv.close();
  });

  await t.step("reset - resets counter to zero", async () => {
    const kv = await Deno.openKv(":memory:");
    const counter = new AtomicCounter(kv, ["test", "counter"]);

    await counter.set(42);
    await counter.reset();
    const value = await counter.get();
    assertEquals(value, 0n);

    await kv.close();
  });

  await t.step("set - sets counter to specific value", async () => {
    const kv = await Deno.openKv(":memory:");
    const counter = new AtomicCounter(kv, ["test", "counter"]);

    await counter.set(100);
    const value = await counter.get();
    assertEquals(value, 100n);

    await counter.set(200n);
    const value2 = await counter.get();
    assertEquals(value2, 200n);

    await kv.close();
  });

  await t.step(
    "conditionalIncrement - increments when condition matches",
    async () => {
      const kv = await Deno.openKv(":memory:");
      const counter = new AtomicCounter(kv, ["test", "counter"]);

      await counter.set(5);
      const result = await counter.conditionalIncrement(5n);
      assertEquals(result.ok, true);

      const value = await counter.get();
      assertEquals(value, 6n);

      await kv.close();
    },
  );

  await t.step(
    "conditionalIncrement - does not increment when condition does not match",
    async () => {
      const kv = await Deno.openKv(":memory:");
      const counter = new AtomicCounter(kv, ["test", "counter"]);

      await counter.set(5);
      const result = await counter.conditionalIncrement(10n);
      assertEquals(result.ok, false);

      const value = await counter.get();
      assertEquals(value, 5n);

      await kv.close();
    },
  );

  await t.step(
    "conditionalIncrement - increments by specified amount",
    async () => {
      const kv = await Deno.openKv(":memory:");
      const counter = new AtomicCounter(kv, ["test", "counter"]);

      await counter.set(5);
      const result = await counter.conditionalIncrement(5n, 10);
      assertEquals(result.ok, true);

      const value = await counter.get();
      assertEquals(value, 15n);

      await kv.close();
    },
  );
});

Deno.test("ModelAtomicUtils", async (t) => {
  const userEntity: KVMEntity = {
    name: "users",
    primaryKey: [
      { name: "users" },
      { key: "id" },
    ],
    secondaryIndexes: [],
    relations: [],
    schema: z.object({
      id: z.string(),
      name: z.string(),
    }),
  };

  await t.step(
    "createFieldCounter - creates counter with string record key",
    async () => {
      const kv = await Deno.openKv(":memory:");
      const utils = new ModelAtomicUtils(kv, userEntity);

      const counter = utils.createFieldCounter("user123", "likes");
      assertInstanceOf(counter, AtomicCounter);

      await counter.increment(5);
      const value = await counter.get();
      assertEquals(value, 5n);

      await kv.close();
    },
  );

  await t.step(
    "createFieldCounter - creates counter with object record key",
    async () => {
      const kv = await Deno.openKv(":memory:");
      const utils = new ModelAtomicUtils(kv, userEntity);

      const counter = utils.createFieldCounter({ id: "user456" }, "views");
      assertInstanceOf(counter, AtomicCounter);

      await counter.increment(10);
      const value = await counter.get();
      assertEquals(value, 10n);

      await kv.close();
    },
  );

  await t.step("incrementField - increments field counter", async () => {
    const kv = await Deno.openKv(":memory:");
    const utils = new ModelAtomicUtils(kv, userEntity);

    await utils.incrementField("user123", "likes");
    await utils.incrementField("user123", "likes", 4);

    const counter = utils.createFieldCounter("user123", "likes");
    const value = await counter.get();
    assertEquals(value, 5n);

    await kv.close();
  });

  await t.step(
    "incrementFields - increments multiple fields atomically",
    async () => {
      const kv = await Deno.openKv(":memory:");
      const utils = new ModelAtomicUtils(kv, userEntity);

      await utils.incrementFields("user123", {
        likes: 5,
        views: 10n,
        shares: 2,
      });

      const likes = await utils.createFieldCounter("user123", "likes").get();
      const views = await utils.createFieldCounter("user123", "views").get();
      const shares = await utils.createFieldCounter("user123", "shares").get();

      assertEquals(likes, 5n);
      assertEquals(views, 10n);
      assertEquals(shares, 2n);

      await kv.close();
    },
  );

  await t.step(
    "getCounters - retrieves all counter values for a record",
    async () => {
      const kv = await Deno.openKv(":memory:");
      const utils = new ModelAtomicUtils(kv, userEntity);

      await utils.incrementFields("user123", {
        likes: 15,
        views: 100,
        shares: 5,
      });

      const counters = await utils.getCounters("user123");
      assertEquals(counters.likes, 15n);
      assertEquals(counters.views, 100n);
      assertEquals(counters.shares, 5n);

      await kv.close();
    },
  );

  await t.step(
    "getCounters - returns empty object for record with no counters",
    async () => {
      const kv = await Deno.openKv(":memory:");
      const utils = new ModelAtomicUtils(kv, userEntity);

      const counters = await utils.getCounters("user999");
      assertEquals(counters, {});

      await kv.close();
    },
  );

  await t.step("getCounters - works with object record key", async () => {
    const kv = await Deno.openKv(":memory:");
    const utils = new ModelAtomicUtils(kv, userEntity);

    await utils.incrementFields({ id: "user456" }, {
      likes: 20,
      views: 50,
    });

    const counters = await utils.getCounters({ id: "user456" });
    assertEquals(counters.likes, 20n);
    assertEquals(counters.views, 50n);

    await kv.close();
  });
});

Deno.test("AtomicUtils factory", async (t) => {
  await t.step("counter - creates AtomicCounter instance", async () => {
    const kv = await Deno.openKv(":memory:");

    const counter = AtomicUtils.counter(kv, ["test", "counter"]);
    assertInstanceOf(counter, AtomicCounter);

    await counter.increment(42);
    const value = await counter.get();
    assertEquals(value, 42n);

    await kv.close();
  });

  await t.step("forModel - creates ModelAtomicUtils instance", async () => {
    const kv = await Deno.openKv(":memory:");
    const entity: KVMEntity = {
      name: "posts",
      primaryKey: [
        { name: "posts" },
        { key: "id" },
      ],
      secondaryIndexes: [],
      relations: [],
      schema: z.object({
        id: z.string(),
        title: z.string(),
      }),
    };

    const utils = AtomicUtils.forModel(kv, entity);
    assertInstanceOf(utils, ModelAtomicUtils);

    await utils.incrementField("post123", "views", 100);
    const counters = await utils.getCounters("post123");
    assertEquals(counters.views, 100n);

    await kv.close();
  });

  await t.step("builder - provides access to atomic builder", async () => {
    const kv = await Deno.openKv(":memory:");

    const builder = AtomicUtils.builder(kv);
    assertEquals(typeof builder.sum, "function");
    assertEquals(typeof builder.set, "function");
    assertEquals(typeof builder.commit, "function");

    await kv.close();
  });
});
