# KVM Validation Enhancements

This document outlines potential enhancements to the current Zod validation
system in KVM. The existing validation is solid and working well, but these
improvements would add even more robustness and developer experience benefits.

## Current State (✅ Working Well)

- ✅ **Create Validation**: Full schema validation on all create operations
- ✅ **Update Validation**: Validates merged data after partial updates
- ✅ **Error Conversion**: Sophisticated Zod → KVMValidationError conversion
- ✅ **Type Inference**: Full TypeScript types from Zod schemas
- ✅ **Strict Mode**: Prevents extra properties from being saved
- ✅ **Format Validation**: Email, positive numbers, string lengths, etc.

## Enhancement 1: Optional Read Validation

### Problem

Data corruption or schema drift could go undetected if existing data doesn't
match current schemas.

### Proposed Solution

Add optional validation when reading data from the database.

```typescript
// Model configuration with read validation
const User = kvm.model("users", {
  schema: userSchema,
  primaryKey: [{ name: "users", key: "id" }],
  options: {
    validateOnRead: true, // Default: false for performance
    readValidationStrategy: "strict" | "warn" | "migrate",
  },
});

// Or per-operation basis
const user = await User.findById("user1", {
  validateRead: true,
  onValidationError: "warn" | "throw" | "fix",
});
```

### Implementation Ideas

**1. Configuration Options**

```typescript
interface ModelOptions {
  validateOnRead?: boolean;
  readValidationStrategy?: "strict" | "warn" | "migrate";
  onReadValidationError?: (error: ZodError, data: any) => any;
}
```

**2. Validation Strategies**

- **Strict**: Throw error if data doesn't match schema
- **Warn**: Log warning but return data anyway
- **Migrate**: Attempt to fix/transform data to match schema

**3. Performance Considerations**

- Off by default to maintain performance
- Batch validation for `findMany` operations
- Caching validation results for repeated reads

### Benefits

- **Data Integrity**: Detect corrupted or outdated data
- **Schema Evolution**: Identify data that needs migration
- **Debugging**: Easier to track down data inconsistencies
- **Confidence**: Higher confidence in data quality

## Enhancement 2: Schema Versioning & Migration

### Problem

No built-in way to handle schema evolution when business requirements change.

### Proposed Solution

Add schema versioning with automatic migration support.

```typescript
// Schema with version
const userSchemaV1 = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string().email(),
});

const userSchemaV2 = z.object({
  id: z.string(),
  firstName: z.string(), // Split name into firstName/lastName
  lastName: z.string(),
  email: z.string().email(),
  createdAt: z.date().default(() => new Date()), // New required field
});

// Model with migration support
const User = kvm.model("users", {
  schema: userSchemaV2,
  version: 2,
  migrations: {
    1: {
      up: (data: any) => ({
        ...data,
        firstName: data.name?.split(" ")[0] || "",
        lastName: data.name?.split(" ").slice(1).join(" ") || "",
        createdAt: new Date("2024-01-01"), // Default for existing records
      }),
      down: (data: any) => ({
        id: data.id,
        name: `${data.firstName} ${data.lastName}`,
        email: data.email,
      }),
    },
  },
  primaryKey: [{ name: "users", key: "id" }],
});

// Automatic migration on read
const user = await User.findById("user1"); // Automatically migrates old data

// Manual migration
await User.migrateData(); // Migrate all existing records
```

### Implementation Ideas

**1. Version Metadata**

```typescript
// Store version with each record
const versionedData = {
  _version: 2,
  _data: { id: "user1", firstName: "John", lastName: "Doe", email: "..." },
};
```

**2. Migration Functions**

```typescript
interface Migration {
  up: (data: any) => any; // Migrate to newer version
  down: (data: any) => any; // Rollback to older version
  validate?: (data: any) => boolean; // Check if migration needed
}
```

**3. Migration Strategies**

- **Lazy**: Migrate on read (default)
- **Eager**: Migrate all data immediately
- **Background**: Migrate data in batches over time

### Benefits

- **Schema Evolution**: Safely evolve schemas over time
- **Backward Compatibility**: Handle old data gracefully
- **Data Migration**: Built-in tooling for data transformations
- **Rollback Support**: Ability to downgrade if needed

## Enhancement 3: Batch Validation Optimization

### Problem

Current validation validates each item individually in batch operations, which
could be inefficient.

### Proposed Solution

Optimize validation for batch operations with smart batching and error
aggregation.

