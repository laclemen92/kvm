/**
 * Example: Building Analytics Tracking using KVM's Core Atomic Utilities
 * 
 * This example shows how to implement real-time analytics with features like:
 * - Page view tracking
 * - User activity metrics
 * - Daily/hourly statistics
 * - Custom event tracking
 * - Funnel analysis
 * 
 * This is built using KVM's core AtomicCounter and time-based keys.
 */

import { AtomicUtils } from "../lib/atomic-utils.ts";
import { KeyUtils } from "../lib/list-operations.ts";
import type { AtomicTransactionResult } from "../lib/atomic-types.ts";

export class AtomicAnalytics {
  constructor(
    private kv: Deno.Kv,
    private namespace: string = "analytics",
  ) {}

  /**
   * Track a single metric increment
   */
  async trackMetric(metric: string, amount: number | bigint = 1): Promise<AtomicTransactionResult> {
    const counter = this.getMetricCounter(metric);
    return await counter.increment(amount);
  }

  /**
   * Track multiple metrics atomically
   */
  async trackMetrics(metrics: Record<string, number | bigint>): Promise<AtomicTransactionResult> {
    const builder = AtomicUtils.builder(this.kv);
    
    for (const [metric, amount] of Object.entries(metrics)) {
      const key = this.getMetricKey(metric);
      const value = typeof amount === "number" ? BigInt(amount) : amount;
      builder.sum(key, value);
    }
    
    return await builder.commit();
  }

  /**
   * Get current value of a metric
   */
  async getMetric(metric: string): Promise<bigint> {
    const counter = this.getMetricCounter(metric);
    return await counter.get();
  }

  /**
   * Track page views with automatic daily/hourly breakdown
   */
  async trackPageView(
    page: string, 
    userId?: string, 
    timestamp: Date = new Date()
  ): Promise<AtomicTransactionResult> {
    const dateStr = timestamp.toISOString().split('T')[0]; // YYYY-MM-DD
    const hourStr = timestamp.toISOString().substring(0, 13); // YYYY-MM-DDTHH
    
    const metrics: Record<string, number> = {
      [`pages.${page}.total`]: 1,
      [`pages.${page}.daily.${dateStr}`]: 1,
      [`pages.${page}.hourly.${hourStr}`]: 1,
      "page_views.total": 1,
      [`page_views.daily.${dateStr}`]: 1,
      [`page_views.hourly.${hourStr}`]: 1,
    };

    if (userId) {
      metrics[`users.${userId}.page_views`] = 1;
      metrics[`users.${userId}.pages.${page}`] = 1;
    }

    return await this.trackMetrics(metrics);
  }

  /**
   * Track user activity (DAU - Daily Active Users)
   */
  async trackUserActivity(
    userId: string, 
    activity: string = "active",
    timestamp: Date = new Date()
  ): Promise<AtomicTransactionResult> {
    const dateStr = timestamp.toISOString().split('T')[0];
    
    return await this.trackMetrics({
      [`users.activity.${activity}.total`]: 1,
      [`users.activity.${activity}.daily.${dateStr}`]: 1,
      [`users.${userId}.activity.${activity}`]: 1,
      [`users.daily_active.${dateStr}.${userId}`]: 1, // For unique user counting
    });
  }

  /**
   * Track custom events (like button clicks, purchases, etc.)
   */
  async trackEvent(
    eventName: string,
    properties?: Record<string, string | number>,
    timestamp: Date = new Date()
  ): Promise<AtomicTransactionResult> {
    const dateStr = timestamp.toISOString().split('T')[0];
    
    const metrics: Record<string, number> = {
      [`events.${eventName}.total`]: 1,
      [`events.${eventName}.daily.${dateStr}`]: 1,
      "events.total": 1,
    };

    // Track properties as separate metrics
    if (properties) {
      for (const [key, value] of Object.entries(properties)) {
        if (typeof value === "number") {
          metrics[`events.${eventName}.${key}.sum`] = value;
        } else {
          metrics[`events.${eventName}.${key}.${value}`] = 1;
        }
      }
    }

    return await this.trackMetrics(metrics);
  }

  /**
   * Track funnel step conversion
   */
  async trackFunnelStep(
    funnelName: string,
    step: string,
    userId: string,
    timestamp: Date = new Date()
  ): Promise<AtomicTransactionResult> {
    const dateStr = timestamp.toISOString().split('T')[0];
    
    return await this.trackMetrics({
      [`funnels.${funnelName}.${step}.total`]: 1,
      [`funnels.${funnelName}.${step}.daily.${dateStr}`]: 1,
      [`funnels.${funnelName}.${step}.users.${userId}`]: 1,
    });
  }

