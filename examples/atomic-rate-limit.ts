/**
 * Example: Building Rate Limiting using KVM's Core Atomic Utilities
 *
 * This example shows how to implement rate limiting with features like:
 * - Token bucket algorithm
 * - Sliding window rate limiting
 * - Per-user/IP rate limits
 * - Different time windows (second, minute, hour, day)
 * - Burst handling
 *
 * This is built using KVM's core AtomicCounter with time-based keys.
 */

import { AtomicUtils } from "../lib/atomic-utils.ts";
import type { AtomicTransactionResult } from "../lib/atomic-types.ts";

export interface RateLimitConfig {
  /** Maximum requests allowed in the time window */
  maxRequests: number;
  /** Time window in milliseconds */
  windowMs: number;
  /** Whether to allow bursts up to maxRequests */
  allowBurst?: boolean;
}

export interface RateLimitResult {
  /** Whether the request is allowed */
  allowed: boolean;
  /** Current request count in the window */
  currentCount: number;
  /** Maximum requests allowed */
  maxRequests: number;
  /** Time until the window resets (in milliseconds) */
  resetTime: number;
  /** Requests remaining in this window */
  remaining: number;
}

export class AtomicRateLimit {
  constructor(
    private kv: Deno.Kv,
    private namespace: string = "rate_limit",
  ) {}

  /**
   * Check if a request is allowed and increment the counter if so
   */
  async checkAndIncrement(
    identifier: string,
    config: RateLimitConfig,
    timestamp: Date = new Date(),
  ): Promise<RateLimitResult> {
    const windowKey = this.getWindowKey(identifier, config, timestamp);
    const counter = AtomicUtils.counter(this.kv, windowKey);

    // Get current count
    const currentCount = await counter.get();
    const currentCountNum = Number(currentCount);

    // Calculate reset time
    const windowStart = this.getWindowStart(timestamp, config.windowMs);
    const resetTime = windowStart + config.windowMs - timestamp.getTime();

    // Check if request is allowed
    const allowed = currentCountNum < config.maxRequests;

    let newCount = currentCountNum;
    if (allowed) {
      // Increment the counter
      await counter.increment();
      newCount = currentCountNum + 1;
    }

    return {
      allowed,
      currentCount: newCount,
      maxRequests: config.maxRequests,
      resetTime,
      remaining: Math.max(0, config.maxRequests - newCount),
    };
  }

  /**
   * Check if a request would be allowed without incrementing
   */
  async check(
    identifier: string,
    config: RateLimitConfig,
    timestamp: Date = new Date(),
  ): Promise<RateLimitResult> {
    const windowKey = this.getWindowKey(identifier, config, timestamp);
    const counter = AtomicUtils.counter(this.kv, windowKey);

    const currentCount = Number(await counter.get());
    const windowStart = this.getWindowStart(timestamp, config.windowMs);
    const resetTime = windowStart + config.windowMs - timestamp.getTime();

    return {
      allowed: currentCount < config.maxRequests,
      currentCount,
      maxRequests: config.maxRequests,
      resetTime,
      remaining: Math.max(0, config.maxRequests - currentCount),
    };
  }

  /**
   * Reset rate limit for an identifier
   */
  async reset(
    identifier: string,
    config: RateLimitConfig,
    timestamp: Date = new Date(),
  ): Promise<AtomicTransactionResult> {
    const windowKey = this.getWindowKey(identifier, config, timestamp);
    const counter = AtomicUtils.counter(this.kv, windowKey);
    return await counter.reset();
  }

  /**
   * Sliding window rate limit (more accurate but more expensive)
   */
  async checkSlidingWindow(
    identifier: string,
    config: RateLimitConfig,
    timestamp: Date = new Date(),
  ): Promise<RateLimitResult> {
    const now = timestamp.getTime();
    const windowStart = now - config.windowMs;

    // Count requests in the sliding window
    let count = 0;
    const prefix = [this.namespace, "sliding", identifier];

    for await (const entry of this.kv.list<Deno.KvU64>({ prefix })) {
      const entryTime = entry.key[entry.key.length - 1] as number;
      if (entryTime >= windowStart) {
        count += Number(entry.value?.value ?? 0n);
      }
    }

    const allowed = count < config.maxRequests;

    if (allowed) {
      // Record this request
      const key = [...prefix, now];
      await this.kv.set(key, new Deno.KvU64(1n), { expireIn: config.windowMs });
    }

    return {
      allowed,
      currentCount: allowed ? count + 1 : count,
      maxRequests: config.maxRequests,
      resetTime: config.windowMs,
      remaining: Math.max(
        0,
        config.maxRequests - (allowed ? count + 1 : count),
      ),
    };
  }

  /**
   * Token bucket rate limiting
   */
  async checkTokenBucket(
    identifier: string,
    config: RateLimitConfig & { refillRate?: number },
    timestamp: Date = new Date(),
  ): Promise<RateLimitResult> {
    const refillRate = config.refillRate ?? config.maxRequests; // tokens per window
    const refillInterval = config.windowMs / refillRate; // ms per token

    const bucketKey = this.getBucketKey(identifier);
    const lastRefillKey = this.getLastRefillKey(identifier);

    // Get current tokens and last refill time
    const tokensCounter = AtomicUtils.counter(this.kv, bucketKey);
    const lastRefillCounter = AtomicUtils.counter(this.kv, lastRefillKey);

    const currentTokens = Number(await tokensCounter.get());
    const lastRefill = Number(await lastRefillCounter.get());
    const now = timestamp.getTime();

    // Calculate tokens to add
    const timeSinceRefill = lastRefill === 0 ? 0 : now - lastRefill;
    const tokensToAdd = Math.floor(timeSinceRefill / refillInterval);
    const newTokens = Math.min(config.maxRequests, currentTokens + tokensToAdd);

    // Update bucket if tokens were added
    if (tokensToAdd > 0) {
      await tokensCounter.set(newTokens);
      await lastRefillCounter.set(now);
    }

    const allowed = newTokens > 0;
    const finalTokens = allowed ? newTokens - 1 : newTokens;

    if (allowed) {
      await tokensCounter.set(finalTokens);
    }

    return {
      allowed,
      currentCount: config.maxRequests - finalTokens,
      maxRequests: config.maxRequests,
      resetTime: refillInterval,
      remaining: finalTokens,
    };
  }

