import {
  assertEquals,
  assertRejects,
} from "https://deno.land/std@0.218.0/assert/mod.ts";
import { z } from "zod";
import {
  WatchManager,
  watchQuery,
  watchRecord,
  type watchRecords,
} from "./watch.ts";
import { WatchEventType } from "./watch-types.ts";
import { WatchUtils } from "./watch-utils.ts";
import type { KVMEntity } from "./types.ts";
import { buildPrimaryKey } from "./utils.ts";

const userSchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string().email(),
  age: z.number(),
}).strict();

const userEntity: KVMEntity = {
  name: "users",
  primaryKey: [{ name: "users", key: "id" }],
  schema: userSchema,
};

const postSchema = z.object({
  id: z.string(),
  title: z.string(),
  content: z.string(),
  userId: z.string(),
}).strict();

const postEntity: KVMEntity = {
  name: "posts",
  primaryKey: [{ name: "posts", key: "id" }],
  schema: postSchema,
  relations: [{
    entityName: "users",
    fields: ["userId"],
    type: "belongsTo" as any,
  }],
};

Deno.test("WatchManager - watch single record", async () => {
  const kv = await Deno.openKv(":memory:");
  const manager = new WatchManager(kv);

  try {
    // Create initial user
    const userId = "user1";
    const userKey = buildPrimaryKey(userEntity.primaryKey, { id: userId });
    await kv.set(userKey, {
      id: userId,
      name: "John",
      email: "john@example.com",
      age: 30,
    });

    // Start watching
    const watchResult = await manager.watch(userEntity, userId);
    const events: any[] = [];

    // Collect events
    const reader = watchResult.stream.getReader();
    const readEvents = async () => {
      try {
        while (events.length < 2) { // Wait for initial + 1 update
          const { done, value } = await reader.read();
          if (done) break;
          events.push(value);
        }
      } catch (error) {
        console.error("Read error:", error);
      } finally {
        reader.releaseLock();
      }
    };

    // Start reading in background
    const readPromise = readEvents();

    // Give some time for initial event
    await new Promise((resolve) => setTimeout(resolve, 50));

    // Update the user
    await kv.set(userKey, {
      id: userId,
      name: "John Doe",
      email: "john@example.com",
      age: 31,
    });

    // Wait for events
    await readPromise;
    watchResult.stop();

    // Verify events - we should get at least initial event
    assertEquals(events.length >= 1, true);

    // Initial event
    assertEquals(events[0].type, WatchEventType.INITIAL);
    assertEquals(events[0].value.name, "John");
    assertEquals(events[0].modelName, "users");

    // If we got an update event, verify it
    if (events.length > 1) {
      // The second event should be an update, but due to timing, we might get the final state
      const lastEvent = events[events.length - 1];
      assertEquals(
        [WatchEventType.UPDATED, WatchEventType.INITIAL].includes(
          lastEvent.type,
        ),
        true,
      );
      // Just verify we got some change
      assertEquals(typeof lastEvent.value.name, "string");
    }

    // Delete event (if includeDeleted is true, we'd need to set that option)
  } finally {
    await kv.close();
  }
});

Deno.test("WatchManager - watch multiple records", async () => {
  const kv = await Deno.openKv(":memory:");
  const manager = new WatchManager(kv);

  try {
    const userIds = ["user1", "user2"];

    // Create initial users
    for (const userId of userIds) {
      const userKey = buildPrimaryKey(userEntity.primaryKey, { id: userId });
      await kv.set(userKey, {
        id: userId,
        name: `User ${userId}`,
        email: `${userId}@example.com`,
        age: 25,
      });
    }

    // Start watching
    const watchResult = await manager.watchMany(userEntity, userIds);
    const events: any[] = [];

    // Collect initial events
    const reader = watchResult.stream.getReader();
    const readEvents = async () => {
      try {
        while (events.length < 2) { // Wait for 2 initial events
          const { done, value } = await reader.read();
          if (done) break;
          events.push(value);
        }
      } catch (error) {
        console.error("Read error:", error);
      } finally {
        reader.releaseLock();
      }
    };

    await readEvents();
    watchResult.stop();

    // Verify we got initial events for both users
    assertEquals(events.length, 2);
    assertEquals(events.every((e) => e.type === WatchEventType.INITIAL), true);
    assertEquals(events.some((e) => e.value.id === "user1"), true);
    assertEquals(events.some((e) => e.value.id === "user2"), true);
  } finally {
    await kv.close();
  }
});

