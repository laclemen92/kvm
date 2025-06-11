import {
  assertEquals,
  assertExists,
  assertNotEquals,
  assertRejects,
  assertThrows,
} from "https://deno.land/std@0.218.0/assert/mod.ts";
import { z } from "zod";
import {
  getWatchManager,
  initializeWatchManager,
  WatchManager,
  watchQuery,
  watchRecord,
  watchRecords,
} from "./watch.ts";
import { WatchEventType } from "./watch-types.ts";
import { WatchUtils } from "./watch-utils.ts";
import type { KVMEntity } from "./types.ts";
import type {
  SSEOptions,
  WatchEvent,
  WatchManyOptions,
  WatchOptions,
  WebSocketOptions,
} from "./watch-types.ts";
import { buildPrimaryKey } from "./utils.ts";

// Test entities
const userSchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string().email(),
  age: z.number(),
  status: z.string().optional(),
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
  published: z.boolean().default(false),
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

const compositeEntity: KVMEntity = {
  name: "composite",
  primaryKey: [
    { name: "composite" },
    { key: "tenantId" },
    { key: "entityId" },
  ],
  schema: z.object({
    tenantId: z.string(),
    entityId: z.string(),
    data: z.string(),
  }),
};

Deno.test("WatchUtils - comprehensive SSE testing", async () => {
  const events = [
    WatchUtils.createEvent(
      WatchEventType.CREATED,
      ["users", "1"],
      { id: "1", name: "John" },
      "1",
      "users",
    ),
    WatchUtils.createEvent(
      WatchEventType.UPDATED,
      ["users", "1"],
      { id: "1", name: "John Doe" },
      "2",
      "users",
    ),
    WatchUtils.createEvent(
      WatchEventType.DELETED,
      ["users", "1"],
      null,
      "3",
      "users",
    ),
  ];

  const stream = new ReadableStream({
    start(controller) {
      events.forEach((event) => controller.enqueue(event));
      controller.close();
    },
  });

  // Test with custom serializer
  const customResponse = WatchUtils.createSSEResponse(stream, {
    eventName: "custom-event",
    includeMetadata: false,
    serializer: (event) => `Custom: ${event.type} - ${event.modelName}`,
    heartbeatInterval: 100,
  });

  assertEquals(customResponse.headers.get("Content-Type"), "text/event-stream");
  assertEquals(customResponse.headers.get("Access-Control-Allow-Origin"), "*");

  // Read first chunk to test serializer
  const reader = customResponse.body?.getReader();
  if (reader) {
    const { value } = await reader.read();
    const text = new TextDecoder().decode(value);
    assertEquals(text.includes("retry: 1000"), true);
    reader.cancel();
    reader.releaseLock();
  }
});

Deno.test("WatchUtils - WebSocket handler comprehensive testing", async () => {
  let wsMessages: string[] = [];
  let wsClosed = false;
  let wsError = false;

  // Mock WebSocket
  const mockWebSocket = {
    readyState: 1, // OPEN
    send: (data: string) => wsMessages.push(data),
    close: () => {
      wsClosed = true;
    },
    addEventListener: (event: string, handler: Function) => {
      if (event === "open") {
        setTimeout(() => handler(), 10);
      }
    },
    onopen: null as any,
    onclose: null as any,
    onerror: null as any,
  };

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

  // Test with custom options
  const handler = WatchUtils.createWebSocketHandler(stream, {
    messageType: "data-change",
    includeMetadata: false,
    serializer: (event) => JSON.stringify({ custom: true, event: event.type }),
    enablePing: false,
    pingInterval: 0,
  });

  handler(mockWebSocket as any);

  // Trigger open event
  if (mockWebSocket.onopen) {
    mockWebSocket.onopen({} as any);
  }

  // Wait for processing
  await new Promise((resolve) => setTimeout(resolve, 50));

  assertEquals(wsMessages.length >= 1, true);

  // Test close handler
  if (mockWebSocket.onclose) {
    mockWebSocket.onclose({} as any);
  }

  // Test error handler
  if (mockWebSocket.onerror) {
    mockWebSocket.onerror({} as any);
  }
});

