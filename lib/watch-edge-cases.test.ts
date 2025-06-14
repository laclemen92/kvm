import {
  assertEquals,
  assertExists,
  type assertNotEquals,
  assertRejects,
} from "https://deno.land/std@0.218.0/assert/mod.ts";
import { z } from "zod";
import { WatchManager, type watchRecord } from "./watch.ts";
import { WatchEventType } from "./watch-types.ts";
import { WatchUtils } from "./watch-utils.ts";
import type { KVMEntity } from "./types.ts";
import { buildPrimaryKey } from "./utils.ts";

// Test entities with various configurations
const simpleEntity: KVMEntity = {
  name: "simple",
  primaryKey: [{ name: "simple", key: "id" }],
  schema: z.object({ id: z.string(), value: z.string() }),
};

const noKeyEntity: KVMEntity = {
  name: "nokey",
  primaryKey: [{ name: "nokey" }], // No key field
  schema: z.object({ data: z.string() }),
};

const complexEntity: KVMEntity = {
  name: "complex",
  primaryKey: [
    { name: "complex" },
    { name: "tenant", key: "tenantId" },
    { name: "type", key: "entityType" },
    { key: "id" },
  ],
  schema: z.object({
    tenantId: z.string(),
    entityType: z.string(),
    id: z.string(),
    data: z.any(),
  }),
};

Deno.test("WatchUtils - edge case key generation", () => {
  // Test with entity that has no key field
  const key1 = WatchUtils.generateWatchKey(noKeyEntity, "test-data");
  assertEquals(key1, ["nokey", "test-data"]);

  // Test with complex multi-part key
  const complexId = {
    tenantId: "tenant1",
    entityType: "user",
    id: "user123",
  };
  const key2 = WatchUtils.generateWatchKey(complexEntity, complexId);
  assertExists(key2);
  assertEquals(key2.length > 2, true);

  // Test generateWatchKeys with mixed types
  const ids = ["simple1", { tenantId: "t1", entityType: "type1", id: "id1" }];
  const keys = WatchUtils.generateWatchKeys(simpleEntity, ids);
  assertEquals(keys.length, 2);
});

Deno.test("WatchManager - rapid successive operations", async () => {
  const kv = await Deno.openKv(":memory:");

  try {
    const manager = new WatchManager(kv);

    // Create initial record
    const recordId = "rapid-test";
    const recordKey = buildPrimaryKey(simpleEntity.primaryKey, {
      id: recordId,
    });

    await kv.set(recordKey, { id: recordId, value: "initial" });

    const watchResult = await manager.watch(simpleEntity, recordId, {
      raw: true,
    });
    const events: any[] = [];

    const reader = watchResult.stream.getReader();
    const readEvents = async () => {
      try {
        while (events.length < 6) { // initial + 5 rapid updates
          const { done, value } = await reader.read();
          if (done) break;
          events.push(value);
        }
      } finally {
        reader.releaseLock();
      }
    };

    const readPromise = readEvents();

    // Wait for initial event
    await new Promise((resolve) => setTimeout(resolve, 50));

    // Perform rapid successive updates
    for (let i = 1; i <= 5; i++) {
      await kv.set(recordKey, { id: recordId, value: `update-${i}` });
      await new Promise((resolve) => setTimeout(resolve, 5)); // Very short delay
    }

    await readPromise;
    watchResult.stop();

    // Should get at least the initial event
    assertEquals(events.length >= 1, true);
    assertEquals(events[0].type, WatchEventType.INITIAL);

    // With raw mode, might get more events (depending on Deno KV behavior)
    // The exact number depends on Deno KV's watch implementation details
  } finally {
    await kv.close();
  }
});

