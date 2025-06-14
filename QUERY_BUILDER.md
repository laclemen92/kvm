# KVM Query Builder Guide

The Query Builder provides a fluent, chainable API for building complex queries
with filtering, sorting, and pagination.

## Quick Start

```typescript
import { createKVM } from "@laclemen92/kvm";
import { z } from "zod";

const kvm = await createKVM();

const User = kvm.model("users", {
  schema: z.object({
    id: z.string(),
    name: z.string(),
    age: z.number(),
    status: z.string(),
    email: z.string().email(),
  }),
  primaryKey: [{ name: "users", key: "id" }],
});

// Complex query with chaining
const activeAdults = await User
  .where("age").gte(18)
  .where("status").equals("active")
  .orderBy("age", "desc")
  .limit(10)
  .find();
```

## API Reference

### Starting a Query

There are two ways to start a query:

```typescript
// Method 1: Using where() directly
const query1 = User.where("age").gte(18);

// Method 2: Using query() first
const query2 = User.query().where("age").gte(18);
```

### Where Conditions

#### Field-Specific Conditions

```typescript
// Equality
User.where("name").equals("John");
User.where("name").eq("John"); // alias

// Comparison
User.where("age").greaterThan(18);
User.where("age").gt(18); // alias
User.where("age").greaterThanOrEqual(18);
User.where("age").gte(18); // alias
User.where("age").lessThan(65);
User.where("age").lt(65); // alias
User.where("age").lessThanOrEqual(65);
User.where("age").lte(65); // alias

// Negation
User.where("status").notEquals("inactive");
User.where("status").ne("inactive"); // alias

// Array operations
User.where("status").in(["active", "pending"]);
User.where("status").notIn(["deleted", "banned"]);

// String operations
User.where("name").contains("John");
User.where("email").startsWith("admin");
User.where("email").endsWith("@company.com");

// Existence checks
User.where("deletedAt").exists();
User.where("deletedAt").notExists();

// Range operations
User.where("age").between(18, 65); // equivalent to .gte(18).lte(65)
```

#### Object-Style Conditions

```typescript
// Multiple conditions as object
const users = await User
  .where({
    status: "active",
    age: 25,
  })
  .find();
```

#### Chaining Multiple Conditions

```typescript
const users = await User
  .where("status").equals("active")
  .where("age").gte(18)
  .where("email").endsWith("@company.com")
  .find();
```

### Sorting

```typescript
// Single sort
User.query().orderBy("createdAt", "desc");
User.query().orderBy("name"); // defaults to 'asc'

// Multiple sorts (applied in order)
User.query()
  .orderBy("status", "asc")
  .orderBy("createdAt", "desc");
```

### Pagination

```typescript
// Limit results
User.query().limit(10);

// Skip results (offset)
User.query().offset(20).limit(10); // Skip first 20, take next 10

// Cursor-based pagination (KV-level optimization)
User.query().cursor("some-cursor-value");

// Reverse order (KV-level optimization)
User.query().reverse();
```

### Field Selection

```typescript
// Select specific fields (array syntax)
User.query().select(["name", "email"]);

// Select specific fields (spread syntax)
User.query().select("name", "email");
```

### Execution Methods

```typescript
// Find all matching documents
const users = await User.where("status").equals("active").find();

// Find first matching document
const user = await User.where("email").equals("john@example.com").findOne();

// Find first or throw error
const user = await User.where("id").equals("123").findOneOrThrow();

// Count matching documents
const count = await User.where("status").equals("active").count();

// Check if any documents exist
const hasActive = await User.where("status").equals("active").exists();
```

### Query Manipulation

```typescript
// Clone a query for reuse
const baseQuery = User.where("status").equals("active");
const youngUsers = baseQuery.clone().where("age").lt(30);
const oldUsers = baseQuery.clone().where("age").gte(30);

// Get query configuration
const config = User.where("age").gte(18).toConfig();
console.log(config);
// {
//   where: [{ field: 'age', operator: 'gte', value: 18 }],
//   sort: [],
//   limit: undefined,
//   offset: undefined
// }
```

## Complex Examples

### E-commerce Product Search

