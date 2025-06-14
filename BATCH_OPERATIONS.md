# Batch Operations

KVM provides powerful batch operation capabilities that allow you to perform
multiple create, update, or delete operations efficiently. These operations
support both atomic transactions and non-atomic processing with comprehensive
error handling.

## Overview

Batch operations are ideal for:

- Bulk data imports
- Mass updates across multiple records
- Bulk deletions with cascade support
- Performance optimization for multiple operations

## Features

- **Atomic Operations**: All operations succeed or fail together
- **Non-Atomic Operations**: Process operations individually with partial
  results
- **Validation**: Schema validation with detailed error reporting
- **Error Handling**: Continue on error with comprehensive failure tracking
- **Secondary Index Support**: Automatic handling of secondary indexes
- **Cascade Deletes**: Support for relationship-aware deletions
- **Batch Size Control**: Process large datasets in configurable chunks

## API Reference

### createMany

Create multiple documents in a single operation.

```typescript
const result = await User.createMany([
  { id: "user1", name: "John", email: "john@example.com" },
  { id: "user2", name: "Jane", email: "jane@example.com" },
  { id: "user3", name: "Bob", email: "bob@example.com" },
]);

console.log(`Created ${result.stats.created} users`);
```

#### Options

```typescript
interface BatchCreateOptions {
  atomic?: boolean; // Default: true
  continueOnError?: boolean; // Default: false
  returnPartialResults?: boolean; // Default: false
  validateBeforeWrite?: boolean; // Default: true
  batchSize?: number; // Optional chunking
  expireIn?: number; // TTL for all records
}
```

#### Result

```typescript
interface BatchCreateResult<T> {
  created: T[]; // Successfully created items
  failed: Array<{ // Failed items with error details
    data: T;
    error: Error;
    index: number;
  }>;
  stats: {
    total: number;
    created: number;
    failed: number;
  };
}
```

### updateMany

Update multiple documents with partial data.

```typescript
const result = await User.updateMany([
  { key: "user1", data: { status: "active" } },
  { key: "user2", data: { status: "inactive", lastLogin: new Date() } },
  { key: "user3", data: { name: "Robert" } },
]);
```

#### Input Format

```typescript
interface BatchUpdateInput<T> {
  key: string | Deno.KvKeyPart;
  data: Partial<T>;
  options?: UpdateOptions;
}
```

#### Options

```typescript
interface BatchUpdateOptions {
  atomic?: boolean; // Default: true
  continueOnError?: boolean; // Default: false
  returnPartialResults?: boolean; // Default: false
  batchSize?: number; // Optional chunking
  expireIn?: number; // TTL for updated records
}
```

#### Result

```typescript
interface BatchUpdateResult<T> {
  updated: T[]; // Successfully updated items
  notFound: Array<{ // Items that didn't exist
    key: string | Deno.KvKeyPart;
    index: number;
  }>;
  failed: Array<{ // Failed updates with error details
    key: string | Deno.KvKeyPart;
    data: Partial<T>;
    error: Error;
    index: number;
  }>;
  stats: {
    total: number;
    updated: number;
    notFound: number;
    failed: number;
  };
}
```

### deleteMany

Delete multiple documents by their keys.

```typescript
const result = await User.deleteMany([
  { key: "user1" },
  { key: "user2", options: { cascadeDelete: true } },
  { key: "user3" },
]);
```

#### Input Format

```typescript
interface BatchDeleteInput {
  key: string | Deno.KvKeyPart;
  options?: DeleteOptions;
}
```

#### Options

```typescript
interface BatchDeleteOptions {
  atomic?: boolean; // Default: true
  continueOnError?: boolean; // Default: false
  returnDeletedItems?: boolean; // Default: false
  cascadeDelete?: boolean; // Default: false
  batchSize?: number; // Optional chunking
}
```

#### Result

```typescript
interface BatchDeleteResult<T> {
  deleted: T[]; // Deleted items (if returnDeletedItems: true)
  deletedCount: number; // Number of successfully deleted items
  notFound: Array<{ // Items that didn't exist
    key: string | Deno.KvKeyPart;
    index: number;
  }>;
  failed: Array<{ // Failed deletions with error details
    key: string | Deno.KvKeyPart;
    error: Error;
    index: number;
  }>;
  stats: {
    total: number;
    deleted: number;
    notFound: number;
    failed: number;
  };
}
```

## Usage Examples

### Basic Batch Creation

```typescript
import { createKVM } from "@laclemen92/kvm";
import { z } from "zod";

const kvm = await createKVM();

const User = kvm.model("users", {
  schema: z.object({
    id: z.string(),
    name: z.string(),
    email: z.string().email(),
    age: z.number().positive(),
  }),
  primaryKey: [{ name: "users", key: "id" }],
});

// Create multiple users
const users = [
  { id: "user1", name: "John", email: "john@example.com", age: 25 },
  { id: "user2", name: "Jane", email: "jane@example.com", age: 30 },
  { id: "user3", name: "Bob", email: "bob@example.com", age: 35 },
];

const result = await User.createMany(users);
console.log(
  `Created ${result.stats.created} out of ${result.stats.total} users`,
);
```