Deno.test("WatchManager - concurrent watches on same record", async () => {
  const kv = await Deno.openKv(":memory:");

  try {
    const manager = new WatchManager(kv);

    const recordId = "concurrent-test";
    const recordKey = buildPrimaryKey(simpleEntity.primaryKey, {
      id: recordId,
    });

    await kv.set(recordKey, { id: recordId, value: "initial" });

    // Start multiple watches on the same record
    const watch1 = await manager.watch(simpleEntity, recordId);
    const watch2 = await manager.watch(simpleEntity, recordId);
    const watch3 = await manager.watch(simpleEntity, recordId);

    assertEquals(manager.getActiveWatchCount(), 3);

    const events1: any[] = [];
    const events2: any[] = [];
    const events3: any[] = [];

    // Set up readers
    const reader1 = watch1.stream.getReader();
    const reader2 = watch2.stream.getReader();
    const reader3 = watch3.stream.getReader();

    const readEvents = async (reader: any, eventArray: any[]) => {
      try {
        while (eventArray.length < 2) {
          const { done, value } = await reader.read();
          if (done) break;
          eventArray.push(value);
        }
      } finally {
        reader.releaseLock();
      }
    };

    const readPromises = Promise.all([
      readEvents(reader1, events1),
      readEvents(reader2, events2),
      readEvents(reader3, events3),
    ]);

    // Wait for initial events
    await new Promise((resolve) => setTimeout(resolve, 50));

    // Update the record
    await kv.set(recordKey, { id: recordId, value: "updated" });

    await readPromises;

    // Stop all watches
    watch1.stop();
    watch2.stop();
    watch3.stop();

    // All watches should have received the initial event
    assertEquals(events1.length >= 1, true);
    assertEquals(events2.length >= 1, true);
    assertEquals(events3.length >= 1, true);

    assertEquals(events1[0].type, WatchEventType.INITIAL);
    assertEquals(events2[0].type, WatchEventType.INITIAL);
    assertEquals(events3[0].type, WatchEventType.INITIAL);
  } finally {
    await kv.close();
  }
});

Deno.test("WatchManager - memory cleanup and resource management", async () => {
  const kv = await Deno.openKv(":memory:");

  try {
    const manager = new WatchManager(kv);

    // Create many short-lived watches
    const promises = [];
    for (let i = 0; i < 20; i++) {
      promises.push((async () => {
        const recordId = `cleanup-test-${i}`;
        const recordKey = buildPrimaryKey(simpleEntity.primaryKey, {
          id: recordId,
        });
        await kv.set(recordKey, { id: recordId, value: `value-${i}` });

        const watchResult = await manager.watch(simpleEntity, recordId);

        // Very brief watch
        setTimeout(() => watchResult.stop(), 10);

        return watchResult;
      })());
    }

    await Promise.all(promises);

    // Wait for cleanup
    await new Promise((resolve) => setTimeout(resolve, 100));

    // All watches should be cleaned up
    assertEquals(manager.getActiveWatchCount(), 0);
  } finally {
    await kv.close();
  }
});

Deno.test("Stream utilities - complex transformation chains", async () => {
  const events = [
    WatchUtils.createEvent(
      WatchEventType.CREATED,
      ["test", "1"],
      { id: "1", score: 10 },
      "1",
      "test",
    ),
    WatchUtils.createEvent(
      WatchEventType.UPDATED,
      ["test", "2"],
      { id: "2", score: 20 },
      "2",
      "test",
    ),
    WatchUtils.createEvent(
      WatchEventType.DELETED,
      ["test", "3"],
      null,
      "3",
      "test",
    ),
    WatchUtils.createEvent(
      WatchEventType.UPDATED,
      ["test", "4"],
      { id: "4", score: 5 },
      "4",
      "test",
    ),
    WatchUtils.createEvent(
      WatchEventType.CREATED,
      ["test", "5"],
      { id: "5", score: 15 },
      "5",
      "test",
    ),
  ];

  const sourceStream = new ReadableStream({
    start(controller) {
      events.forEach((event) => controller.enqueue(event));
      controller.close();
    },
  });

  // Chain multiple transformations
  const transformedStream = WatchUtils.mapStream(
    WatchUtils.filterStream(
      sourceStream,
      (event) =>
        event.type !== WatchEventType.DELETED &&
        event.value !== null &&
        (event.value as any).score > 10,
    ),
    (event) => ({
      ...event,
      value: event.value ? { ...event.value, transformed: true } : null,
    }),
  );

  const results = [];
  const reader = transformedStream.getReader();

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      results.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  // Should get filtered and transformed events
  assertEquals(results.length, 2); // id:2 (score 20) and id:5 (score 15)
  assertEquals(results.every((r) => (r.value as any).transformed), true);
  assertEquals(results.every((r) => (r.value as any).score > 10), true);
});

