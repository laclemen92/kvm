# Middleware/Hooks System

KVM provides a powerful middleware and hooks system that allows you to execute
custom code before and after various operations. This enables you to implement
features like automatic timestamps, data validation, audit trails, and custom
business logic.

## Overview

The middleware/hooks system provides:

- **Pre-hooks**: Execute before operations (can modify data or abort operations)
- **Post-hooks**: Execute after operations (useful for logging, notifications,
  cleanup)
- **Built-in plugins**: Ready-to-use functionality for common patterns
- **Custom plugins**: Create reusable middleware packages
- **Lifecycle events**: Hook into create, update, delete, save, find, and
  validate operations
- **Error handling**: Graceful handling of hook failures with detailed error
  reporting

## Lifecycle Events

The following hook types are available:

- `validate` - Before validation (allows custom validation rules)
- `create` - Before/after document creation
- `update` - Before/after document update
- `save` - Before/after save (covers both create and update)
- `delete` - Before/after document deletion
- `find` - Before/after find operations
- `findOne` - Before/after single document find
- `init` - After document initialization

## Basic Usage

### Registering Hooks

```typescript
import { createKVM } from "@laclemen92/kvm";
import { z } from "zod";

const kvm = await createKVM();

const User = kvm.model("users", {
  schema: z.object({
    id: z.string(),
    name: z.string(),
    email: z.string().email(),
    createdAt: z.date().optional(),
    updatedAt: z.date().optional(),
  }),
  primaryKey: [{ name: "users", key: "id" }],
});

// Pre-hook - executes before create operation
User.pre("create", function (context, next) {
  console.log("About to create user:", context.input);

  // Add timestamp
  if (context.input) {
    context.input.createdAt = new Date();
  }

  next(); // Continue to next hook/operation
});

// Post-hook - executes after create operation
User.post("create", function (context, result) {
  console.log("User created successfully:", result);

  // Send welcome email, log to audit trail, etc.
});
```

### Hook Context

Every hook receives a context object with information about the operation:

```typescript
interface HookContext<T> {
  modelName: string; // Name of the model
  operation: HookType; // Type of operation
  document?: ModelDocument<T>; // Current document (for updates/deletes)
  input?: Partial<T>; // Input data (for creates/updates)
  conditions?: Record<string, any>; // Query conditions (for finds)
  options?: Record<string, any>; // Operation options
  isTransaction?: boolean; // Whether running in transaction
}
```

### Pre-Hook Function Signature

Pre-hooks can modify data and control operation flow:

```typescript
function preHook(context: HookContext<T>, next: (error?: Error) => void): void {
  // Modify context.input or this document
  // Call next() to continue, or next(error) to abort
}
```

### Post-Hook Function Signature

Post-hooks receive the operation result and cannot modify the flow:

```typescript
function postHook(context: HookContext<T>, result: any): void {
  // Access the result of the operation
  // Perform side effects like logging, notifications, etc.
}
```

## Built-in Plugins

### Timestamps Plugin

Automatically adds `createdAt` and `updatedAt` fields:

```typescript
import { timestampsPlugin } from "@laclemen92/kvm";

// Apply timestamps plugin
User.use(timestampsPlugin());

// Or customize field names
User.use(timestampsPlugin({
  createdAt: "dateCreated",
  updatedAt: "dateModified",
}));

const user = await User.create({
  id: "user1",
  name: "John Doe",
  email: "john@example.com",
});

console.log(user.createdAt); // Current timestamp
console.log(user.updatedAt); // Current timestamp

await user.update({ name: "Jane Doe" });
console.log(user.updatedAt); // Updated timestamp
```

### Validation Plugin

Add custom validation rules beyond schema validation:

```typescript
import { validationPlugin } from "@laclemen92/kvm";

User.use(validationPlugin({
  rules: {
    age: (value) => value >= 18, // Must be 18 or older
    name: (value) => value.length >= 2, // Name must be at least 2 chars
    email: async (value) => { // Async validation
      const exists = await User.findUnique(value, "users_by_email");
      return !exists; // Email must be unique
    },
  },
  stopOnFirstError: true, // Stop on first validation failure
}));

// This will fail validation
try {
  await User.create({
    id: "user1",
    name: "J",
    email: "john@example.com",
    age: 16,
  });
} catch (error) {
  console.log(error.message); // "Validation failed for field 'age'"
}
```

### Audit Plugin

Track who created and updated records:

```typescript
import { auditPlugin } from "@laclemen92/kvm";

User.use(auditPlugin({
  getCurrentUser: () => getCurrentUserFromSession(), // Your user function
  createdBy: "createdBy",
  updatedBy: "updatedBy",
}));

const user = await User.create({
  id: "user1",
  name: "John Doe",
  email: "john@example.com",
});

console.log(user.createdBy); // Current user ID

await user.update({ name: "Jane Doe" });
console.log(user.updatedBy); // Current user ID
```

## Advanced Usage

### Custom Validation Hook

```typescript
User.pre("validate", function (context, next) {
  const data = context.input || this;

  // Custom business logic validation
  if (data.email && data.email.endsWith("@competitor.com")) {
    return next(new Error("Competitor emails not allowed"));
  }

  // Password strength validation
  if (data.password && data.password.length < 8) {
    return next(new Error("Password must be at least 8 characters"));
  }

  next();
});
```

### Automatic Slug Generation

```typescript
User.pre("create", function (context, next) {
  if (context.input?.name && !context.input.slug) {
    context.input.slug = context.input.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");
  }
  next();
});
```

### Soft Deletes

```typescript
User.pre("delete", function (context, next) {
  // Instead of actually deleting, mark as deleted
  this.deletedAt = new Date();
  this.deleted = true;

  // Save the document instead of deleting
  this.save().then(() => next()).catch(next);
});

// Modify find operations to exclude deleted records
User.pre("find", function (context, next) {
  if (!context.conditions) {
    context.conditions = {};
  }
  context.conditions.deleted = { $ne: true };
  next();
});
```

### Data Encryption

```typescript
User.pre("create", function (context, next) {
  if (context.input?.sensitiveData) {
    try {
      context.input.sensitiveData = encrypt(context.input.sensitiveData);
      next();
    } catch (error) {
      next(error);
    }
  } else {
    next();
  }
});

User.post("findOne", function (context, result) {
  if (this?.sensitiveData) {
    this.sensitiveData = decrypt(this.sensitiveData);
  }
});
```

### Async Hooks with External APIs

```typescript
User.post("create", async function (context, result) {
  try {
    // Send welcome email
    await emailService.sendWelcomeEmail(this.email, this.name);

    // Create user profile in external service
    await externalAPI.createProfile({
      userId: this.id,
      email: this.email,
      name: this.name,
    });

    // Log to analytics
    await analytics.track("user_created", {
      userId: this.id,
      source: "registration",
    });
  } catch (error) {
    console.error("Post-create hook failed:", error);
    // Post-hooks don't abort operations, just log errors
  }
});
```

## Hook Options

### Priority and Ordering

```typescript
// Higher priority hooks run first
User.pre("create", function (context, next) {
  console.log("Second");
  next();
}, { priority: 0 });

User.pre("create", function (context, next) {
  console.log("First");
  next();
}, { priority: 10 });
```

### Parallel Execution

```typescript
// These hooks will run in parallel
User.post("create", async function (context, result) {
  await sendEmail(this.email);
}, { parallel: true });

User.post("create", async function (context, result) {
  await logToAnalytics(this.id);
}, { parallel: true });

User.post("create", async function (context, result) {
  await updateCache(this.id);
}, { parallel: true });
```

### Timeouts

```typescript
User.pre("create", function (context, next) {
  // This hook will timeout after 2 seconds
  setTimeout(() => {
    next();
  }, 5000); // This will timeout
}, { timeout: 2000 });
```

