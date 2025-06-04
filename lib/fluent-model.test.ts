import { assertEquals, assertExists, assert } from "jsr:@std/assert";
import { z } from "zod";
import { FluentKVM } from "./fluent-model.ts";

Deno.test("Fluent Model - Basic string field", async () => {
  const kv = await Deno.openKv(":memory:");
  const kvm = new FluentKVM(kv);

  const User = kvm.defineModel("users");
  User.string("id").primaryKey();
  User.string("name").required();
  User.string("email").email().lowercase();
  const UserModel = User.build(kv);

  // Test creation
  const user = await UserModel.create({
    id: "user1",
    name: "John Doe",
    email: "JOHN@EXAMPLE.COM", // Should be converted to lowercase
  });

  assertEquals(user.id, "user1");
  assertEquals(user.name, "John Doe");
  assertEquals(user.email, "john@example.com"); // Lowercase transformation

  // Test retrieval
  const foundUser = await UserModel.findById("user1");
  assertExists(foundUser);
  assertEquals(foundUser.name, "John Doe");
  assertEquals(foundUser.email, "john@example.com");

  kv.close();
});

Deno.test("Fluent Model - Number field with validation", async () => {
  const kv = await Deno.openKv(":memory:");
  const kvm = new FluentKVM(kv);

  const Product = kvm.defineModel("products")
    .string("id").primaryKey()
    .string("name").required()
    .number("price").min(0).required()
    .number("stock").min(0).default(0)
    .build(kv);

  // Test with valid data
  const product = await Product.create({
    id: "prod1",
    name: "Widget",
    price: 19.99,
  });

  assertEquals(product.id, "prod1");
  assertEquals(product.name, "Widget");
  assertEquals(product.price, 19.99);
  assertEquals(product.stock, 0); // Default value

  kv.close();
});

Deno.test("Fluent Model - Enum field", async () => {
  const kv = await Deno.openKv(":memory:");
  const kvm = new FluentKVM(kv);

  const Task = kvm.defineModel("tasks")
    .string("id").primaryKey()
    .string("title").required()
    .enum("status", ["pending", "in_progress", "completed"]).default("pending")
    .build(kv);

  // Test creation with default
  const task1 = await Task.create({
    id: "task1",
    title: "Complete project",
  });

  assertEquals(task1.status, "pending"); // Default value

  // Test creation with explicit value
  const task2 = await Task.create({
    id: "task2",
    title: "Review code",
    status: "in_progress",
  });

  assertEquals(task2.status, "in_progress");

  kv.close();
});

Deno.test("Fluent Model - Timestamps feature", async () => {
  const kv = await Deno.openKv(":memory:");
  const kvm = new FluentKVM(kv);

  const Post = kvm.defineModel("posts")
    .string("id").primaryKey()
    .string("title").required()
    .string("content").required()
    .timestamps() // Adds createdAt and updatedAt
    .build(kv);

  const startTime = new Date();

  const post = await Post.create({
    id: "post1",
    title: "Hello World",
    content: "This is my first post",
  });

  // Check that timestamps were added (stored as ISO strings)
  assertExists(post.createdAt);
  assertExists(post.updatedAt);
  assert(typeof post.createdAt === "string");
  assert(typeof post.updatedAt === "string");
  assert(new Date(post.createdAt).getTime() >= startTime.getTime());
  assert(new Date(post.updatedAt).getTime() >= startTime.getTime());

  kv.close();
});

Deno.test("Fluent Model - Secondary indexes", async () => {
  const kv = await Deno.openKv(":memory:");
  const kvm = new FluentKVM(kv);

  const User = kvm.defineModel("users")
    .string("id").primaryKey()
    .string("email").email().addIndex() // Secondary index
    .string("username").addIndex() // Another secondary index
    .string("name").required()
    .build(kv);

  const user = await User.create({
    id: "user1",
    email: "john@example.com",
    username: "johndoe",
    name: "John Doe",
  });

  // Test finding by secondary index (email)
  const foundByEmail = await User.findUnique("john@example.com", "users_by_email");
  assertExists(foundByEmail);
  assertEquals(foundByEmail.id, "user1");

  // Test finding by secondary index (username)
  const foundByUsername = await User.findUnique("johndoe", "users_by_username");
  assertExists(foundByUsername);
  assertEquals(foundByUsername.id, "user1");

  kv.close();
});

Deno.test("Fluent Model - ULID generation", async () => {
  const kv = await Deno.openKv(":memory:");
  const kvm = new FluentKVM(kv);

  const Document = kvm.defineModel("documents")
    .string("id").primaryKey().ulid() // Auto-generate ULID
    .string("title").required()
    .build(kv);

  const doc = await Document.create({
    title: "My Document",
    // id will be auto-generated as ULID
  });

  // Check that ID was generated
  assertExists(doc.id);
  assert(typeof doc.id === "string");
  assert(doc.id.length > 0);
  assertEquals(doc.title, "My Document");

  // ULIDs should be sortable by time
  // Add small delay to ensure different timestamp
  await new Promise(resolve => setTimeout(resolve, 2));
  const doc2 = await Document.create({
    title: "Second Document",
  });

  // Second document ID should be lexicographically greater (created later)
  assert(doc2.id > doc.id);

  kv.close();
});