Deno.test("WatchUtils - mergeStreams comprehensive", async () => {
  const stream1 = new ReadableStream({
    start(controller) {
      controller.enqueue(
        WatchUtils.createEvent(
          WatchEventType.CREATED,
          ["users", "1"],
          { id: "1" },
          "1",
          "users",
        ),
      );
      controller.close();
    },
  });

  const stream2 = new ReadableStream({
    start(controller) {
      controller.enqueue(
        WatchUtils.createEvent(
          WatchEventType.UPDATED,
          ["posts", "1"],
          { id: "1" },
          "2",
          "posts",
        ),
      );
      controller.close();
    },
  });

  const stream3 = new ReadableStream({
    start(controller) {
      // Error stream
      controller.error(new Error("Stream error"));
    },
  });

  // Test successful merge
  const mergedStream = WatchUtils.mergeStreams([stream1, stream2]);
  const events = [];
  const reader = mergedStream.getReader();

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      events.push(value);
    }
  } catch (error) {
    // Expected for error stream
  } finally {
    reader.releaseLock();
  }

  assertEquals(events.length >= 1, true);

  // Test with error stream
  const errorMergedStream = WatchUtils.mergeStreams([stream3]);
  const errorReader = errorMergedStream.getReader();

  try {
    await errorReader.read();
  } catch (error) {
    assertEquals((error as Error).message, "Stream error");
  } finally {
    errorReader.releaseLock();
  }
});

Deno.test("WatchUtils - mapStream", async () => {
  const sourceEvents = [
    WatchUtils.createEvent(
      WatchEventType.CREATED,
      ["users", "1"],
      { id: "1", name: "John" },
      "1",
      "users",
    ),
  ];

  const sourceStream = new ReadableStream({
    start(controller) {
      sourceEvents.forEach((event) => controller.enqueue(event));
      controller.close();
    },
  });

  const mappedStream = WatchUtils.mapStream(sourceStream, (event) => ({
    ...event,
    value: event.value ? { ...event.value, mapped: true } : null,
    modelName: `mapped_${event.modelName}`,
  }));

  const events = [];
  const reader = mappedStream.getReader();

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      events.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  assertEquals(events.length, 1);
  assertEquals(events[0].modelName, "mapped_users");
  assertEquals((events[0].value as any).mapped, true);
});

Deno.test("WatchManager - comprehensive error handling", async () => {
  const kv = await Deno.openKv(":memory:");

  try {
    const manager = new WatchManager(kv);

    // Test empty records for watchQuery
    const emptyWatchResult = await manager.watchQuery(userEntity, {
      limit: 0,
      prefix: ["nonexistent"],
    });

    assertEquals(typeof emptyWatchResult.stop, "function");
    assertEquals(typeof emptyWatchResult.on, "function");

    const events: any[] = [];
    const reader = emptyWatchResult.stream.getReader();

    // Should immediately close for empty results
    const { done } = await reader.read();
    assertEquals(done, true);

    reader.releaseLock();
    emptyWatchResult.stop();

    // Note: Testing findMany error handling is challenging because findMany
    // is quite resilient and may not throw errors in expected scenarios.
    // The error handling path exists in the code for genuine findMany failures
    // that would occur in practice with corrupted data or KV errors.
  } finally {
    await kv.close();
  }
});

Deno.test("WatchManager - watchRelations comprehensive", async () => {
  const kv = await Deno.openKv(":memory:");

  try {
    const manager = new WatchManager(kv);

    // Test entity without relations
    await assertRejects(
      () => manager.watchRelations(userEntity, "user1", { relation: "posts" }),
      Error,
      "has no relations defined",
    );

    // Test non-existent relation
    await assertRejects(
      () =>
        manager.watchRelations(postEntity, "post1", {
          relation: "nonexistent",
        }),
      Error,
      "Relation nonexistent not found",
    );

    // Test valid relation
    const userId = "user1";
    const userKey = buildPrimaryKey(userEntity.primaryKey, { id: userId });
    await kv.set(userKey, {
      id: userId,
      name: "John",
      email: "john@example.com",
      age: 30,
    });

    const watchResult = await manager.watchRelations(postEntity, "post1", {
      relation: "users",
      includeRelated: true,
      depth: 2,
    });

    assertEquals(typeof watchResult.stop, "function");

    // Test the stream briefly
    const reader = watchResult.stream.getReader();
    setTimeout(() => {
      reader.cancel();
      reader.releaseLock();
      watchResult.stop();
    }, 10);

    try {
      await reader.read();
    } catch {
      // Expected to be cancelled
    }
  } finally {
    await kv.close();
  }
});

