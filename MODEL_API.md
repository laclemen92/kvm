# KVM Model-Based API Guide

The new Model-Based API provides an intuitive, object-oriented interface for
working with Deno KV, similar to popular ORMs like Mongoose and Dynamoose.

## Quick Start

```typescript
import { createKVM } from "@laclemen92/kvm";
import { z } from "zod";

// Create KVM instance
const kvm = await createKVM(); // or createKVM(":memory:") for testing

// Define a model
const User = kvm.model("users", {
  schema: z.object({
    id: z.string(),
    name: z.string(),
    email: z.string().email(),
    age: z.number(),
  }),
  primaryKey: [{ name: "users", key: "id" }],
  secondaryIndexes: [{
    name: "users_by_email",
    key: [{ name: "users_by_email", key: "email" }],
    valueType: ValueType.KEY,
    valueKey: "id",
  }],
});

// Create documents
const user = await User.create({
  id: "user1",
  name: "John Doe",
  email: "john@example.com",
  age: 30,
});

// Work with the document
user.age = 31;
await user.save();

// Query documents
const foundUser = await User.findById("user1");
const userByEmail = await User.findUnique("john@example.com", "users_by_email");
const allUsers = await User.findMany();

// Delete documents
await user.delete();

// Close connection
await kvm.close();
```

## API Reference

### KVM Class

#### `createKVM(path?: string): Promise<KVM>`

Creates a new KVM instance with a Deno KV connection.

```typescript
const kvm = await createKVM(); // Default path
const testKvm = await createKVM(":memory:"); // In-memory for testing
```

#### `kvm.model(name: string, definition: ModelDefinition): ModelConstructor`

Defines and registers a new model.

```typescript
const User = kvm.model('users', {
  schema: userSchema,
  primaryKey: [{ name: "users", key: "id" }],
  secondaryIndexes: [...],
  relations: [...],
});
```

#### Model Management

- `kvm.getModel(name: string)` - Get existing model
- `kvm.hasModel(name: string)` - Check if model exists
- `kvm.getModelNames()` - List all model names
- `kvm.removeModel(name: string)` - Remove model (testing)
- `kvm.clearModels()` - Clear all models (testing)

### Model Static Methods

#### Creation

```typescript
// Create single document
const user = await User.create({
  id: "user1",
  name: "John",
  email: "john@example.com",
  age: 30,
});
```

#### Finding Documents

```typescript
// Find by primary key
const user = await User.findById("user1");
const user = await User.findByIdOrThrow("user1"); // Throws if not found

// Find by secondary index or custom key
const user = await User.findUnique("john@example.com", "users_by_email");
const user = await User.findUniqueOrThrow("key", "index"); // Throws if not found

// Find multiple
const users = await User.findMany(); // All users
const users = await User.findMany({ limit: 10 }); // With options

// Find first
const user = await User.findFirst();
const user = await User.findFirstOrThrow(); // Throws if none found
```

#### Batch Operations

```typescript
// Update multiple
const updated = await User.updateMany([
  { key: "user1", data: { age: 31 } },
  { key: "user2", data: { age: 32 } },
]);

// Delete multiple
const deleted = await User.deleteMany([
  { key: "user1" },
  { key: "user2", options: { cascadeDelete: true } },
]);
```

### Model Instance Methods

#### Document Manipulation

```typescript
// Update and save
user.age = 31;
user.name = "John Updated";
await user.save();

// Update with data object
await user.update({ age: 32, name: "John Again" });

// Reload from database
await user.reload();

// Delete document
await user.delete();
await user.delete({ cascadeDelete: true });
```

### Model Definition

```typescript
interface ModelDefinition {
  schema: ZodObject<any>; // Zod schema for validation
  primaryKey: Key; // Primary key definition
  secondaryIndexes?: SecondaryIndex[]; // Optional secondary indexes
  relations?: Relation[]; // Optional relations
}
```

## Examples

### Basic User Model

```typescript
const userSchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string().email(),
  createdAt: z.date().default(() => new Date()),
});

const User = kvm.model("users", {
  schema: userSchema,
  primaryKey: [{ name: "users", key: "id" }],
  secondaryIndexes: [{
    name: "users_by_email",
    key: [{ name: "users_by_email", key: "email" }],
    valueType: ValueType.KEY,
    valueKey: "id",
  }],
});
```

### E-commerce Product Model