### Error Handling with Partial Results

```typescript
// Continue processing even if some items fail
const result = await User.createMany(users, {
  continueOnError: true,
  returnPartialResults: true,
});

console.log(`Created: ${result.stats.created}`);
console.log(`Failed: ${result.stats.failed}`);

// Process failed items
for (const failure of result.failed) {
  console.log(`Item ${failure.index} failed:`, failure.error.message);

  if (KVMErrorUtils.isValidationError(failure.error)) {
    console.log(`Validation error in field: ${failure.error.field}`);
  }
}
```

### Non-Atomic Processing

```typescript
// Process items individually (non-atomic)
const result = await User.createMany(users, {
  atomic: false,
  continueOnError: true,
  returnPartialResults: true,
});

// Some items may succeed even if others fail
```

### Batch Updates with Query Builder Integration

```typescript
// Find users over 30 and mark them as senior
const olderUsers = await User
  .where("age")
  .gt(30)
  .find();

// Prepare batch update
const updateInputs = olderUsers.map((user) => ({
  key: user.id,
  data: { category: "senior", updatedAt: new Date() },
}));

const result = await User.updateMany(updateInputs);
console.log(`Updated ${result.stats.updated} senior users`);
```

### Cascade Deletes

```typescript
// Delete posts and their comments
const result = await Post.deleteMany([
  { key: "post1", options: { cascadeDelete: true } },
  { key: "post2", options: { cascadeDelete: true } },
], {
  returnDeletedItems: true,
});

console.log(`Deleted ${result.deletedCount} posts with cascade`);
```

### Large Dataset Processing

```typescript
// Process large datasets in chunks
const largeUserSet = /* ... thousands of users ... */;

const result = await User.createMany(largeUserSet, {
  batchSize: 100,      // Process 100 at a time
  atomic: false,       // Individual processing
  continueOnError: true,
  returnPartialResults: true,
});

console.log(`Processed ${result.stats.total} users`);
console.log(`Success rate: ${(result.stats.created / result.stats.total * 100).toFixed(1)}%`);
```

## Error Handling

Batch operations provide detailed error information:

### Validation Errors

```typescript
try {
  await User.createMany(invalidUsers);
} catch (error) {
  if (KVMErrorUtils.isBatchValidationError(error)) {
    console.log(`${error.results.stats.invalid} items failed validation`);

    for (const invalid of error.results.invalid) {
      console.log(`Item ${invalid.index}:`, invalid.errors);
    }
  }
}
```

### Operation Errors

```typescript
try {
  await User.updateMany(updates);
} catch (error) {
  if (KVMErrorUtils.isBatchOperationError(error)) {
    console.log(`Batch operation failed: ${error.operation}`);
    console.log(`Successful: ${error.successCount}`);
    console.log(`Failed: ${error.failureCount}`);

    for (const failure of error.failures) {
      console.log(`Failed item:`, failure);
    }
  }
}
```

## Best Practices

### 1. Choose the Right Mode

- **Atomic**: Use when all operations must succeed together
- **Non-Atomic**: Use for import scenarios where partial success is acceptable

### 2. Handle Large Datasets

```typescript
// For very large datasets, use chunking
const result = await User.createMany(largeDataset, {
  batchSize: 50,
  atomic: false,
  continueOnError: true,
});
```

### 3. Validate Before Processing

```typescript
// Pre-validate complex data
const result = await User.createMany(complexData, {
  validateBeforeWrite: true,
  continueOnError: true,
  returnPartialResults: true,
});
```

### 4. Monitor Performance

```typescript
const startTime = Date.now();
const result = await User.createMany(data);
const duration = Date.now() - startTime;

console.log(`Processed ${result.stats.total} items in ${duration}ms`);
console.log(
  `Rate: ${(result.stats.total / duration * 1000).toFixed(0)} items/sec`,
);
```

### 5. Use Secondary Indexes Efficiently

Batch operations automatically handle secondary indexes, but be aware of the
performance impact:

```typescript
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

// Both primary and secondary indexes are handled automatically
await User.createMany(users);
```

## Performance Considerations

- **Atomic operations**: Slower but guarantee consistency
- **Non-atomic operations**: Faster but allow partial failures
- **Batch size**: Larger batches are more efficient but use more memory
- **Validation**: Pre-validation adds overhead but provides better error
  reporting
- **Secondary indexes**: Each index doubles the write operations

## Integration with Other Features

Batch operations work seamlessly with other KVM features:

- **Query Builder**: Use queries to select items for batch updates
- **Model Validation**: Full Zod schema validation support
- **Error Handling**: Comprehensive error classification and handling
- **Secondary Indexes**: Automatic index management
- **Relations**: Support for cascade operations
