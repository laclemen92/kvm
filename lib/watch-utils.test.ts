import { assertEquals, assertInstanceOf } from "https://deno.land/std@0.220.0/assert/mod.ts";
import { WatchUtils } from "./watch-utils.ts";
import { WatchEventType } from "./watch-types.ts";
import type { WatchEvent } from "./watch-types.ts";
import type { KVMEntity } from "./types.ts";
import { z } from "zod";

Deno.test("WatchUtils.createEvent", () => {
  const event = WatchUtils.createEvent(
    WatchEventType.CREATED,
    ["users", "123"],
    { id: "123", name: "John" },
    "v1",
    "users",
    null
  );

  assertEquals(event.type, WatchEventType.CREATED);
  assertEquals(event.key, ["users", "123"]);
  assertEquals(event.value, { id: "123", name: "John" });
  assertEquals(event.versionstamp, "v1");
  assertEquals(event.modelName, "users");
  assertEquals(event.previousValue, null);
  assertInstanceOf(event.timestamp, Date);
});

Deno.test("WatchUtils.determineEventType", () => {
  // Initial event
  assertEquals(
    WatchUtils.determineEventType({ id: "1" }, null, true),
    WatchEventType.INITIAL
  );

  // Created event
  assertEquals(
    WatchUtils.determineEventType({ id: "1" }, null, false),
    WatchEventType.CREATED
  );

  // Deleted event
  assertEquals(
    WatchUtils.determineEventType(null, { id: "1" }, false),
    WatchEventType.DELETED
  );

  // Updated event
  assertEquals(
    WatchUtils.determineEventType({ id: "1", name: "Updated" }, { id: "1", name: "Original" }, false),
    WatchEventType.UPDATED
  );

  // Handle undefined as null
  assertEquals(
    WatchUtils.determineEventType(undefined as any, null, false),
    WatchEventType.UPDATED
  );
  assertEquals(
    WatchUtils.determineEventType({ id: "1" }, undefined as any, false),
    WatchEventType.CREATED
  );
});

Deno.test("WatchUtils.generateWatchKey", () => {
  const userEntity: KVMEntity = {
    name: "users",
    primaryKey: [
      { name: "users" },
      { key: "id" },
    ],
    secondaryIndexes: [],
    schema: z.object({
      id: z.string(),
      name: z.string(),
    }),
  };

  // String ID
  const key1 = WatchUtils.generateWatchKey(userEntity, "user123");
  assertEquals(key1, ["users", "user123"]);

  // Object ID
  const key2 = WatchUtils.generateWatchKey(userEntity, { id: "user456" });
  assertEquals(key2, ["users", "user456"]);

  // Entity without key field
  const entityNoKey: KVMEntity = {
    name: "logs",
    primaryKey: [
      { name: "logs" },
    ],
    secondaryIndexes: [],
    schema: z.object({
      message: z.string(),
    }),
  };

  const key3 = WatchUtils.generateWatchKey(entityNoKey, "log123");
  assertEquals(key3, ["logs", "log123"]);
});

Deno.test("WatchUtils.generateWatchKeys", () => {
  const userEntity: KVMEntity = {
    name: "users",
    primaryKey: [
      { name: "users" },
      { key: "id" },
    ],
    secondaryIndexes: [],
    schema: z.object({
      id: z.string(),
      name: z.string(),
    }),
  };

  const keys = WatchUtils.generateWatchKeys(userEntity, [
    "user1",
    { id: "user2" },
    "user3",
  ]);

  assertEquals(keys, [
    ["users", "user1"],
    ["users", "user2"],
    ["users", "user3"],
  ]);
});

