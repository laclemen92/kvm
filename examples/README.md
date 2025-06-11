# KVM Examples

This directory contains example implementations that show how to build complex
functionality using KVM's core atomic utilities. These examples demonstrate best
practices and common patterns for building real-world applications.

## 🎯 Atomic Operations Examples

These examples show how to build sophisticated features using KVM's core
`AtomicCounter` and atomic transaction capabilities:

### 🏆 [Leaderboard](./atomic-leaderboard.ts)

A gaming leaderboard implementation with features like:

- Player score tracking and updates
- Top N players retrieval
- Player ranking calculations
- Batch score updates
- Leaderboard statistics

```typescript
import { AtomicLeaderboard } from "./examples/atomic-leaderboard.ts";

const kv = await Deno.openKv();
const leaderboard = new AtomicLeaderboard(kv, "game1");

// Update player scores
await leaderboard.updateScore("alice", 1000);
await leaderboard.incrementScore("alice", 50);

// Get rankings
const topPlayers = await leaderboard.getTopPlayers(10);
const aliceRank = await leaderboard.getPlayerRank("alice");
```

### 📊 [Analytics](./atomic-analytics.ts)

Real-time analytics tracking with features like:

- Page view tracking with daily/hourly breakdown
- User activity metrics (DAU tracking)
- Custom event tracking
- Funnel analysis
- Date range reporting

```typescript
import { AtomicAnalytics } from "./examples/atomic-analytics.ts";

const analytics = new AtomicAnalytics(kv, "myapp");

// Track page views
await analytics.trackPageView("/home", "user123");

// Track custom events
await analytics.trackEvent("purchase", {
  product: "laptop",
  amount: 999,
});

// Get metrics
const pageViews = await analytics.getMetric("page_views.total");
const topPages = await analytics.getTopPages();
```

### 🚦 [Rate Limiting](./atomic-rate-limit.ts)

Comprehensive rate limiting with multiple algorithms:

- Fixed window rate limiting
- Sliding window rate limiting
- Token bucket algorithm
- Multi-tier rate limits
- Burst handling

```typescript
import {
  AtomicRateLimit,
  RateLimitPatterns,
} from "./examples/atomic-rate-limit.ts";

const rateLimit = new AtomicRateLimit(kv, "api");

// Check rate limit
const result = await rateLimit.checkAndIncrement(
  "user123",
  RateLimitPatterns.perMinute(100),
);

console.log(`Allowed: ${result.allowed}, Remaining: ${result.remaining}`);
```

## 🏗️ Why These Are Examples, Not Core Features

These implementations were moved out of KVM's core library because:

1. **Domain-Specific Logic**: They contain business logic that's specific to
   particular use cases
2. **Opinionated Designs**: They make design decisions that might not fit all
   applications
3. **Keep Core Lean**: KVM's core focuses on essential building blocks, not
   complete solutions
4. **Customization**: You can copy and modify these examples to fit your
   specific needs

## 🔧 Building Your Own

These examples demonstrate patterns you can follow to build your own
domain-specific functionality:

### Key Patterns Used:

1. **Atomic Counters**: Use `AtomicUtils.counter()` for thread-safe numeric
   operations
2. **Time-Based Keys**: Create keys with timestamps for time-series data
3. **Hierarchical Keys**: Organize data with nested key structures
4. **Batch Operations**: Use atomic transactions for multi-operation consistency
5. **Key Prefixes**: Use prefixes for efficient range queries

### Example Pattern:

```typescript
// 1. Create atomic counters for your metrics
const counter = AtomicUtils.counter(kv, ["namespace", "metric", identifier]);

// 2. Use time-based keys for analytics
const timeKey = ["analytics", "daily", dateStr, metricName];

// 3. Batch related operations atomically
const builder = AtomicUtils.builder(kv);
builder.sum(key1, value1);
builder.sum(key2, value2);
await builder.commit();

// 4. Use list operations for querying
const results = await kv.list({ prefix: ["namespace", "type"] });
```

## 🚀 Running the Examples

Each example file can be run directly to see it in action:

```bash
# Run the leaderboard example
deno run --unstable-kv examples/atomic-leaderboard.ts

# Run the analytics example  
deno run --unstable-kv examples/atomic-analytics.ts

# Run the rate limiting example
deno run --unstable-kv examples/atomic-rate-limit.ts
```

## 📖 Learn More

- [KVM Documentation](../README.md)
- [Atomic Operations Guide](../lib/atomic-utils.ts)
- [List Operations Guide](../lib/list-operations.ts)
- [Model API Documentation](../lib/model.ts)

These examples show the power and flexibility of KVM's atomic primitives. Use
them as inspiration for building your own domain-specific solutions!
