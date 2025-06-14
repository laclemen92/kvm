# KVM Enhanced Error Handling Guide

KVM provides comprehensive error handling with custom error classes that give
you precise information about what went wrong and how to handle different types
of failures.

## Overview

All KVM errors extend the base `KVMError` class and include:

- **Specific error types** for different failure scenarios
- **Rich context information** for debugging
- **Type-safe error detection** with utility functions
- **User-friendly error messages**
- **Retry logic guidance**

## Error Types

### KVMValidationError

Thrown when data validation fails during create or update operations.

```typescript
import { KVMErrorUtils, KVMValidationError } from "@laclemen92/kvm";

try {
  await User.create({
    id: "user1",
    email: "invalid-email", // Invalid email format
    age: -5, // Negative age
  });
} catch (error) {
  if (KVMErrorUtils.isValidationError(error)) {
    console.log(`Validation failed for field '${error.field}': ${error.rule}`);
    console.log(`Invalid value: ${error.value}`);
    console.log(`Model: ${error.modelName}`);
  }
}
```

**Properties:**

- `field: string` - The field that failed validation
- `value: any` - The invalid value provided
- `rule: string` - The validation rule that was violated
- `modelName?: string` - The model name (if applicable)

### KVMNotFoundError

Thrown when a required record is not found.

```typescript
import { KVMErrorUtils, KVMNotFoundError } from "@laclemen92/kvm";

try {
  const user = await User.findByIdOrThrow("nonexistent-id");
} catch (error) {
  if (KVMErrorUtils.isNotFoundError(error)) {
    console.log(`${error.modelName} not found`);
    console.log(`Search type: ${error.searchType}`); // 'id', 'unique', 'first', 'query'
    console.log(`Identifier: ${error.identifier}`);
  }
}

// Also thrown by Query Builder
try {
  const user = await User
    .where("status").equals("nonexistent")
    .findOneOrThrow();
} catch (error) {
  // KVMNotFoundError with searchType: 'query'
}
```

**Properties:**

- `modelName: string` - The model that was being searched
- `identifier: string | Record<string, any>` - The search criteria
- `searchType: 'id' | 'unique' | 'first' | 'query'` - How the search was
  performed

### KVMQueryError

Thrown when query syntax or parameters are invalid.

```typescript
import { KVMErrorUtils, KVMQueryError } from "@laclemen92/kvm";

try {
  const users = await User
    .query()
    .limit(-5) // Invalid negative limit
    .find();
} catch (error) {
  if (KVMErrorUtils.isQueryError(error)) {
    console.log(`Query error: ${error.message}`);
    console.log("Context:", error.queryContext);
  }
}
```

**Properties:**

- `queryContext?: Record<string, any>` - Additional context about the query

### KVMOperationError

Thrown when database operations fail due to system issues.

```typescript
import { KVMErrorUtils, KVMOperationError } from "@laclemen92/kvm";

try {
  await User.create(userData);
} catch (error) {
  if (KVMErrorUtils.isOperationError(error)) {
    console.log(`${error.operation} operation failed`);
    console.log(`Model: ${error.modelName}`);
    console.log(`Original error: ${error.originalError?.message}`);

    // Check if retryable
    if (KVMErrorUtils.isRetryable(error)) {
      console.log("This error can be retried");
    }
  }
}
```

**Properties:**

- `operation: 'create' | 'read' | 'update' | 'delete' | 'atomic'` - The
  operation that failed
- `modelName?: string` - The model involved
- `originalError?: Error` - The underlying error that caused the failure

### KVMConstraintError

Thrown when database constraints are violated (e.g., unique constraints).

```typescript
import { KVMConstraintError, KVMErrorUtils } from "@laclemen92/kvm";

try {
  await User.create({
    id: "user1",
    email: "duplicate@example.com", // Email already exists
  });
} catch (error) {
  if (KVMErrorUtils.isConstraintError(error)) {
    console.log(`Constraint violation: ${error.constraintType}`);
    console.log(`Field: ${error.field}`);
    console.log(`Value: ${error.value}`);
  }
}
```