Deno.test("WatchUtils.filterStream", async () => {
  const events: WatchEvent<{ id: string; status: string }>[] = [
    {
      type: WatchEventType.CREATED,
      key: ["users", "1"],
      value: { id: "1", status: "active" },
      previousValue: null,
      versionstamp: "v1",
      timestamp: new Date(),
      modelName: "users",
    },
    {
      type: WatchEventType.UPDATED,
      key: ["users", "2"],
      value: { id: "2", status: "inactive" },
      previousValue: { id: "2", status: "active" },
      versionstamp: "v2",
      timestamp: new Date(),
      modelName: "users",
    },
    {
      type: WatchEventType.CREATED,
      key: ["users", "3"],
      value: { id: "3", status: "active" },
      previousValue: null,
      versionstamp: "v3",
      timestamp: new Date(),
      modelName: "users",
    },
  ];

  const stream = new ReadableStream({
    start(controller) {
      for (const event of events) {
        controller.enqueue(event);
      }
      controller.close();
    },
  });

  // Filter only active users
  const filteredStream = WatchUtils.filterStream(
    stream,
    (event: WatchEvent<{ id: string; status: string }>) => event.value?.status === "active"
  );

  const reader = filteredStream.getReader();
  const results: WatchEvent<{ id: string; status: string }>[] = [];

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    results.push(value as WatchEvent<{ id: string; status: string }>);
  }

  assertEquals(results.length, 2);
  assertEquals(results[0].value?.id, "1");
  assertEquals(results[1].value?.id, "3");
});

Deno.test("WatchUtils.mapStream", async () => {
  const events: WatchEvent<{ id: string; name: string }>[] = [
    {
      type: WatchEventType.CREATED,
      key: ["users", "1"],
      value: { id: "1", name: "John" },
      previousValue: null,
      versionstamp: "v1",
      timestamp: new Date(),
      modelName: "users",
    },
    {
      type: WatchEventType.UPDATED,
      key: ["users", "2"],
      value: { id: "2", name: "Jane" },
      previousValue: { id: "2", name: "Janet" },
      versionstamp: "v2",
      timestamp: new Date(),
      modelName: "users",
    },
  ];

  const stream = new ReadableStream({
    start(controller) {
      for (const event of events) {
        controller.enqueue(event);
      }
      controller.close();
    },
  });

  // Map to uppercase names
  const mappedStream = WatchUtils.mapStream(
    stream,
    (event: WatchEvent<{ id: string; name: string }>) => ({
      ...event,
      value: event.value ? { ...event.value, name: event.value.name.toUpperCase() } : null,
    })
  );

  const reader = mappedStream.getReader();
  const results: WatchEvent<{ id: string; name: string }>[] = [];

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    results.push(value as WatchEvent<{ id: string; name: string }>);
  }

  assertEquals(results.length, 2);
  assertEquals(results[0].value?.name, "JOHN");
  assertEquals(results[1].value?.name, "JANE");
});

Deno.test("WatchUtils.debounceStream", async () => {
  const events: WatchEvent<{ id: string }>[] = [
    {
      type: WatchEventType.CREATED,
      key: ["users", "1"],
      value: { id: "1" },
      previousValue: null,
      versionstamp: "v1",
      timestamp: new Date(),
      modelName: "users",
    },
    {
      type: WatchEventType.UPDATED,
      key: ["users", "1"],
      value: { id: "1" },
      previousValue: { id: "1" },
      versionstamp: "v2",
      timestamp: new Date(),
      modelName: "users",
    },
    {
      type: WatchEventType.UPDATED,
      key: ["users", "1"],
      value: { id: "1" },
      previousValue: { id: "1" },
      versionstamp: "v3",
      timestamp: new Date(),
      modelName: "users",
    },
  ];

  const stream = new ReadableStream({
    async start(controller) {
      for (let i = 0; i < events.length; i++) {
        controller.enqueue(events[i]);
        if (i < events.length - 1) {
          await new Promise(resolve => setTimeout(resolve, 10));
        }
      }
      controller.close();
    },
  });

  // Debounce with 50ms delay
  const debouncedStream = WatchUtils.debounceStream(stream, 50);

  const reader = debouncedStream.getReader();
  const results: WatchEvent<{ id: string }>[] = [];

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    results.push(value as WatchEvent<{ id: string }>);
  }

  // Should only receive the last event due to debouncing
  assertEquals(results.length, 1);
  assertEquals(results[0].versionstamp, "v3");
});