Deno.test("SSE Response - custom serialization and error handling", async () => {
  const events = [
    WatchUtils.createEvent(
      WatchEventType.CREATED,
      ["test", "1"],
      { secret: "hidden", public: "visible" },
      "1",
      "test",
    ),
  ];

  // Test custom serializer that filters sensitive data
  const sensitiveStream = new ReadableStream({
    start(controller) {
      events.forEach((event) => controller.enqueue(event));
      controller.close();
    },
  });

  const response = WatchUtils.createSSEResponse(sensitiveStream, {
    eventName: "filtered-data",
    serializer: (event) => {
      const filtered = event.value ? { public: event.value.public } : null;
      return JSON.stringify({ type: event.type, value: filtered });
    },
    heartbeatInterval: 0,
  });

  assertExists(response);
  assertEquals(
    response.headers.get("Access-Control-Allow-Headers"),
    "Cache-Control",
  );

  // Test that the response can be read
  const reader = response.body?.getReader();
  if (reader) {
    // Read multiple chunks to get the actual data
    let allText = "";
    try {
      for (let i = 0; i < 5; i++) {
        const { done, value } = await reader.read();
        if (done) break;
        allText += new TextDecoder().decode(value);
        // Break if we find our expected content
        if (allText.includes("public")) break;
      }
    } finally {
      reader.cancel();
      reader.releaseLock();
    }

    // Should contain filtered data but not sensitive data
    assertEquals(allText.includes("public"), true);
    assertEquals(allText.includes("secret"), false);
  }
});

Deno.test("WebSocket handler - connection lifecycle", async () => {
  const events = [
    WatchUtils.createEvent(
      WatchEventType.CREATED,
      ["test", "1"],
      { id: "1", message: "hello" },
      "1",
      "test",
    ),
  ];

  const stream = new ReadableStream({
    start(controller) {
      setTimeout(() => {
        events.forEach((event) => controller.enqueue(event));
        controller.close();
      }, 20);
    },
  });

  let sentMessages: string[] = [];
  let connectionClosed = false;

  // Mock WebSocket that simulates connection lifecycle
  const mockSocket = {
    readyState: 1, // OPEN initially
    send: (data: string) => sentMessages.push(data),
    close: () => {
      connectionClosed = true;
    },
    addEventListener: (event: string, handler: Function) => {
      // Simulate events
      if (event === "open") {
        setTimeout(() => handler(), 5);
      }
    },
    onopen: null as any,
    onclose: null as any,
    onerror: null as any,
  };

  const handler = WatchUtils.createWebSocketHandler(stream, {
    messageType: "lifecycle-test",
    enablePing: true,
    pingInterval: 50,
  });

  // Start the handler
  handler(mockSocket as any);

  // Trigger open
  if (mockSocket.onopen) {
    mockSocket.onopen({} as any);
  }

  // Wait for stream processing
  await new Promise((resolve) => setTimeout(resolve, 100));

  // Should have received messages
  assertEquals(sentMessages.length >= 1, true);

  // Simulate connection close
  if (mockSocket.onclose) {
    mockSocket.onclose({} as any);
  }

  // Simulate error
  if (mockSocket.onerror) {
    mockSocket.onerror({} as any);
  }
});