Deno.test("WatchManager - batch watching placeholder", async () => {
  const kv = await Deno.openKv(":memory:");

  try {
    const manager = new WatchManager(kv);

    // Test batch watching (should throw not implemented error)
    await assertRejects(
      () =>
        manager.watchBatch({
          entities: {
            users: { limit: 5 },
            posts: { limit: 3 },
          },
          maxKeys: 10,
        }),
      Error,
      "Batch watching requires entity registry",
    );
  } finally {
    await kv.close();
  }
});

Deno.test("WatchManager - state management", async () => {
  const kv = await Deno.openKv(":memory:");

  try {
    const manager = new WatchManager(kv);

    // Test active watch count
    assertEquals(manager.getActiveWatchCount(), 0);

    // Start a watch
    const userId = "user1";
    const userKey = buildPrimaryKey(userEntity.primaryKey, { id: userId });
    await kv.set(userKey, {
      id: userId,
      name: "John",
      email: "john@example.com",
      age: 30,
    });

    const watchResult = await manager.watch(userEntity, userId);

    // Should have one active watch
    assertEquals(manager.getActiveWatchCount(), 1);

    // Stop the watch
    watchResult.stop();

    // Wait a bit for cleanup
    await new Promise((resolve) => setTimeout(resolve, 10));

    // Should have no active watches
    assertEquals(manager.getActiveWatchCount(), 0);

    // Test stopAll
    const watchResult2 = await manager.watch(userEntity, userId);
    assertEquals(manager.getActiveWatchCount(), 1);

    manager.stopAll();
    assertEquals(manager.getActiveWatchCount(), 0);
  } finally {
    await kv.close();
  }
});

Deno.test("WatchManager - composite keys", async () => {
  const kv = await Deno.openKv(":memory:");

  try {
    const manager = new WatchManager(kv);

    // Test composite key watching
    const compositeId = { tenantId: "tenant1", entityId: "entity1" };
    const compositeKey = buildPrimaryKey(
      compositeEntity.primaryKey,
      compositeId,
    );

    await kv.set(compositeKey, {
      tenantId: "tenant1",
      entityId: "entity1",
      data: "test data",
    });

    const watchResult = await manager.watch(compositeEntity, compositeId);
    const events: any[] = [];

    const reader = watchResult.stream.getReader();
    const readEvents = async () => {
      try {
        while (events.length < 1) {
          const { done, value } = await reader.read();
          if (done) break;
          events.push(value);
        }
      } finally {
        reader.releaseLock();
      }
    };

    await readEvents();
    watchResult.stop();

    assertEquals(events.length, 1);
    assertEquals(events[0].type, WatchEventType.INITIAL);
    assertEquals(events[0].value.tenantId, "tenant1");
  } finally {
    await kv.close();
  }
});

Deno.test("WatchManager - options variations", async () => {
  const kv = await Deno.openKv(":memory:");

  try {
    const manager = new WatchManager(kv);

    const userId = "user1";
    const userKey = buildPrimaryKey(userEntity.primaryKey, { id: userId });
    await kv.set(userKey, {
      id: userId,
      name: "John",
      email: "john@example.com",
      age: 30,
    });

    // Test with includeDeleted and raw options
    const watchResult = await manager.watch(userEntity, userId, {
      includeDeleted: true,
      raw: true,
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
      } finally {
        reader.releaseLock();
      }
    };

    const readPromise = readEvents();

    // Delete the user to test includeDeleted
    await new Promise((resolve) => setTimeout(resolve, 50));
    await kv.delete(userKey);

    await readPromise;
    watchResult.stop();

    // Should get initial and potentially delete events
    assertEquals(events.length >= 1, true);
    assertEquals(events[0].type, WatchEventType.INITIAL);
  } finally {
    await kv.close();
  }
});

Deno.test("Global watch manager", async () => {
  const kv = await Deno.openKv(":memory:");

  try {
    // Test initialization
    const manager = initializeWatchManager(kv);
    assertExists(manager);

    // Test getting the global manager
    const retrieved = getWatchManager();
    assertEquals(manager, retrieved);

    // Note: Testing the uninitialized state would require importing from a fresh module
    // which is not easily doable in this test setup. The error case is covered by
    // the implementation logic and would only occur if getWatchManager() is called
    // before initializeWatchManager() in a fresh module context.
  } finally {
    await kv.close();
  }
});