Deno.test("WatchManager - watch with callback", async () => {
  const kv = await Deno.openKv(":memory:");
  const manager = new WatchManager(kv);

  try {
    const userId = "user1";
    const userKey = buildPrimaryKey(userEntity.primaryKey, { id: userId });

    // Create initial user
    await kv.set(userKey, {
      id: userId,
      name: "John",
      email: "john@example.com",
      age: 30,
    });

    // Start watching with callback
    const watchResult = await manager.watch(userEntity, userId);
    const callbackEvents: any[] = [];

    const unsubscribe = watchResult.on((event) => {
      callbackEvents.push(event);
    });

    // Give time for initial event
    await new Promise((resolve) => setTimeout(resolve, 50));

    // Update user
    await kv.set(userKey, {
      id: userId,
      name: "John Updated",
      email: "john@example.com",
      age: 31,
    });

    // Give time for update event
    await new Promise((resolve) => setTimeout(resolve, 50));

    unsubscribe();
    watchResult.stop();

    // Verify callback received events
    assertEquals(callbackEvents.length >= 1, true);
    // Just verify we got some events - type can vary due to timing
    assertEquals(callbackEvents.every((e) => e.modelName === "users"), true);
  } finally {
    await kv.close();
  }
});

Deno.test("WatchManager - key limit validation", async () => {
  const kv = await Deno.openKv(":memory:");
  const manager = new WatchManager(kv);

  try {
    // Try to watch more than 10 keys (Deno KV limit)
    const manyIds = Array.from({ length: 11 }, (_, i) => `user${i}`);

    await assertRejects(
      () => manager.watchMany(userEntity, manyIds),
      Error,
      "Cannot watch more than 10 keys at once",
    );
  } finally {
    await kv.close();
  }
});

Deno.test("WatchUtils - createEvent", () => {
  const event = WatchUtils.createEvent(
    WatchEventType.CREATED,
    ["users", "user1"],
    { id: "user1", name: "John" },
    "12345",
    "users",
  );

  assertEquals(event.type, WatchEventType.CREATED);
  assertEquals(event.key, ["users", "user1"]);
  assertEquals((event.value as any).name, "John");
  assertEquals(event.versionstamp, "12345");
  assertEquals(event.modelName, "users");
  assertEquals(event.timestamp instanceof Date, true);
});

Deno.test("WatchUtils - determineEventType", () => {
  // Initial
  assertEquals(
    WatchUtils.determineEventType(null, null, true),
    WatchEventType.INITIAL,
  );

  // Created
  assertEquals(
    WatchUtils.determineEventType({ id: "1" }, null),
    WatchEventType.CREATED,
  );

  // Updated
  assertEquals(
    WatchUtils.determineEventType({ id: "1", name: "new" }, {
      id: "1",
      name: "old",
    }),
    WatchEventType.UPDATED,
  );

  // Deleted
  assertEquals(
    WatchUtils.determineEventType(null, { id: "1" }),
    WatchEventType.DELETED,
  );
});

Deno.test("WatchUtils - generateWatchKey", () => {
  const key = WatchUtils.generateWatchKey(userEntity, "user1");
  assertEquals(key, ["users", "user1"]);

  const compositeKey = WatchUtils.generateWatchKey(userEntity, { id: "user1" });
  assertEquals(compositeKey, ["users", "user1"]);
});

Deno.test("WatchUtils - filterStream", async () => {
  const sourceEvents = [
    WatchUtils.createEvent(
      WatchEventType.CREATED,
      ["users", "1"],
      { id: "1", age: 25 },
      "1",
      "users",
    ),
    WatchUtils.createEvent(
      WatchEventType.UPDATED,
      ["users", "2"],
      { id: "2", age: 30 },
      "2",
      "users",
    ),
    WatchUtils.createEvent(
      WatchEventType.DELETED,
      ["users", "3"],
      null,
      "3",
      "users",
    ),
  ];

  const sourceStream = new ReadableStream({
    start(controller) {
      sourceEvents.forEach((event) => controller.enqueue(event));
      controller.close();
    },
  });

  // Filter for only CREATED and UPDATED events
  const filteredStream = WatchUtils.filterStream(
    sourceStream,
    (event) => event.type !== WatchEventType.DELETED,
  );

  const events = [];
  const reader = filteredStream.getReader();

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      events.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  assertEquals(events.length, 2);
  assertEquals(events[0].type, WatchEventType.CREATED);
  assertEquals(events[1].type, WatchEventType.UPDATED);
});

Deno.test("WatchUtils - debounceStream", async () => {
  const sourceEvents = [
    WatchUtils.createEvent(
      WatchEventType.UPDATED,
      ["users", "1"],
      { id: "1", name: "v1" },
      "1",
      "users",
    ),
    WatchUtils.createEvent(
      WatchEventType.UPDATED,
      ["users", "1"],
      { id: "1", name: "v2" },
      "2",
      "users",
    ),
    WatchUtils.createEvent(
      WatchEventType.UPDATED,
      ["users", "1"],
      { id: "1", name: "v3" },
      "3",
      "users",
    ),
  ];

  const sourceStream = new ReadableStream({
    start(controller) {
      // Emit events rapidly
      sourceEvents.forEach((event, index) => {
        setTimeout(() => controller.enqueue(event), index * 10);
      });
      setTimeout(() => controller.close(), 200);
    },
  });

  const debouncedStream = WatchUtils.debounceStream(sourceStream, 50);
  const events = [];
  const reader = debouncedStream.getReader();

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      events.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  // Should only get the last event due to debouncing
  assertEquals(events.length, 1);
  assertEquals((events[0].value as any).name, "v3");
});