```typescript
const Product = kvm.model("products", {
  schema: z.object({
    id: z.string(),
    name: z.string(),
    price: z.number(),
    category: z.string(),
    inStock: z.boolean(),
    rating: z.number(),
  }),
  primaryKey: [{ name: "products", key: "id" }],
});

// Find affordable electronics in stock, sorted by rating
const products = await Product
  .where("category").equals("electronics")
  .where("price").between(100, 500)
  .where("inStock").equals(true)
  .where("rating").gte(4.0)
  .orderBy("rating", "desc")
  .orderBy("price", "asc")
  .limit(20)
  .find();
```

### User Management

```typescript
// Find users who need password reset (last login > 90 days ago)
const cutoffDate = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
const staleUsers = await User
  .where("lastLoginAt").lt(cutoffDate)
  .where("status").equals("active")
  .orderBy("lastLoginAt", "asc")
  .find();

// Find admin users by email domain
const adminUsers = await User
  .where("email").endsWith("@company.com")
  .where("role").in(["admin", "superadmin"])
  .orderBy("name")
  .find();
```

### Content Management

```typescript
const Post = kvm.model("posts", {
  schema: z.object({
    id: z.string(),
    title: z.string(),
    content: z.string(),
    authorId: z.string(),
    publishedAt: z.date().optional(),
    tags: z.array(z.string()),
    viewCount: z.number().default(0),
  }),
  primaryKey: [{ name: "posts", key: "id" }],
});

// Find popular published posts
const popularPosts = await Post
  .where("publishedAt").exists()
  .where("viewCount").gte(1000)
  .orderBy("viewCount", "desc")
  .limit(10)
  .find();

// Find draft posts by specific author
const drafts = await Post
  .where("authorId").equals("user123")
  .where("publishedAt").notExists()
  .orderBy("createdAt", "desc")
  .find();
```

## Performance Considerations

### Client-Side vs KV-Level Filtering

The Query Builder automatically optimizes queries when possible:

- **KV-Level Optimizations**: Applied when no client-side processing is needed
  - `limit()`, `cursor()`, `reverse()` are passed directly to Deno KV

- **Client-Side Processing**: Used for complex queries
  - `where()` conditions are filtered after fetching data
  - `orderBy()` sorting is applied after fetching data
  - `offset()` and pagination are applied after filtering and sorting

### Best Practices

1. **Use Secondary Indexes**: For frequently queried fields, create secondary
   indexes at the entity level for better performance.

2. **Limit Early**: Always use `.limit()` to avoid fetching unnecessary data.

3. **Order Matters**: Place most selective `where()` conditions first to reduce
   the dataset size early.

4. **Avoid Complex String Operations**: Operations like `contains()`,
   `startsWith()`, `endsWith()` require scanning all data.

```typescript
// Good: Selective first, then additional filters
User.where("status").equals("active") // Most selective
  .where("age").gte(18) // Additional filter
  .where("name").contains("John") // Least selective
  .limit(10);

// Less optimal: Broad filter first
User.where("name").contains("John") // Scans all data
  .where("status").equals("active") // Then filters
  .limit(10);
```

## Type Safety

The Query Builder provides full TypeScript support:

```typescript
const User = kvm.model("users", {
  schema: z.object({
    id: z.string(),
    name: z.string(),
    age: z.number(),
  }),
  primaryKey: [{ name: "users", key: "id" }],
});

// TypeScript knows these fields exist
User.where("name").equals("John"); // ✅ Valid
User.where("age").gte(18); // ✅ Valid
User.where("invalidField").equals(1); // ❌ TypeScript error

// Return types are properly inferred
const users: (ModelDocument<UserType> & UserType)[] = await User
  .where("age").gte(18)
  .find();
```

## Error Handling

```typescript
try {
  const user = await User
    .where("id").equals("nonexistent")
    .findOneOrThrow();
} catch (error) {
  console.log(error.message); // "users with id 'nonexistent' not found"
}

// Graceful handling with findOne
const user = await User
  .where("email").equals("maybe@exists.com")
  .findOne();

if (user) {
  console.log("Found user:", user.name);
} else {
  console.log("User not found");
}
```

## Integration with Model API

The Query Builder seamlessly integrates with the Model-based API:

```typescript
// All these return the same type: ModelDocument & T
const user1 = await User.findById("123");
const user2 = await User.where("id").equals("123").findOne();
const user3 = await User.query().where("id").equals("123").findOne();

// All support the same instance methods
await user1.save();
await user2.delete();
await user3.update({ name: "Updated" });
```