  /**
   * Get analytics for a specific date range
   */
  async getDateRangeMetrics(
    metricPrefix: string,
    startDate: Date,
    endDate: Date
  ): Promise<Array<{ date: string; value: bigint }>> {
    const results: Array<{ date: string; value: bigint }> = [];
    
    const start = KeyUtils.dateKey(this.namespace, metricPrefix, startDate);
    const end = KeyUtils.dateKey(this.namespace, metricPrefix, endDate);
    
    for await (const entry of this.kv.list<Deno.KvU64>({ start, end })) {
      const dateStr = entry.key[entry.key.length - 1] as string;
      const value = entry.value?.value ?? 0n;
      results.push({ date: dateStr, value });
    }
    
    return results.sort((a, b) => a.date.localeCompare(b.date));
  }

  /**
   * Get hourly breakdown for a specific date
   */
  async getHourlyBreakdown(
    metric: string,
    date: Date
  ): Promise<Array<{ hour: number; value: bigint }>> {
    const dateStr = date.toISOString().split('T')[0];
    const results: Array<{ hour: number; value: bigint }> = [];
    
    for (let hour = 0; hour < 24; hour++) {
      const hourStr = `${dateStr}T${hour.toString().padStart(2, '0')}`;
      const counter = this.getMetricCounter(`${metric}.hourly.${hourStr}`);
      const value = await counter.get();
      results.push({ hour, value });
    }
    
    return results;
  }

  /**
   * Get top pages by views
   */
  async getTopPages(limit = 10): Promise<Array<{ page: string; views: bigint }>> {
    const pages: Array<{ page: string; views: bigint }> = [];
    
    for await (const entry of this.kv.list<Deno.KvU64>({ 
      prefix: [this.namespace, "pages"] 
    })) {
      const key = entry.key;
      if (key[key.length - 1] === "total") {
        const page = key[key.length - 2] as string;
        const views = entry.value?.value ?? 0n;
        pages.push({ page, views });
      }
    }
    
    return pages
      .sort((a, b) => Number(b.views - a.views))
      .slice(0, limit);
  }

  /**
   * Calculate conversion rate between two funnel steps
   */
  async getFunnelConversionRate(
    funnelName: string,
    fromStep: string,
    toStep: string
  ): Promise<number> {
    const fromCount = await this.getMetric(`funnels.${funnelName}.${fromStep}.total`);
    const toCount = await this.getMetric(`funnels.${funnelName}.${toStep}.total`);
    
    if (fromCount === 0n) return 0;
    return Number(toCount) / Number(fromCount);
  }

  /**
   * Reset all metrics (use carefully!)
   */
  async resetAllMetrics(): Promise<void> {
    for await (const entry of this.kv.list({ prefix: [this.namespace] })) {
      await this.kv.delete(entry.key);
    }
  }

  // Private helper methods

  private getMetricCounter(metric: string) {
    return AtomicUtils.counter(this.kv, this.getMetricKey(metric));
  }

  private getMetricKey(metric: string): Deno.KvKey {
    return [this.namespace, ...metric.split('.')];
  }
}

// Usage example:
if (import.meta.main) {
  const kv = await Deno.openKv(":memory:");
  const analytics = new AtomicAnalytics(kv, "myapp");

  // Track some page views
  await analytics.trackPageView("/home", "user123");
  await analytics.trackPageView("/products", "user123");
  await analytics.trackPageView("/home", "user456");

  // Track user activity
  await analytics.trackUserActivity("user123", "login");
  await analytics.trackUserActivity("user456", "signup");

  // Track custom events
  await analytics.trackEvent("purchase", {
    product: "laptop",
    amount: 999,
    category: "electronics"
  });

  // Track funnel steps
  await analytics.trackFunnelStep("checkout", "cart", "user123");
  await analytics.trackFunnelStep("checkout", "payment", "user123");
  await analytics.trackFunnelStep("checkout", "complete", "user123");

  // Get metrics
  console.log("Total page views:", await analytics.getMetric("page_views.total"));
  console.log("Total purchases:", await analytics.getMetric("events.purchase.total"));
  
  // Get top pages
  const topPages = await analytics.getTopPages();
  console.log("Top pages:", topPages);

  // Get funnel conversion rate
  const conversionRate = await analytics.getFunnelConversionRate("checkout", "cart", "complete");
  console.log("Checkout conversion rate:", (conversionRate * 100).toFixed(2) + "%");

  kv.close();
}