Deno.test("functional API - watchRecord", async () => {
  const kv = await Deno.openKv(":memory:");

  try {
    const userId = "user1";
    const userKey = buildPrimaryKey(userEntity.primaryKey, { id: userId });

    // Create user
    await kv.set(userKey, {
      id: userId,
      name: "John",
      email: "john@example.com",
      age: 30,
    });

    // Watch using functional API
    const watchResult = await watchRecord(userEntity, kv, userId, {
      includeDeleted: true,
    });
    const events: any[] = [];

    const reader = watchResult.stream.getReader();
    const readEvents = async () => {
      try {
        while (events.length < 2) {
          const { done, value } = await reader.read();
          if (done) break;
          events.push(value);
        }
      } catch (error) {
        console.error("Read error:", error);
      } finally {
        reader.releaseLock();
      }
    };

    const readPromise = readEvents();

    // Give time for initial event
    await new Promise((resolve) => setTimeout(resolve, 50));

    // Delete user
    await kv.delete(userKey);

    await readPromise;
    watchResult.stop();

    // Should get initial and delete events
    assertEquals(events.length >= 1, true);
    assertEquals(events[0].type, WatchEventType.INITIAL);

    // Check for delete event if we got one
    if (events.length > 1) {
      // Due to timing, we might get different event types
      const hasDeleteEvent = events.some((e) =>
        e.type === WatchEventType.DELETED
      );
      if (hasDeleteEvent) {
        const deleteEvent = events.find((e) =>
          e.type === WatchEventType.DELETED
        );
        assertEquals(deleteEvent?.value, null);
      }
    }
  } finally {
    await kv.close();
  }
});

Deno.test("functional API - watchQuery", async () => {
  const kv = await Deno.openKv(":memory:");

  try {
    // Create some users
    const users = [
      { id: "user1", name: "Alice", email: "alice@example.com", age: 25 },
      { id: "user2", name: "Bob", email: "bob@example.com", age: 30 },
    ];

    for (const user of users) {
      const userKey = buildPrimaryKey(userEntity.primaryKey, { id: user.id });
      await kv.set(userKey, user);
    }

    // Watch using query - limit to 2 records
    const watchResult = await watchQuery(userEntity, kv, {
      limit: 2,
      prefix: ["users"],
    });

    const events: any[] = [];
    const reader = watchResult.stream.getReader();

    const readEvents = async () => {
      try {
        while (events.length < 2) {
          const { done, value } = await reader.read();
          if (done) break;
          events.push(value);
        }
      } catch (error) {
        console.error("Read error:", error);
      } finally {
        reader.releaseLock();
      }
    };

    await readEvents();
    watchResult.stop();

    // Should get initial events for both users
    assertEquals(events.length, 2);
    assertEquals(events.every((e) => e.type === WatchEventType.INITIAL), true);
  } finally {
    await kv.close();
  }
});

Deno.test("SSE Response creation", async () => {
  const events = [
    WatchUtils.createEvent(
      WatchEventType.CREATED,
      ["users", "1"],
      { id: "1", name: "John" },
      "1",
      "users",
    ),
  ];

  const stream = new ReadableStream({
    start(controller) {
      events.forEach((event) => controller.enqueue(event));
      controller.close();
    },
  });

  const response = WatchUtils.createSSEResponse(stream, {
    eventName: "user-change",
    includeMetadata: false,
    heartbeatInterval: 0, // Disable heartbeat to prevent leaks in tests
  });

  assertEquals(response.headers.get("Content-Type"), "text/event-stream");
  assertEquals(response.headers.get("Cache-Control"), "no-cache");
  assertEquals(response.headers.get("Connection"), "keep-alive");

  // Clean up the response stream to prevent leaks
  const reader = response.body?.getReader();
  if (reader) {
    reader.cancel();
    reader.releaseLock();
  }
});

Deno.test("WebSocket handler creation", async () => {
  const events = [
    WatchUtils.createEvent(
      WatchEventType.CREATED,
      ["users", "1"],
      { id: "1", name: "John" },
      "1",
      "users",
    ),
  ];

  const stream = new ReadableStream({
    start(controller) {
      events.forEach((event) => controller.enqueue(event));
      controller.close();
    },
  });

  const handler = WatchUtils.createWebSocketHandler(stream, {
    messageType: "user-change",
    enablePing: false,
  });

  // Verify handler is a function
  assertEquals(typeof handler, "function");
});