```typescript
// Optimized batch operations
const users = await User.createMany([
  { id: "user1", name: "John", email: "john@example.com" },
  { id: "user2", name: "Jane", email: "jane@example.com" },
  { id: "user3", name: "Bob", email: "invalid-email" }, // Will fail
], {
  validateBatch: true, // Validate all at once
  continueOnError: false, // Stop on first error vs collect all
  returnPartialResults: true, // Return successful items even if some fail
});

// Advanced batch validation
const result = await User.validateMany([
  { id: "user1", name: "John", email: "john@example.com" },
  { id: "user2", name: "Jane", email: "invalid" },
  { id: "user3", name: "Bob", age: -5 },
]);

// Returns validation results
console.log(result);
/*
{
  valid: [{ id: "user1", ... }],
  invalid: [
    { data: { id: "user2", ... }, errors: [{ field: "email", message: "..." }] },
    { data: { id: "user3", ... }, errors: [{ field: "age", message: "..." }] }
  ],
  stats: { total: 3, valid: 1, invalid: 2 }
}
*/
```

### Implementation Ideas

**1. Batch Validation API**

```typescript
interface BatchValidationOptions {
  validateBatch?: boolean;
  continueOnError?: boolean;
  returnPartialResults?: boolean;
  maxBatchSize?: number;
}

interface BatchValidationResult<T> {
  valid: T[];
  invalid: Array<{ data: any; errors: ValidationError[] }>;
  stats: { total: number; valid: number; invalid: number };
}
```

**2. Performance Optimizations**

- Parallel validation for independent items
- Schema compilation caching
- Early termination strategies
- Memory-efficient streaming for large batches

**3. Error Aggregation**

```typescript
class BatchValidationError extends KVMError {
  constructor(
    public results: BatchValidationResult<any>,
    public partialSuccess: boolean,
  ) {
    super(
      `Batch validation failed: ${results.invalid.length} of ${results.stats.total} items invalid`,
    );
  }
}
```

### Benefits

- **Performance**: Faster validation for large datasets
- **Better UX**: Collect all errors instead of failing on first
- **Flexibility**: Options for different error handling strategies
- **Scalability**: Handle large imports/updates efficiently

## Enhancement 4: Advanced Validation Features

### Custom Validation Hooks

```typescript
const User = kvm.model("users", {
  schema: userSchema,
  validation: {
    // Sync custom validation
    custom: [
      (data) => {
        if (data.age < 13 && !data.parentEmail) {
          throw new Error("Users under 13 must provide parent email");
        }
      },
    ],

    // Async validation (e.g., uniqueness checks)
    async: [
      async (data) => {
        const existing = await User.findUnique(data.email, "users_by_email");
        if (existing) {
          throw new Error("Email already exists");
        }
      },
    ],
  },
  primaryKey: [{ name: "users", key: "id" }],
});
```

### Conditional Validation

```typescript
const orderSchema = z.object({
  id: z.string(),
  type: z.enum(["pickup", "delivery"]),
  address: z.string().optional(),
  customerPhone: z.string().optional(),
}).refine((data) => {
  // Delivery orders must have address
  if (data.type === "delivery" && !data.address) {
    return false;
  }
  // Pickup orders must have phone
  if (data.type === "pickup" && !data.customerPhone) {
    return false;
  }
  return true;
}, {
  message: "Address required for delivery, phone required for pickup",
});
```

### Validation Middleware

```typescript
// Global validation middleware
kvm.addValidationMiddleware("beforeCreate", async (data, modelName) => {
  // Add audit fields
  data.createdAt = new Date();
  data.createdBy = getCurrentUser();
  return data;
});

// Model-specific middleware
User.addValidationMiddleware("beforeUpdate", async (data, existing) => {
  // Check permissions
  if (data.role && !canChangeRole(getCurrentUser(), existing.role, data.role)) {
    throw new Error("Insufficient permissions to change role");
  }
  return data;
});
```

## Implementation Priority

### High Priority (Quick Wins)

1. **Batch Validation Optimization** - Relatively simple, immediate performance
   benefits
2. **Read Validation (Optional)** - Good for debugging and data integrity

### Medium Priority (Significant Features)

3. **Custom Validation Hooks** - Adds flexibility for business logic
4. **Validation Middleware** - Enables cross-cutting concerns

### Low Priority (Complex Features)

5. **Schema Versioning & Migration** - Complex but very valuable for long-term
   projects

## Breaking Changes Consideration

All enhancements should be:

- **Opt-in by default** to maintain backward compatibility
- **Performance neutral** when not enabled
- **Well documented** with migration guides
- **Tested thoroughly** with existing functionality

## Related Issues/Features

These enhancements would work well with other planned features:

- **Enhanced Relations**: Validation across related models
- **Middleware/Hooks**: Integration with validation pipeline
- **Batch Operations**: Optimized validation for bulk operations

---

_Note: The current Zod validation system is working well and provides
significant value. These enhancements are improvements, not fixes to problems._