**Properties:**

- `constraintType: 'unique' | 'foreign_key' | 'check' | 'not_null'` - Type of
  constraint
- `field: string` - The field that violates the constraint
- `value: any` - The violating value
- `modelName?: string` - The model involved

### KVMConnectionError

Thrown when the KV connection is unavailable or closed.

```typescript
import { KVMConnectionError, KVMErrorUtils } from "@laclemen92/kvm";

try {
  await kvm.close();
  await User.findById("user1"); // Using closed connection
} catch (error) {
  if (KVMErrorUtils.isConnectionError(error)) {
    console.log("Connection is closed or unavailable");
    // Attempt to reconnect
  }
}
```

### KVMConcurrencyError

Thrown when there are concurrency conflicts (e.g., optimistic locking failures).

```typescript
import { KVMConcurrencyError, KVMErrorUtils } from "@laclemen92/kvm";

try {
  // Simulate concurrent updates
  await Promise.all([
    user.update({ name: "Name 1" }),
    user.update({ name: "Name 2" }),
  ]);
} catch (error) {
  if (KVMErrorUtils.isConcurrencyError(error)) {
    console.log(`Concurrency conflict during ${error.operation}`);
    // Retry with exponential backoff
  }
}
```

**Properties:**

- `operation: string` - The operation that had a conflict
- `modelName?: string` - The model involved
- `identifier?: string | Record<string, any>` - The record that had the conflict

### KVMConfigurationError

Thrown when there are configuration or setup issues.

```typescript
import { KVMConfigurationError, KVMErrorUtils } from "@laclemen92/kvm";

try {
  const InvalidModel = kvm.model("invalid", {
    schema: invalidSchema, // Malformed schema
    primaryKey: [], // Empty primary key
  });
} catch (error) {
  if (KVMErrorUtils.isConfigurationError(error)) {
    console.log(`Configuration error: ${error.message}`);
    console.log(`Config path: ${error.configPath}`);
  }
}
```

**Properties:**

- `configPath?: string` - The configuration path that has the issue

## Error Utilities

### Type Guards

```typescript
import { KVMErrorUtils } from "@laclemen92/kvm";

// Check if any error is a KVM error
if (KVMErrorUtils.isKVMError(error)) {
  console.log("This is a KVM error");
  console.log("Error code:", error.code);
  console.log("Context:", error.context);
}

// Specific type guards
KVMErrorUtils.isValidationError(error);
KVMErrorUtils.isNotFoundError(error);
KVMErrorUtils.isConstraintError(error);
KVMErrorUtils.isOperationError(error);
KVMErrorUtils.isConfigurationError(error);
KVMErrorUtils.isConnectionError(error);
KVMErrorUtils.isConcurrencyError(error);
KVMErrorUtils.isQueryError(error);
```

### Error Wrapping

```typescript
import { KVMErrorUtils } from "@laclemen92/kvm";

// Wrap non-KVM errors in KVM errors
try {
  await someExternalOperation();
} catch (error) {
  throw KVMErrorUtils.wrap(error, "create", "User");
}
```

### User-Friendly Messages

```typescript
import { KVMErrorUtils } from "@laclemen92/kvm";

try {
  await User.create(invalidData);
} catch (error) {
  // Get a user-friendly message
  const message = KVMErrorUtils.getUserMessage(error);
  console.log(message); // "Invalid data provided" instead of technical details
}
```

### Retry Logic

```typescript
import { KVMErrorUtils } from "@laclemen92/kvm";

async function createUserWithRetry(userData: any, maxRetries = 3) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await User.create(userData);
    } catch (error) {
      if (KVMErrorUtils.isRetryable(error) && attempt < maxRetries) {
        const delay = Math.pow(2, attempt) * 1000; // Exponential backoff
        await new Promise((resolve) => setTimeout(resolve, delay));
        continue;
      }
      throw error; // Don't retry validation errors, etc.
    }
  }
}
```