### Conditional Hooks

```typescript
User.pre("update", function (context, next) {
  // Only run for certain conditions
  if (context.input?.password) {
    context.input.password = hashPassword(context.input.password);
  }
  next();
}, {
  tags: ["password-hashing"],
  enabled: true,
});
```

## Creating Custom Plugins

```typescript
import type { HookManager, Plugin } from "@laclemen92/kvm";

function slugPlugin<T = any>(options: {
  sourceField?: string;
  targetField?: string;
} = {}): Plugin<T> {
  const { sourceField = "name", targetField = "slug" } = options;

  return {
    name: "slug",
    version: "1.0.0",
    install(hooks: HookManager<T>) {
      hooks.pre("create", function (context, next) {
        const data = context.input;
        if (data && data[sourceField] && !data[targetField]) {
          data[targetField] = data[sourceField]
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, "-")
            .replace(/^-|-$/g, "");
        }
        next();
      });

      hooks.pre("update", function (context, next) {
        const data = context.input;
        if (data && data[sourceField]) {
          data[targetField] = data[sourceField]
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, "-")
            .replace(/^-|-$/g, "");
        }
        next();
      });
    },

    uninstall(hooks: HookManager<T>) {
      // Clean up hooks if needed
      hooks.removeHooks("create");
      hooks.removeHooks("update");
    },
  };
}

// Use the plugin
User.use(slugPlugin({
  sourceField: "title",
  targetField: "slug",
}));
```

## Hook Management

### Listing Hooks

```typescript
// Get all hooks
const allHooks = User.getHooks();

// Get hooks by type
const createHooks = User.getHooks("create");

// Get hooks by type and timing
const preCreateHooks = User.getHooks("create", "pre");
const postCreateHooks = User.getHooks("create", "post");
```

### Removing Hooks

```typescript
// Remove specific hook by ID
const hooks = User.getHooks("create", "pre");
User.removeHook(hooks[0].id);

// Remove all hooks of a type
User.removeHooks("create");

// Remove all pre-hooks of a type
User.removeHooks("create", "pre");

// Clear all hooks
User.clearHooks();
```

### Enabling/Disabling Hooks

```typescript
// Disable all hooks for performance-critical operations
User.setHooksEnabled(false);

await User.createMany(largeBatchOfUsers);

// Re-enable hooks
User.setHooksEnabled(true);

// Check if hooks are enabled
if (User.areHooksEnabled()) {
  console.log("Hooks are active");
}
```

## Error Handling

### Hook Execution Errors

```typescript
User.pre("create", function (context, next) {
  try {
    // Some risky operation
    const result = riskyOperation(context.input);
    next();
  } catch (error) {
    next(error); // Pass error to abort operation
  }
});

// Handle hook errors
try {
  await User.create(userData);
} catch (error) {
  if (KVMErrorUtils.isHookExecutionError(error)) {
    console.log(`Hook ${error.hookId} failed:`, error.originalError.message);
  }
}
```

### Hook Timeouts

```typescript
User.pre("create", function (context, next) {
  // This will timeout and fail the operation
  // next() is never called
}, { timeout: 1000 });

try {
  await User.create(userData);
} catch (error) {
  if (KVMErrorUtils.isHookTimeoutError(error)) {
    console.log(`Hook ${error.hookId} timed out after ${error.timeout}ms`);
  }
}
```

### Graceful Error Handling

```typescript
User.post("create", async function (context, result) {
  try {
    // Non-critical operation that shouldn't fail the main operation
    await sendNotificationEmail(this.email);
  } catch (error) {
    // Log but don't throw - post-hooks shouldn't fail the operation
    console.error("Failed to send notification email:", error);
  }
});
```

## Performance Considerations

### Parallel vs Sequential Hooks