Deno.test("WatchUtils.mergeStreams", async () => {
  const stream1Events: WatchEvent<{ id: string }>[] = [
    {
      type: WatchEventType.CREATED,
      key: ["users", "1"],
      value: { id: "1" },
      previousValue: null,
      versionstamp: "v1",
      timestamp: new Date(),
      modelName: "users",
    },
  ];

  const stream2Events: WatchEvent<{ id: string }>[] = [
    {
      type: WatchEventType.CREATED,
      key: ["posts", "1"],
      value: { id: "1" },
      previousValue: null,
      versionstamp: "v2",
      timestamp: new Date(),
      modelName: "posts",
    },
  ];

  const stream1 = new ReadableStream({
    start(controller) {
      for (const event of stream1Events) {
        controller.enqueue(event);
      }
      controller.close();
    },
  });

  const stream2 = new ReadableStream({
    start(controller) {
      for (const event of stream2Events) {
        controller.enqueue(event);
      }
      controller.close();
    },
  });

  const mergedStream = WatchUtils.mergeStreams([stream1, stream2]);

  const reader = mergedStream.getReader();
  const results: WatchEvent<{ id: string }>[] = [];

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    results.push(value as WatchEvent<{ id: string }>);
  }

  assertEquals(results.length, 2);
  const models = results.map(r => r.modelName).sort();
  assertEquals(models, ["posts", "users"]);
});

Deno.test("WatchUtils.createSSEResponse", () => {
  const events: WatchEvent<{ id: string }>[] = [
    {
      type: WatchEventType.CREATED,
      key: ["users", "1"],
      value: { id: "1" },
      previousValue: null,
      versionstamp: "v1",
      timestamp: new Date(),
      modelName: "users",
    },
  ];

  const stream = new ReadableStream({
    start(controller) {
      for (const event of events) {
        controller.enqueue(event);
      }
      controller.close();
    },
  });

  const response = WatchUtils.createSSEResponse(stream, {
    eventName: "data-change",
    includeMetadata: true,
    heartbeatInterval: 0, // Disable heartbeat for testing
  });

  assertInstanceOf(response, Response);
  assertEquals(response.headers.get("Content-Type"), "text/event-stream");
  assertEquals(response.headers.get("Cache-Control"), "no-cache");
  assertEquals(response.headers.get("Connection"), "keep-alive");
  assertEquals(response.headers.get("Access-Control-Allow-Origin"), "*");
});

Deno.test("WatchUtils.createWebSocketHandler", async () => {
  const events: WatchEvent<{ id: string }>[] = [
    {
      type: WatchEventType.CREATED,
      key: ["users", "1"],
      value: { id: "1" },
      previousValue: null,
      versionstamp: "v1",
      timestamp: new Date(),
      modelName: "users",
    },
  ];

  const stream = new ReadableStream({
    start(controller) {
      for (const event of events) {
        controller.enqueue(event);
      }
      controller.close();
    },
  });

  const handler = WatchUtils.createWebSocketHandler(stream, {
    messageType: "kvm-update",
    includeMetadata: false,
    enablePing: false,
  });

  assertEquals(typeof handler, "function");

  // Mock WebSocket
  const messages: string[] = [];
  const mockSocket = {
    readyState: WebSocket.OPEN,
    send: (data: string) => messages.push(data),
    onopen: null as any,
    onclose: null as any,
    onerror: null as any,
    close: () => {},
  };

  handler(mockSocket as any);
  
  // Trigger onopen
  if (mockSocket.onopen) {
    mockSocket.onopen();
  }

  // Use a promise to wait for async operations
  await new Promise<void>((resolve) => {
    setTimeout(() => {
      assertEquals(messages.length > 0, true);
      const parsed = JSON.parse(messages[0]);
      assertEquals(parsed.type, "kvm-update");
      assertEquals(parsed.data.value, { id: "1" });
      resolve();
    }, 100);
  });
});