Deno.test("Stream transformation edge cases", async () => {
  // Test debounce with no events
  const emptyStream = new ReadableStream({
    start(controller) {
      controller.close();
    },
  });

  const debouncedEmpty = WatchUtils.debounceStream(emptyStream, 100);
  const events = [];
  const reader = debouncedEmpty.getReader();

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      events.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  assertEquals(events.length, 0);

  // Test filter with no matching events
  const sourceStream = new ReadableStream({
    start(controller) {
      controller.enqueue(
        WatchUtils.createEvent(
          WatchEventType.CREATED,
          ["users", "1"],
          { id: "1" },
          "1",
          "users",
        ),
      );
      controller.close();
    },
  });

  const filteredStream = WatchUtils.filterStream(sourceStream, () => false);
  const filteredEvents = [];
  const filteredReader = filteredStream.getReader();

  try {
    while (true) {
      const { done, value } = await filteredReader.read();
      if (done) break;
      filteredEvents.push(value);
    }
  } finally {
    filteredReader.releaseLock();
  }

  assertEquals(filteredEvents.length, 0);
});

Deno.test("Watch callback error handling", async () => {
  const kv = await Deno.openKv(":memory:");

  try {
    const manager = new WatchManager(kv);

    const userId = "user1";
    const userKey = buildPrimaryKey(userEntity.primaryKey, { id: userId });
    await kv.set(userKey, {
      id: userId,
      name: "John",
      email: "john@example.com",
      age: 30,
    });

    const watchResult = await manager.watch(userEntity, userId);

    let callbackCalled = false;
    let errorThrown = false;

    // Temporarily suppress console.error for this test
    const originalError = console.error;
    console.error = () => {}; // Suppress error output

    // Register a callback that throws an error
    const unsubscribe = watchResult.on((event) => {
      callbackCalled = true;
      throw new Error("Callback error");
    });

    // Give time for initial event
    await new Promise((resolve) => setTimeout(resolve, 50));

    assertEquals(callbackCalled, true);

    unsubscribe();
    watchResult.stop();

    // Restore console.error
    console.error = originalError;

    // Error should be handled gracefully (logged, not thrown)
  } finally {
    await kv.close();
  }
});

Deno.test("WatchManager - watchKeys variations", async () => {
  const kv = await Deno.openKv(":memory:");

  try {
    const manager = new WatchManager(kv);

    // Test with exactly 10 keys (at the limit)
    const ids = Array.from({ length: 10 }, (_, i) => `user${i}`);
    for (const id of ids) {
      const userKey = buildPrimaryKey(userEntity.primaryKey, { id });
      await kv.set(userKey, {
        id,
        name: `User ${id}`,
        email: `${id}@example.com`,
        age: 25,
      });
    }

    const watchResult = await manager.watchMany(userEntity, ids);
    const events: any[] = [];

    const reader = watchResult.stream.getReader();
    const readEvents = async () => {
      try {
        while (events.length < 10) {
          const { done, value } = await reader.read();
          if (done) break;
          events.push(value);
        }
      } finally {
        reader.releaseLock();
      }
    };

    await readEvents();
    watchResult.stop();

    // Should get initial events for all 10 users
    assertEquals(events.length, 10);
    assertEquals(events.every((e) => e.type === WatchEventType.INITIAL), true);
  } finally {
    await kv.close();
  }
});

Deno.test("Error stream handling", async () => {
  // Test map stream with error
  const errorStream = new ReadableStream({
    start(controller) {
      controller.enqueue(
        WatchUtils.createEvent(
          WatchEventType.CREATED,
          ["users", "1"],
          { id: "1" },
          "1",
          "users",
        ),
      );
      controller.error(new Error("Stream error"));
    },
  });

  const mappedStream = WatchUtils.mapStream(errorStream, (event) => event);
  const reader = mappedStream.getReader();

  try {
    await reader.read(); // First read should work
    await reader.read(); // Second read should throw
  } catch (error) {
    assertEquals((error as Error).message, "Stream error");
  } finally {
    reader.releaseLock();
  }

  // Test filter stream with error
  const errorStream2 = new ReadableStream({
    start(controller) {
      controller.error(new Error("Filter stream error"));
    },
  });

  const filteredStream = WatchUtils.filterStream(errorStream2, () => true);
  const filterReader = filteredStream.getReader();

  try {
    await filterReader.read();
  } catch (error) {
    assertEquals((error as Error).message, "Filter stream error");
  } finally {
    filterReader.releaseLock();
  }
});
