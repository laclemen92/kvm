import { assertEquals, assertExists, assert } from "jsr:@std/assert";
import { z } from "zod";
import { SimpleFluentKVM, field } from "./fluent-model-simple.ts";

Deno.test("Simple Fluent Model - Basic usage", async () => {
  const kv = await Deno.openKv(":memory:");
  const kvm = new SimpleFluentKVM(kv);

  const User = kvm.defineModel("users", {
    fields: {
      id: field.id({ uuid: true }),
      name: field.string({ required: true }),
      email: field.string({ required: true, email: true, lowercase: true }),
      age: field.number({ min: 0, max: 150 }),
    },
    indexes: ["email"],
    timestamps: true,
  });

  // Test creation
  const user = await User.create({
    name: "John Doe",
    email: "JOHN@EXAMPLE.COM", // Should be converted to lowercase
    age: 25,
  });

  assertEquals(user.name, "John Doe");
  assertEquals(user.email, "john@example.com"); // Lowercase transformation
  assertEquals(user.age, 25);
  assertExists(user.id); // Auto-generated UUID
  assertExists(user.createdAt); // Auto timestamp
  assertExists(user.updatedAt); // Auto timestamp

  // Test retrieval
  const foundUser = await User.findById(user.id);
  assertExists(foundUser);
  assertEquals(foundUser.name, "John Doe");

  kv.close();
});

Deno.test("Simple Fluent Model - ULID support", async () => {
  const kv = await Deno.openKv(":memory:");
  const kvm = new SimpleFluentKVM(kv);

  const Document = kvm.defineModel("documents", {
    fields: {
      id: field.id({ ulid: true }),
      title: field.string({ required: true }),
    },
  });

  const doc1 = await Document.create({
    title: "First Document",
  });

  const doc2 = await Document.create({
    title: "Second Document", 
  });

  // ULIDs should be sortable by time
  assert(doc2.id > doc1.id);
  assertExists(doc1.id);
  assertExists(doc2.id);

  kv.close();
});

Deno.test("Simple Fluent Model - Enums and defaults", async () => {
  const kv = await Deno.openKv(":memory:");
  const kvm = new SimpleFluentKVM(kv);

  const Task = kvm.defineModel("tasks", {
    fields: {
      id: field.id(),
      title: field.string({ required: true }),
      status: field.enum(["pending", "in_progress", "completed"], { 
        default: "pending" 
      }),
      priority: field.number({ min: 1, max: 5, default: 3 }),
      isActive: field.boolean({ default: true }),
    },
  });

  const task = await Task.create({
    title: "Complete project",
  });

  assertEquals(task.title, "Complete project");
  assertEquals(task.status, "pending"); // Default value
  assertEquals(task.priority, 3); // Default value
  assertEquals(task.isActive, true); // Default value

  kv.close();
});

Deno.test("Simple Fluent Model - Arrays and objects", async () => {
  const kv = await Deno.openKv(":memory:");
  const kvm = new SimpleFluentKVM(kv);

  const Article = kvm.defineModel("articles", {
    fields: {
      id: field.id(),
      title: field.string({ required: true }),
      tags: field.array(z.string(), { default: [] }),
      author: field.object({
        name: z.string(),
        email: z.string().email(),
      }),
    },
  });

  const article = await Article.create({
    title: "Tech Article",
    tags: ["tech", "programming"],
    author: {
      name: "John Doe",
      email: "john@example.com",
    },
  });

  assertEquals(article.title, "Tech Article");
  assertEquals(article.tags, ["tech", "programming"]);
  assertEquals(article.author.name, "John Doe");
  assertEquals(article.author.email, "john@example.com");

  kv.close();
});

Deno.test("Simple Fluent Model - Relations", async () => {
  const kv = await Deno.openKv(":memory:");
  const kvm = new SimpleFluentKVM(kv);

  const User = kvm.defineModel("users", {
    fields: {
      id: field.id(),
      name: field.string({ required: true }),
    },
    relations: {
      hasMany: {
        posts: { foreignKey: "authorId" },
      },
    },
  });

  const Post = kvm.defineModel("posts", {
    fields: {
      id: field.id(),
      title: field.string({ required: true }),
      authorId: field.string({ required: true }),
    },
    relations: {
      belongsTo: {
        users: { foreignKey: "authorId" },
      },
    },
  });

  // Test that models are created successfully
  const user = await User.create({
    name: "John Doe",
  });

  const post = await Post.create({
    title: "My First Post",
    authorId: user.id,
  });

  assertEquals(user.name, "John Doe");
  assertEquals(post.title, "My First Post");
  assertEquals(post.authorId, user.id);

  kv.close();
});

Deno.test("Simple Fluent Model - Validation constraints", async () => {
  const kv = await Deno.openKv(":memory:");
  const kvm = new SimpleFluentKVM(kv);

  const User = kvm.defineModel("users", {
    fields: {
      id: field.id(),
      username: field.string({ required: true, min: 3, max: 20 }),
      email: field.string({ required: true, email: true }),
      age: field.number({ min: 0, max: 150 }),
      website: field.string({ url: true }),
    },
  });

  const user = await User.create({
    username: "johndoe",
    email: "john@example.com",
    age: 25,
    website: "https://johndoe.com",
  });

  assertEquals(user.username, "johndoe");
  assertEquals(user.email, "john@example.com");
  assertEquals(user.age, 25);
  assertEquals(user.website, "https://johndoe.com");

  kv.close();
});

Deno.test("Simple Fluent Model - Secondary indexes", async () => {
  const kv = await Deno.openKv(":memory:");
  const kvm = new SimpleFluentKVM(kv);

  const User = kvm.defineModel("users", {
    fields: {
      id: field.id(),
      email: field.string({ required: true, email: true }),
      username: field.string({ required: true }),
      name: field.string({ required: true }),
    },
    indexes: ["email", "username"], // Secondary indexes
  });

  const user = await User.create({
    email: "john@example.com",
    username: "johndoe",
    name: "John Doe",
  });

  // Test finding by secondary index
  const foundByEmail = await User.findUnique("john@example.com", "users_by_email");
  assertExists(foundByEmail);
  assertEquals(foundByEmail.id, user.id);

  const foundByUsername = await User.findUnique("johndoe", "users_by_username");
  assertExists(foundByUsername);
  assertEquals(foundByUsername.id, user.id);

  kv.close();
});