```typescript
const productSchema = z.object({
  id: z.string(),
  name: z.string(),
  price: z.number(),
  category: z.string(),
  inStock: z.boolean().default(true),
});

const Product = kvm.model("products", {
  schema: productSchema,
  primaryKey: [{ name: "products", key: "id" }],
  secondaryIndexes: [
    {
      name: "products_by_category",
      key: [{ name: "products_by_category", key: "category" }],
      valueType: ValueType.VALUE, // Store full product data
    },
    {
      name: "products_in_stock",
      key: [
        { name: "products_in_stock", key: "inStock" },
        { key: "category" },
      ],
      valueType: ValueType.KEY,
      valueKey: "id",
    },
  ],
});

// Usage
const product = await Product.create({
  id: "prod1",
  name: "iPhone 15",
  price: 999,
  category: "electronics",
});

const electronics = await Product.findUnique(
  "electronics",
  "products_by_category",
);
const inStockElectronics = await Product.findUnique(
  { inStock: true, category: "electronics" },
  "products_in_stock",
);
```

### Blog Post with Relations

```typescript
const postSchema = z.object({
  id: z.string(),
  title: z.string(),
  content: z.string(),
  authorId: z.string(),
  publishedAt: z.date().optional(),
});

const Post = kvm.model("posts", {
  schema: postSchema,
  primaryKey: [{ name: "posts", key: "id" }],
  secondaryIndexes: [{
    name: "posts_by_author",
    key: [{ name: "posts_by_author", key: "authorId" }],
    valueType: ValueType.KEY,
    valueKey: "id",
  }],
  relations: [{
    entityName: "users",
    fields: ["authorId"],
    type: "one-to-many",
    valueType: ValueType.KEY,
    valueKey: "id",
  }],
});

// Usage
const post = await Post.create({
  id: "post1",
  title: "Hello World",
  content: "This is my first post",
  authorId: "user1",
});

const authorPosts = await Post.findUnique("user1", "posts_by_author");
await post.delete({ cascadeDelete: true }); // Also deletes relations
```

## Migration from Functional API

The new Model-Based API is fully backward compatible. You can migrate gradually:

### Before (Functional API)

```typescript
import { create, deleteKey, findUnique, update } from "@laclemen92/kvm";

const kv = await Deno.openKv();
const user = await create(userEntity, kv, userData);
const found = await findUnique(userEntity, kv, "user1");
await update(userEntity, kv, "user1", updatedData);
await deleteKey(userEntity, kv, "user1");
```

### After (Model-Based API)

```typescript
import { createKVM } from "@laclemen92/kvm";

const kvm = await createKVM();
const User = kvm.model("users", userDefinition);

const user = await User.create(userData);
const found = await User.findById("user1");
user.name = "Updated";
await user.save();
await user.delete();
```

## Type Safety

The Model-Based API provides full TypeScript support:

```typescript
import type { InferModel } from "@laclemen92/kvm";

const User = kvm.model("users", {
  schema: z.object({
    id: z.string(),
    name: z.string(),
    age: z.number(),
  }),
  primaryKey: [{ name: "users", key: "id" }],
});

// Type is automatically inferred
type UserType = InferModel<typeof User>; // { id: string; name: string; age: number; }

const user = await User.create({
  id: "user1",
  name: "John",
  age: 30, // TypeScript enforces correct types
});

// user.save(), user.delete(), etc. are available and typed
```

## Error Handling

The Model-Based API provides better error messages:

```typescript
try {
  const user = await User.findByIdOrThrow("nonexistent");
} catch (error) {
  console.log(error.message); // "users with id 'nonexistent' not found"
}

try {
  await User.create(invalidData);
} catch (error) {
  console.log(error.message); // "Failed to create users"
}
```

## Testing

For testing, use in-memory KV instances:

```typescript
import { createKVM } from "@laclemen92/kvm";

describe("User model", () => {
  let kvm: KVM;
  let User: ModelConstructor;

  beforeAll(async () => {
    kvm = await createKVM(":memory:");
    User = kvm.model("users", userDefinition);
  });

  afterEach(async () => {
    // Clear data between tests
    const kvInstance = kvm.getKv();
    const allEntries = await Array.fromAsync(kvInstance.list({ prefix: [] }));
    for await (const entry of allEntries) {
      await kvInstance.delete(entry.key);
    }
  });

  afterAll(async () => {
    await kvm.close();
  });

  it("should create and find users", async () => {
    const user = await User.create({ id: "user1", name: "John" });
    const found = await User.findById("user1");
    expect(found?.name).toBe("John");
  });
});
```
