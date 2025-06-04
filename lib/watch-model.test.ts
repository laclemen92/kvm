import {
  assertEquals,
  assertExists,
  assertRejects,
} from "https://deno.land/std@0.218.0/assert/mod.ts";
import { z } from "zod";
import { createKVM } from "./kvm.ts";
import { WatchEventType } from "./watch-types.ts";

// Test schemas
const userSchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string().email(),
  age: z.number(),
  status: z.string().optional(),
});

const postSchema = z.object({
  id: z.string(),
  title: z.string(),
  content: z.string(),
  userId: z.string(),
  published: z.boolean().default(false),
});

const profileSchema = z.object({
  id: z.string(),
  userId: z.string(),
  bio: z.string(),
  avatar: z.string().optional(),
});

Deno.test("Model watch - static method comprehensive", async () => {
  const kv = await Deno.openKv(":memory:");

  try {
    const kvmInstance = new (await import("./kvm.ts")).KVM(kv);

    const User = kvmInstance.model("users", {
      schema: userSchema,
      primaryKey: [{ name: "users", key: "id" }],
    });

    // Create a user to watch
    const user = await User.create({
      id: "user1",
      name: "John Doe",
      email: "john@example.com",
      age: 30,
      status: "active",
    });

    // Test static watch method
    const watchResult = await User.watch("user1");
    assertExists(watchResult);
    assertExists(watchResult.stream);
    assertExists(watchResult.stop);
    assertExists(watchResult.on);
    assertExists(watchResult.toSSE);
    assertExists(watchResult.toWebSocket);

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

    // Give time for initial event
    await new Promise((resolve) => setTimeout(resolve, 50));

    // Update the user to trigger a watch event
    await User.findByIdOrThrow("user1").then((u) =>
      u.update({ name: "John Updated" })
    );

    await readPromise;
    watchResult.stop();

    // Verify events
    assertEquals(events.length >= 1, true);
    assertEquals(events[0].type, WatchEventType.INITIAL);

    // Verify the value is a model instance
    assertExists(events[0].value);
    assertEquals(typeof events[0].value.save, "function");
    assertEquals(typeof events[0].value.delete, "function");
  } finally {
    await kv.close();
  }
});

Deno.test("Model watch - instance method", async () => {
  const kv = await Deno.openKv(":memory:");

  try {
    const kvmInstance = new (await import("./kvm.ts")).KVM(kv);

    const User = kvmInstance.model("users", {
      schema: userSchema,
      primaryKey: [{ name: "users", key: "id" }],
    });

    // Create a user
    const user = await User.create({
      id: "user2",
      name: "Jane Doe",
      email: "jane@example.com",
      age: 25,
    });

    // Test instance watch method
    const watchResult = await user.watch();
    assertExists(watchResult);

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

    // Verify we got the initial event
    assertEquals(events.length, 1);
    assertEquals(events[0].type, WatchEventType.INITIAL);
    assertEquals(events[0].value.id, "user2");
  } finally {
    await kv.close();
  }
});