Deno.test("Error scenarios - malformed data and edge cases", async () => {
  const kv = await Deno.openKv(":memory:");

  try {
    const manager = new WatchManager(kv);

    // Test watching with malformed entity
    const malformedEntity = {
      name: "malformed",
      primaryKey: [], // Empty primary key
      schema: z.object({ id: z.string() }),
    } as any;

    await assertRejects(
      async () => WatchUtils.generateWatchKey(malformedEntity, "test"),
      Error,
    );

    // Test with null/undefined values
    const nullEvent = WatchUtils.createEvent(
      WatchEventType.CREATED,
      ["test", "null"],
      null,
      null,
      "test",
    );

    assertEquals(nullEvent.value, null);
    assertEquals(nullEvent.versionstamp, null);

    // Test determineEventType with edge cases
    assertEquals(
      WatchUtils.determineEventType(undefined as any, null),
      WatchEventType.UPDATED,
    );

    assertEquals(
      WatchUtils.determineEventType(null, undefined as any),
      WatchEventType.UPDATED,
    );
  } finally {
    await kv.close();
  }
});

Deno.test("Performance - high-frequency updates", async () => {
  const kv = await Deno.openKv(":memory:");

  try {
    const manager = new WatchManager(kv);

    const recordId = "performance-test";
    const recordKey = buildPrimaryKey(simpleEntity.primaryKey, {
      id: recordId,
    });

    await kv.set(recordKey, { id: recordId, value: "initial" });

    const watchResult = await manager.watch(simpleEntity, recordId);
    const events: any[] = [];
    let eventCount = 0;

    const unsubscribe = watchResult.on((event) => {
      eventCount++;
    });

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

    const readPromise = readEvents();

    // Wait for initial event
    await new Promise((resolve) => setTimeout(resolve, 50));

    // High-frequency updates
    const updatePromises = [];
    for (let i = 0; i < 50; i++) {
      updatePromises.push(
        kv.set(recordKey, { id: recordId, value: `update-${i}` }),
      );
    }

    await Promise.all(updatePromises);
    await new Promise((resolve) => setTimeout(resolve, 100));

    watchResult.stop();
    unsubscribe();

    // Should handle high-frequency updates gracefully
    assertEquals(events.length >= 1, true);
    assertEquals(eventCount >= 1, true);

    // First event should be initial
    assertEquals(events[0].type, WatchEventType.INITIAL);
  } finally {
    await kv.close();
  }
});

Deno.test("Stream error propagation", async () => {
  const errorStream = new ReadableStream({
    start(controller) {
      // Emit one event then error
      controller.enqueue(
        WatchUtils.createEvent(
          WatchEventType.CREATED,
          ["test", "1"],
          { id: "1" },
          "1",
          "test",
        ),
      );
      setTimeout(() => controller.error(new Error("Simulated error")), 10);
    },
  });

  // Test debounce with error
  const debouncedStream = WatchUtils.debounceStream(errorStream, 50);
  const reader = debouncedStream.getReader();

  try {
    await reader.read(); // Should work
    await reader.read(); // Should throw
    assertEquals(false, true, "Expected error to be thrown");
  } catch (error) {
    assertEquals((error as Error).message, "Simulated error");
  } finally {
    reader.releaseLock();
  }
});

Deno.test("Complex composite key scenarios", async () => {
  const kv = await Deno.openKv(":memory:");

  try {
    const manager = new WatchManager(kv);

    // Test with deeply nested composite key
    const complexId = {
      tenantId: "acme-corp",
      entityType: "customer-profile",
      id: "user-abc-123",
    };

    const complexKey = buildPrimaryKey(complexEntity.primaryKey, complexId);
    await kv.set(complexKey, {
      tenantId: complexId.tenantId,
      entityType: complexId.entityType,
      id: complexId.id,
      data: { nested: { deep: { value: "test" } } },
    });

    const watchResult = await manager.watch(complexEntity, complexId);
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
    assertEquals(events[0].value.tenantId, "acme-corp");
    assertEquals(events[0].value.data.nested.deep.value, "test");
  } finally {
    await kv.close();
  }
});