Deno.test("Fluent Model - Array fields", async () => {
  const kv = await Deno.openKv(":memory:");
  const kvm = new FluentKVM(kv);

  const Article = kvm.defineModel("articles")
    .string("id").primaryKey()
    .string("title").required()
    .array("tags", z.string()).default([])
    .array("categories", z.string()).optional()
    .build(kv);

  const article = await Article.create({
    id: "article1",
    title: "Tech Article",
    tags: ["tech", "programming", "deno"],
  });

  assertEquals(article.tags, ["tech", "programming", "deno"]);
  assertEquals(article.categories, undefined); // Optional field

  kv.close();
});

Deno.test("Fluent Model - Object fields", async () => {
  const kv = await Deno.openKv(":memory:");
  const kvm = new FluentKVM(kv);

  const User = kvm.defineModel("users")
    .string("id").primaryKey()
    .string("name").required()
    .object("address", {
      street: z.string(),
      city: z.string(),
      zipCode: z.string(),
    }).optional()
    .build(kv);

  const user = await User.create({
    id: "user1",
    name: "John Doe",
    address: {
      street: "123 Main St",
      city: "Anytown",
      zipCode: "12345",
    },
  });

  assertEquals(user.address?.street, "123 Main St");
  assertEquals(user.address?.city, "Anytown");
  assertEquals(user.address?.zipCode, "12345");

  kv.close();
});

Deno.test("Fluent Model - Relations (hasMany)", async () => {
  const kv = await Deno.openKv(":memory:");
  const kvm = new FluentKVM(kv);

  const User = kvm.defineModel("users")
    .string("id").primaryKey()
    .string("name").required()
    .hasMany("posts", { foreignKey: "authorId" })
    .build(kv);

  const Post = kvm.defineModel("posts")
    .string("id").primaryKey()
    .string("title").required()
    .string("authorId").required()
    .belongsTo("users", { foreignKey: "authorId" })
    .build(kv);

  // Create user and posts
  const user = await User.create({
    id: "user1",
    name: "John Doe",
  });

  const post1 = await Post.create({
    id: "post1",
    title: "First Post",
    authorId: "user1",
  });

  const post2 = await Post.create({
    id: "post2",
    title: "Second Post",
    authorId: "user1",
  });

  // Test that the models were created successfully
  assertEquals(user.name, "John Doe");
  assertEquals(post1.authorId, "user1");
  assertEquals(post2.authorId, "user1");

  kv.close();
});

Deno.test("Fluent Model - Default ID generation", async () => {
  const kv = await Deno.openKv(":memory:");
  const kvm = new FluentKVM(kv);

  // No explicit primary key - should auto-add id field
  const Comment = kvm.defineModel("comments")
    .string("text").required()
    .string("authorId").required()
    .build(kv);

  const comment = await Comment.create({
    text: "Great post!",
    authorId: "user1",
  });

  // Should have auto-generated UUID id
  assertExists(comment.id);
  assert(typeof comment.id === "string");
  assert(comment.id.length > 0);
  assertEquals(comment.text, "Great post!");

  kv.close();
});

Deno.test("Fluent Model - Validation constraints", async () => {
  const kv = await Deno.openKv(":memory:");
  const kvm = new FluentKVM(kv);

  const User = kvm.defineModel("users")
    .string("id").primaryKey()
    .string("username").min(3).max(20).required()
    .string("email").email().required()
    .number("age").min(0).max(150).optional()
    .build(kv);

  // Test valid data
  const user = await User.create({
    id: "user1",
    username: "johndoe",
    email: "john@example.com",
    age: 25,
  });

  assertEquals(user.username, "johndoe");
  assertEquals(user.email, "john@example.com");
  assertEquals(user.age, 25);

  kv.close();
});

Deno.test("Fluent Model - Boolean and Date fields", async () => {
  const kv = await Deno.openKv(":memory:");
  const kvm = new FluentKVM(kv);

  const Event = kvm.defineModel("events")
    .string("id").primaryKey()
    .string("name").required()
    .date("startDate").required()
    .date("endDate").optional()
    .boolean("isPublic").default(true)
    .boolean("isActive").default(false)
    .build(kv);

  const startDate = new Date("2024-06-01");
  const event = await Event.create({
    id: "event1",
    name: "Conference 2024",
    startDate,
  });

  assertEquals(event.name, "Conference 2024");
  // Date is stored as ISO string
  assertEquals(new Date(event.startDate).getTime(), startDate.getTime());
  assertEquals(event.endDate, undefined); // Optional
  assertEquals(event.isPublic, true); // Default
  assertEquals(event.isActive, false); // Default

  kv.close();
});