Deno.test("Model watch - watchMany static method", async () => {
  const kv = await Deno.openKv(":memory:");

  try {
    const kvmInstance = new (await import("./kvm.ts")).KVM(kv);

    const User = kvmInstance.model("users", {
      schema: userSchema,
      primaryKey: [{ name: "users", key: "id" }],
    });

    // Create multiple users
    const users = await Promise.all([
      User.create({
        id: "user3",
        name: "Alice",
        email: "alice@example.com",
        age: 28,
      }),
      User.create({
        id: "user4",
        name: "Bob",
        email: "bob@example.com",
        age: 32,
      }),
      User.create({
        id: "user5",
        name: "Charlie",
        email: "charlie@example.com",
        age: 29,
      }),
    ]);

    // Test watchMany
    const watchResult = await User.watchMany(["user3", "user4", "user5"]);
    const events: any[] = [];

    const reader = watchResult.stream.getReader();
    const readEvents = async () => {
      try {
        while (events.length < 3) {
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

    // Should get initial events for all users
    assertEquals(events.length, 3);
    assertEquals(events.every((e) => e.type === WatchEventType.INITIAL), true);

    // Verify all events have model instances
    events.forEach((event) => {
      assertExists(event.value);
      assertEquals(typeof event.value.save, "function");
      assertEquals(typeof event.value.delete, "function");
    });

    // Verify we got events for all users
    const userIds = events.map((e) => e.value.id).sort();
    assertEquals(userIds, ["user3", "user4", "user5"]);
  } finally {
    await kv.close();
  }
});

Deno.test("Model watch - watchQuery static method", async () => {
  const kv = await Deno.openKv(":memory:");

  try {
    const kvmInstance = new (await import("./kvm.ts")).KVM(kv);

    const User = kvmInstance.model("users", {
      schema: userSchema,
      primaryKey: [{ name: "users", key: "id" }],
    });

    // Create users for querying
    await Promise.all([
      User.create({
        id: "user6",
        name: "David",
        email: "david@example.com",
        age: 35,
        status: "active",
      }),
      User.create({
        id: "user7",
        name: "Eve",
        email: "eve@example.com",
        age: 27,
        status: "active",
      }),
      User.create({
        id: "user8",
        name: "Frank",
        email: "frank@example.com",
        age: 40,
        status: "inactive",
      }),
    ]);

    // Test watchQuery with options
    const watchResult = await User.watchQuery({
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
      } finally {
        reader.releaseLock();
      }
    };

    await readEvents();
    watchResult.stop();

    // Should get events for found users
    assertEquals(events.length, 2);
    events.forEach((event) => {
      assertEquals(event.type, WatchEventType.INITIAL);
      assertExists(event.value);
      assertEquals(typeof event.value.save, "function");
    });
  } finally {
    await kv.close();
  }
});

Deno.test("Model watch - watchRelations static method", async () => {
  const kv = await Deno.openKv(":memory:");

  try {
    const kvmInstance = new (await import("./kvm.ts")).KVM(kv);

    const User = kvmInstance.model("users", {
      schema: userSchema,
      primaryKey: [{ name: "users", key: "id" }],
    });

    const Post = kvmInstance.model("posts", {
      schema: postSchema,
      primaryKey: [{ name: "posts", key: "id" }],
      relations: [{
        entityName: "users",
        fields: ["userId"],
        type: "belongsTo" as any,
      }],
    });

    // Create a user and post
    const user = await User.create({
      id: "user9",
      name: "Grace",
      email: "grace@example.com",
      age: 31,
    });

    const post = await Post.create({
      id: "post1",
      title: "Test Post",
      content: "This is a test post",
      userId: "user9",
      published: true,
    });

    // Test watchRelations
    const watchResult = await Post.watchRelations("post1", "users");
    assertExists(watchResult);

    const events: any[] = [];
    const reader = watchResult.stream.getReader();

    // Just test that it starts properly
    const timerId = setTimeout(() => {
      reader.cancel();
      reader.releaseLock();
      watchResult.stop();
    }, 50);

    try {
      await reader.read();
    } catch {
      // Expected to be cancelled
    } finally {
      clearTimeout(timerId);
    }
  } finally {
    await kv.close();
  }
});

Deno.test("Model watch - error scenarios", async () => {
  const kv = await Deno.openKv(":memory:");

  try {
    const kvmInstance = new (await import("./kvm.ts")).KVM(kv);

    const User = kvmInstance.model("users", {
      schema: userSchema,
      primaryKey: [{ name: "users", key: "id" }],
    });

    // Test watching non-existent user
    const watchResult = await User.watch("nonexistent");
    const events: any[] = [];

    const reader = watchResult.stream.getReader();
    
    // Use a timeout to prevent hanging
    const timeoutId = setTimeout(() => {
      reader.cancel();
      reader.releaseLock();
    }, 100); // Wait 100ms for any events
    
    try {
      const { done, value } = await reader.read();
      if (!done && value) {
        events.push(value);
      }
    } catch (error) {
      // Expected - reader was cancelled
    } finally {
      clearTimeout(timeoutId);
      watchResult.stop();
    }

    // Should not get any events for non-existent user
    assertEquals(events.length, 0);
  } finally {
    await kv.close();
  }
});

Deno.test("Model watch - SSE integration", async () => {
  const kv = await Deno.openKv(":memory:");

  try {
    const kvmInstance = new (await import("./kvm.ts")).KVM(kv);

    const User = kvmInstance.model("users", {
      schema: userSchema,
      primaryKey: [{ name: "users", key: "id" }],
    });

    // Create a user
    await User.create({
      id: "user10",
      name: "Henry",
      email: "henry@example.com",
      age: 33,
    });

    // Test SSE conversion
    const watchResult = await User.watch("user10");
    const sseResponse = watchResult.toSSE({
      eventName: "user-update",
      includeMetadata: true,
      heartbeatInterval: 0, // Disable for testing
    });

    assertExists(sseResponse);
    assertEquals(sseResponse.headers.get("Content-Type"), "text/event-stream");
    assertEquals(sseResponse.headers.get("Cache-Control"), "no-cache");

    // Clean up
    const reader = sseResponse.body?.getReader();
    if (reader) {
      reader.cancel();
      reader.releaseLock();
    }
    watchResult.stop();
  } finally {
    await kv.close();
  }
});

Deno.test("Model watch - WebSocket integration", async () => {
  const kv = await Deno.openKv(":memory:");

  try {
    const kvmInstance = new (await import("./kvm.ts")).KVM(kv);

    const User = kvmInstance.model("users", {
      schema: userSchema,
      primaryKey: [{ name: "users", key: "id" }],
    });

    // Create a user
    await User.create({
      id: "user11",
      name: "Ivy",
      email: "ivy@example.com",
      age: 26,
    });

    // Test WebSocket handler creation
    const watchResult = await User.watch("user11");
    const wsHandler = watchResult.toWebSocket({
      messageType: "user-change",
      enablePing: false,
    });

    assertExists(wsHandler);
    assertEquals(typeof wsHandler, "function");

    watchResult.stop();
  } finally {
    await kv.close();
  }
});

Deno.test("Model watch - callback management", async () => {
  const kv = await Deno.openKv(":memory:");

  try {
    const kvmInstance = new (await import("./kvm.ts")).KVM(kv);

    const User = kvmInstance.model("users", {
      schema: userSchema,
      primaryKey: [{ name: "users", key: "id" }],
    });

    // Create a user
    await User.create({
      id: "user12",
      name: "Jack",
      email: "jack@example.com",
      age: 29,
    });

    const watchResult = await User.watch("user12");

    let callback1Called = false;
    let callback2Called = false;

    // Register multiple callbacks
    const unsubscribe1 = watchResult.on((event: any) => {
      callback1Called = true;
    });

    const unsubscribe2 = watchResult.on((event: any) => {
      callback2Called = true;
    });

    // Give time for initial events
    await new Promise((resolve) => setTimeout(resolve, 50));

    assertEquals(callback1Called, true);
    assertEquals(callback2Called, true);

    // Test unsubscribing
    unsubscribe1();

    // Reset flags
    callback1Called = false;
    callback2Called = false;

    // Trigger another event
    await User.findByIdOrThrow("user12").then((u) =>
      u.update({ name: "Jack Updated" })
    );

    await new Promise((resolve) => setTimeout(resolve, 50));

    // Only callback2 should have been called
    assertEquals(callback1Called, false);
    assertEquals(callback2Called, true);

    unsubscribe2();
    watchResult.stop();
  } finally {
    await kv.close();
  }
});

Deno.test("Model watch - complex data transformations", async () => {
  const kv = await Deno.openKv(":memory:");

  try {
    const kvmInstance = new (await import("./kvm.ts")).KVM(kv);

    const User = kvmInstance.model("users", {
      schema: userSchema,
      primaryKey: [{ name: "users", key: "id" }],
    });

    // Create user with complex data
    const user = await User.create({
      id: "user13",
      name: "Kate",
      email: "kate@example.com",
      age: 24,
      status: "pending",
    });

    const watchResult = await User.watch("user13");
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

    // Give time for initial event
    await new Promise((resolve) => setTimeout(resolve, 50));

    // Update with complex changes
    await user.update({
      name: "Katherine",
      status: "active",
      age: 25,
    });

    await readPromise;
    watchResult.stop();

    // Verify transformation
    assertEquals(events.length >= 1, true);

    const initialEvent = events[0];
    assertEquals(initialEvent.type, WatchEventType.INITIAL);
    assertEquals(initialEvent.value.id, "user13");
    assertEquals(initialEvent.value.name, "Kate");
    assertEquals(initialEvent.value.status, "pending");

    // Verify the transformed value is a proper model instance
    assertExists(initialEvent.value.save);
    assertExists(initialEvent.value.delete);
    assertExists(initialEvent.value.update);
    assertExists(initialEvent.value.reload);

    // Test that we can call model methods on the watched value
    assertEquals(typeof initialEvent.value._getPrimaryKeyValue, "function");
  } finally {
    await kv.close();
  }
});