  /**
   * Multi-tier rate limiting (e.g., per second + per minute + per hour)
   */
  async checkMultiTier(
    identifier: string,
    configs: Array<RateLimitConfig & { name: string }>,
    timestamp: Date = new Date(),
  ): Promise<{ [tierName: string]: RateLimitResult }> {
    const results: { [tierName: string]: RateLimitResult } = {};

    for (const config of configs) {
      const result = await this.checkAndIncrement(
        `${identifier}:${config.name}`,
        config,
        timestamp,
      );
      results[config.name] = result;

      // If any tier blocks the request, we need to rollback the increments
      if (!result.allowed) {
        // Rollback previous increments (this is a simplification)
        for (const prevConfig of configs) {
          if (prevConfig.name === config.name) break;
          const rollbackKey = this.getWindowKey(
            `${identifier}:${prevConfig.name}`,
            prevConfig,
            timestamp,
          );
          const rollbackCounter = AtomicUtils.counter(this.kv, rollbackKey);
          await rollbackCounter.decrement();
        }
        break;
      }
    }

    return results;
  }

  /**
   * Get rate limit status for an identifier
   */
  async getStatus(
    identifier: string,
    config: RateLimitConfig,
    timestamp: Date = new Date(),
  ): Promise<RateLimitResult> {
    return await this.check(identifier, config, timestamp);
  }

  /**
   * Clean up expired rate limit entries (maintenance function)
   */
  async cleanup(olderThanMs: number = 24 * 60 * 60 * 1000): Promise<number> {
    const cutoff = Date.now() - olderThanMs;
    let deletedCount = 0;

    for await (const entry of this.kv.list({ prefix: [this.namespace] })) {
      // Extract timestamp from key if possible
      const key = entry.key;
      const lastPart = key[key.length - 1];

      if (typeof lastPart === "number" && lastPart < cutoff) {
        await this.kv.delete(key);
        deletedCount++;
      }
    }

    return deletedCount;
  }

  // Private helper methods

  private getWindowKey(
    identifier: string,
    config: RateLimitConfig,
    timestamp: Date,
  ): Deno.KvKey {
    const windowStart = this.getWindowStart(timestamp, config.windowMs);
    return [this.namespace, "fixed", identifier, config.windowMs, windowStart];
  }

  private getBucketKey(identifier: string): Deno.KvKey {
    return [this.namespace, "bucket", identifier, "tokens"];
  }

  private getLastRefillKey(identifier: string): Deno.KvKey {
    return [this.namespace, "bucket", identifier, "last_refill"];
  }

  private getWindowStart(timestamp: Date, windowMs: number): number {
    return Math.floor(timestamp.getTime() / windowMs) * windowMs;
  }
}

// Convenience functions for common rate limit patterns

export const RateLimitPatterns = {
  /** 100 requests per minute */
  perMinute: (maxRequests = 100): RateLimitConfig => ({
    maxRequests,
    windowMs: 60 * 1000,
  }),

  /** 1000 requests per hour */
  perHour: (maxRequests = 1000): RateLimitConfig => ({
    maxRequests,
    windowMs: 60 * 60 * 1000,
  }),

  /** 10000 requests per day */
  perDay: (maxRequests = 10000): RateLimitConfig => ({
    maxRequests,
    windowMs: 24 * 60 * 60 * 1000,
  }),

  /** 10 requests per second */
  perSecond: (maxRequests = 10): RateLimitConfig => ({
    maxRequests,
    windowMs: 1000,
  }),

  /** API rate limiting: 1000/hour + 100/minute burst */
  api: (): Array<RateLimitConfig & { name: string }> => [
    { name: "burst", maxRequests: 100, windowMs: 60 * 1000 },
    { name: "sustained", maxRequests: 1000, windowMs: 60 * 60 * 1000 },
  ],
};

// Usage example:
if (import.meta.main) {
  const kv = await Deno.openKv(":memory:");
  const rateLimit = new AtomicRateLimit(kv, "api");

  // Test basic rate limiting
  const userLimit = RateLimitPatterns.perMinute(5); // 5 requests per minute

  console.log("Testing rate limit for user123...");

  for (let i = 1; i <= 7; i++) {
    const result = await rateLimit.checkAndIncrement("user123", userLimit);
    console.log(`Request ${i}:`, {
      allowed: result.allowed,
      remaining: result.remaining,
      resetTime: Math.round(result.resetTime / 1000) + "s",
    });
  }

  // Test token bucket
  console.log("\nTesting token bucket...");
  const bucketResult = await rateLimit.checkTokenBucket("user456", {
    maxRequests: 10,
    windowMs: 60000,
    refillRate: 2, // 2 tokens per minute
  });
  console.log("Token bucket result:", bucketResult);

  // Test multi-tier limiting
  console.log("\nTesting multi-tier rate limiting...");
  const multiResult = await rateLimit.checkMultiTier("user789", [
    { name: "second", maxRequests: 2, windowMs: 1000 },
    { name: "minute", maxRequests: 10, windowMs: 60000 },
  ]);
  console.log("Multi-tier result:", multiResult);

  kv.close();
}