```typescript
// Sequential (default) - hooks run one after another
User.post("create", async function (context, result) {
  await slowOperation1();
});

User.post("create", async function (context, result) {
  await slowOperation2();
});

// Parallel - hooks run concurrently (faster)
User.post("create", async function (context, result) {
  await slowOperation1();
}, { parallel: true });

User.post("create", async function (context, result) {
  await slowOperation2();
}, { parallel: true });
```

### Conditional Hook Execution

```typescript
User.pre("update", function (context, next) {
  // Only run expensive operation when needed
  if (context.input?.password) {
    context.input.password = expensiveHashFunction(context.input.password);
  }
  next();
});
```

### Batch Operations and Hooks

```typescript
// Hooks are executed for each item in batch operations
const users = await User.createMany([
  { id: "user1", name: "John" },
  { id: "user2", name: "Jane" },
  { id: "user3", name: "Bob" },
]);

// For performance-critical batch operations, consider disabling hooks
User.setHooksEnabled(false);
await User.createMany(largeBatch);
User.setHooksEnabled(true);
```

## Best Practices

### 1. Keep Hooks Focused and Simple

```typescript
// Good - focused responsibility
User.pre("create", function (context, next) {
  if (!context.input?.id) {
    context.input.id = crypto.randomUUID();
  }
  next();
});

// Better - use dedicated plugins for common patterns
User.use(timestampsPlugin());
User.use(auditPlugin());
```

### 2. Handle Errors Gracefully

```typescript
User.pre("create", async function (context, next) {
  try {
    const validationResult = await externalValidationService(context.input);
    if (!validationResult.valid) {
      return next(new Error(validationResult.error));
    }
    next();
  } catch (error) {
    // Handle network errors gracefully
    console.warn("External validation service unavailable, skipping");
    next(); // Continue without validation
  }
});
```

### 3. Use Appropriate Hook Types

```typescript
// Use pre-hooks for data modification
User.pre("create", function (context, next) {
  context.input.createdAt = new Date();
  next();
});

// Use post-hooks for side effects
User.post("create", async function (context, result) {
  await logAuditEvent("user_created", this);
});

// Use validation hooks for custom validation
User.pre("validate", function (context, next) {
  if (context.input?.age < 13) {
    return next(new Error("Users must be at least 13 years old"));
  }
  next();
});
```

### 4. Document Your Hooks

```typescript
/**
 * Automatically generates a username based on email if not provided
 * Ensures usernames are unique by appending a number if needed
 */
User.pre("create", async function (context, next) {
  if (!context.input?.username && context.input?.email) {
    let baseUsername = context.input.email.split("@")[0];
    let username = baseUsername;
    let counter = 1;

    while (await User.findUnique(username, "users_by_username")) {
      username = `${baseUsername}${counter}`;
      counter++;
    }

    context.input.username = username;
  }
  next();
});
```

### 5. Test Your Hooks

```typescript
import { describe, expect, it } from "your-test-framework";

describe("User hooks", () => {
  it("should add timestamps on create", async () => {
    const user = await User.create({
      id: "test",
      name: "Test User",
      email: "test@example.com",
    });

    expect(user.createdAt).toBeInstanceOf(Date);
    expect(user.updatedAt).toBeInstanceOf(Date);
  });

  it("should validate age requirement", async () => {
    await expect(User.create({
      id: "test",
      name: "Child",
      email: "child@example.com",
      age: 12,
    })).rejects.toThrow("Users must be at least 13 years old");
  });
});
```

## Integration with Other Features

The middleware/hooks system integrates seamlessly with other KVM features:

- **Model API**: All model operations support hooks
- **Query Builder**: Find operations trigger find hooks
- **Batch Operations**: Each item in batch operations triggers hooks
- **Error Handling**: Hook errors integrate with KVM's error system
- **Validation**: Custom validation hooks work alongside Zod schema validation

The middleware/hooks system provides a powerful way to extend your models with
custom behavior while keeping your code organized and maintainable.