## Handling Zod Validation Errors

KVM automatically converts Zod validation errors to `KVMValidationError`:

```typescript
import { z } from "zod";
import { KVMErrorUtils } from "@laclemen92/kvm";

const userSchema = z.object({
  email: z.string().email(),
  age: z.number().positive(),
  name: z.string().min(2),
});

const User = kvm.model("users", {
  schema: userSchema,
  primaryKey: [{ name: "users", key: "id" }],
});

try {
  await User.create({
    id: "user1",
    email: "invalid",
    age: -5,
    name: "A",
  });
} catch (error) {
  if (KVMErrorUtils.isValidationError(error)) {
    // KVMValidationError with details from the first Zod error
    console.log(error.field); // e.g., "email"
    console.log(error.rule); // e.g., "Invalid email"
    console.log(error.value); // "invalid"
  }
}
```

## Error Context and Debugging

All KVM errors include rich context for debugging:

```typescript
try {
  await someOperation();
} catch (error) {
  if (KVMErrorUtils.isKVMError(error)) {
    // Serialize error for logging
    const errorDetails = error.toJSON();
    console.log(JSON.stringify(errorDetails, null, 2));

    // Access context
    console.log("Error context:", error.context);

    // Get stack trace
    console.log("Stack trace:", error.stack);
  }
}
```

## Best Practices

### 1. Use Type Guards

Always use the utility functions to check error types:

```typescript
// ✅ Good
if (KVMErrorUtils.isValidationError(error)) {
  handleValidationError(error);
}

// ❌ Avoid
if (error instanceof KVMValidationError) {
  // Less reliable due to potential bundling issues
}
```

### 2. Handle Different Error Types

```typescript
async function handleUserCreation(userData: any) {
  try {
    return await User.create(userData);
  } catch (error) {
    if (KVMErrorUtils.isValidationError(error)) {
      // Show user-friendly validation messages
      return { error: `Invalid ${error.field}: ${error.rule}` };
    }

    if (KVMErrorUtils.isConstraintError(error)) {
      // Handle unique constraint violations
      return { error: `${error.field} already exists` };
    }

    if (KVMErrorUtils.isRetryable(error)) {
      // Retry transient errors
      return await retryOperation(() => User.create(userData));
    }

    // Log unexpected errors
    console.error("Unexpected error:", error);
    return { error: "An unexpected error occurred" };
  }
}
```

### 3. Centralized Error Handling

```typescript
class ErrorHandler {
  static handle(error: any): { userMessage: string; shouldRetry: boolean } {
    if (KVMErrorUtils.isKVMError(error)) {
      return {
        userMessage: KVMErrorUtils.getUserMessage(error),
        shouldRetry: KVMErrorUtils.isRetryable(error),
      };
    }

    return {
      userMessage: "An unexpected error occurred",
      shouldRetry: false,
    };
  }
}
```

### 4. Structured Logging

```typescript
function logError(
  error: any,
  operation: string,
  context?: Record<string, any>,
) {
  if (KVMErrorUtils.isKVMError(error)) {
    console.error({
      type: "KVMError",
      code: error.code,
      operation,
      message: error.message,
      context: { ...error.context, ...context },
      stack: error.stack,
    });
  } else {
    console.error({
      type: "UnknownError",
      operation,
      message: error.message,
      context,
      stack: error.stack,
    });
  }
}
```

## Migration from Previous Versions

If you're upgrading from a version without enhanced error handling:

### Before

```typescript
try {
  await User.findByIdOrThrow("nonexistent");
} catch (error) {
  if (error.message.includes("not found")) {
    // Handle not found
  }
}
```

### After

```typescript
try {
  await User.findByIdOrThrow("nonexistent");
} catch (error) {
  if (KVMErrorUtils.isNotFoundError(error)) {
    // Type-safe error handling
    console.log(`${error.modelName} not found: ${error.identifier}`);
  }
}
```

The new error handling system provides much more reliable and maintainable error
handling while preserving backward compatibility for basic error catching.
