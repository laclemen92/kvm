// Queue Manager Implementation for KVM

import type {
  EnqueueOptions,
  JobProcessor,
  JobStatus,
  Queue,
  QueueJob,
  QueueManager,
  QueueStats,
  QueueWorker,
  WorkerOptions,
} from "./queue-types.ts";
import { KVMQueue } from "./queue.ts";

export class KVMQueueManager implements QueueManager {
  private queues = new Map<string, KVMQueue>();

  constructor(private readonly kv: Deno.Kv) {}

  private getQueue<TData = any>(queueName: string): KVMQueue<TData> {
    if (!this.queues.has(queueName)) {
      this.queues.set(queueName, new KVMQueue<TData>(queueName, this.kv));
    }
    return this.queues.get(queueName) as KVMQueue<TData>;
  }

  queue<TData = any>(queueName: string): Queue<TData> {
    return this.getQueue<TData>(queueName);
  }

  async enqueue<TData>(
    queueName: string,
    job: Omit<QueueJob<TData>, "id" | "createdAt" | "retryCount">,
    options?: EnqueueOptions,
  ): Promise<QueueJob<TData>> {
    const queue = this.getQueue<TData>(queueName);
    return queue.enqueue(job, options);
  }

  async enqueueMany<TData>(
    queueName: string,
    jobs: Array<Omit<QueueJob<TData>, "id" | "createdAt" | "retryCount">>,
    options?: EnqueueOptions,
  ): Promise<QueueJob<TData>[]> {
    const queue = this.getQueue<TData>(queueName);
    return queue.enqueueMany(jobs, options);
  }

  async dequeue(queueName: string): Promise<QueueJob | null> {
    const queue = this.getQueue(queueName);
    return queue.dequeue();
  }

  async getJob(queueName: string, jobId: string): Promise<QueueJob | null> {
    const queue = this.getQueue(queueName);
    return queue.getJob(jobId);
  }

  async getJobs(
    queueName: string,
    status?: JobStatus[],
    limit?: number,
    offset?: number,
  ): Promise<QueueJob[]> {
    const queue = this.getQueue(queueName);
    return queue.getJobs(status, limit, offset);
  }

  async getStats(queueName: string): Promise<QueueStats> {
    const queue = this.getQueue(queueName);
    return queue.getStats();
  }

  async removeJob(queueName: string, jobId: string): Promise<boolean> {
    const queue = this.getQueue(queueName);
    return queue.removeJob(jobId);
  }

  async clearQueue(queueName: string, status?: JobStatus[]): Promise<number> {
    const queue = this.getQueue(queueName);
    return queue.clear(status);
  }

  createWorker<TData, TResult>(
    queueName: string,
    processor: JobProcessor<TData, TResult>,
    options?: WorkerOptions,
  ): QueueWorker<TData, TResult> {
    const queue = this.getQueue<TData>(queueName);
    return queue.createWorker(processor, options);
  }

  // Utility methods for managing multiple queues

  async getAllQueueNames(): Promise<string[]> {
    const queues = new Set<string>();
    const entries = this.kv.list({ prefix: ["queues"] });

    for await (const entry of entries) {
      if (entry.key.length >= 2) {
        queues.add(entry.key[1] as string);
      }
    }

    return Array.from(queues).sort();
  }

  async getAllStats(): Promise<Record<string, QueueStats>> {
    const queueNames = await this.getAllQueueNames();
    const stats: Record<string, QueueStats> = {};

    for (const queueName of queueNames) {
      stats[queueName] = await this.getStats(queueName);
    }

    return stats;
  }

  async getTotalStats(): Promise<QueueStats> {
    const allStats = await this.getAllStats();
    const totalStats: QueueStats = {
      pending: 0,
      processing: 0,
      completed: 0,
      failed: 0,
      delayed: 0,
      total: 0,
    };

    for (const stats of Object.values(allStats)) {
      totalStats.pending += stats.pending;
      totalStats.processing += stats.processing;
      totalStats.completed += stats.completed;
      totalStats.failed += stats.failed;
      totalStats.delayed += stats.delayed;
      totalStats.total += stats.total;
    }

    return totalStats;
  }

  async clearAllQueues(status?: JobStatus[]): Promise<Record<string, number>> {
    const queueNames = await this.getAllQueueNames();
    const results: Record<string, number> = {};

    for (const queueName of queueNames) {
      results[queueName] = await this.clearQueue(queueName, status);
    }

    return results;
  }

  // Bulk operations across multiple queues

  async enqueueToMultipleQueues<TData>(
    queueJobs: Array<{
      queueName: string;
      job: Omit<QueueJob<TData>, "id" | "createdAt" | "retryCount">;
      options?: EnqueueOptions;
    }>,
  ): Promise<Array<{ queueName: string; job: QueueJob<TData> }>> {
    const results: Array<{ queueName: string; job: QueueJob<TData> }> = [];

    // Process in parallel
    const promises = queueJobs.map(async ({ queueName, job, options }) => {
      const enqueuedJob = await this.enqueue(queueName, job, options);
      return { queueName, job: enqueuedJob };
    });

    const settled = await Promise.allSettled(promises);

    for (const result of settled) {
      if (result.status === "fulfilled") {
        results.push(result.value);
      }
    }

    return results;
  }

  // Health check methods

  async healthCheck(): Promise<{
    healthy: boolean;
    queues: Record<string, { healthy: boolean; stats: QueueStats }>;
    totalStats: QueueStats;
  }> {
    const queueNames = await this.getAllQueueNames();
    const queues: Record<string, { healthy: boolean; stats: QueueStats }> = {};
    let overallHealthy = true;

    for (const queueName of queueNames) {
      try {
        const stats = await this.getStats(queueName);

        // A queue is considered unhealthy if it has too many failed jobs
        // or if jobs are stuck in processing for too long
        const healthy = stats.failed < (stats.total * 0.1); // Less than 10% failure rate

        queues[queueName] = { healthy, stats };

        if (!healthy) {
          overallHealthy = false;
        }
      } catch (error) {
        queues[queueName] = {
          healthy: false,
          stats: {
            pending: 0,
            processing: 0,
            completed: 0,
            failed: 0,
            delayed: 0,
            total: 0,
          },
        };
        overallHealthy = false;
      }
    }

    const totalStats = await this.getTotalStats();

    return {
      healthy: overallHealthy,
      queues,
      totalStats,
    };
  }

  // Cleanup old completed/failed jobs

  async cleanupOldJobs(
    maxAge: number = 7 * 24 * 60 * 60 * 1000, // 7 days
    statuses: JobStatus[] = ["completed", "failed"],
  ): Promise<Record<string, number>> {
    const queueNames = await this.getAllQueueNames();
    const results: Record<string, number> = {};
    const cutoffDate = new Date(Date.now() - maxAge);

    for (const queueName of queueNames) {
      let cleanedCount = 0;
      const jobs = await this.getJobs(queueName, statuses, 1000);

      for (const job of jobs) {
        const jobDate = job.completedAt || job.failedAt || job.createdAt;
        if (jobDate && jobDate < cutoffDate) {
          const removed = await this.removeJob(queueName, job.id);
          if (removed) {
            cleanedCount++;
          }
        }
      }

      results[queueName] = cleanedCount;
    }

    return results;
  }
}
