// Queue System Implementation for KVM

import { ulid } from "https://deno.land/x/ulid@v0.3.0/mod.ts";
import type {
  EnqueueOptions,
  JobProcessor,
  JobStatus,
  Queue,
  QueueJob,
  QueueStats,
  QueueWorker,
  WorkerOptions,
} from "./queue-types.ts";
import { JobNotFoundError, QueueError } from "./queue-types.ts";
import { QueueWorkerImpl } from "./queue-worker.ts";

export class KVMQueue<TData = any> implements Queue<TData> {
  constructor(
    public readonly name: string,
    private readonly kv: Deno.Kv,
  ) {}

  private getJobKey(jobId: string): Deno.KvKey {
    return ["queues", this.name, "jobs", jobId];
  }

  private getJobsByStatusKey(status: JobStatus): Deno.KvKey {
    return ["queues", this.name, "by_status", status];
  }

  private getJobsByPriorityKey(priority: number): Deno.KvKey {
    return ["queues", this.name, "by_priority", priority];
  }

  private getStatsKey(): Deno.KvKey {
    return ["queues", this.name, "stats"];
  }

  private getDelayedJobsKey(): Deno.KvKey {
    return ["queues", this.name, "delayed"];
  }

  async enqueue(
    job: Omit<QueueJob<TData>, "id" | "createdAt" | "retryCount">,
    options: EnqueueOptions = {},
  ): Promise<QueueJob<TData>> {
    const jobId = ulid();
    const now = new Date();

    const queueJob: QueueJob<TData> = {
      id: jobId,
      type: job.type,
      data: job.data,
      priority: options.priority ?? job.priority ?? 0,
      delay: options.delay ?? job.delay,
      maxRetries: options.maxRetries ?? job.maxRetries ?? 3,
      retryCount: 0,
      retryDelay: options.retryDelay ?? job.retryDelay ?? 1000,
      createdAt: now,
      scheduledAt: options.delay
        ? new Date(now.getTime() + options.delay)
        : now,
      deadLetterQueue: options.deadLetterQueue ?? job.deadLetterQueue,
    };

    // Retry logic for atomic operations
    let attempts = 0;
    const maxAttempts = 5;

    while (attempts < maxAttempts) {
      const atomic = this.kv.atomic();

      // Store the job
      atomic.set(this.getJobKey(jobId), queueJob);

      // Add to appropriate status index
      const status: JobStatus = queueJob.delay ? "delayed" : "pending";
      atomic.set([...this.getJobsByStatusKey(status), jobId], jobId);

      // Add to priority index for pending jobs
      if (status === "pending") {
        const priorityKey = [
          ...this.getJobsByPriorityKey(queueJob.priority!),
          now.getTime(),
          jobId,
        ];
        atomic.set(priorityKey, jobId);
      }

      // Update stats with atomic check to avoid race conditions
      const statsKey = this.getStatsKey();
      const statsEntry = await this.kv.get<QueueStats>(statsKey);
      const currentStats = statsEntry.value ?? {
        pending: 0,
        processing: 0,
        completed: 0,
        failed: 0,
        delayed: 0,
        total: 0,
      };

      const newStats: QueueStats = {
        ...currentStats,
        [status]: currentStats[status] + 1,
        total: currentStats.total + 1,
      };

      atomic.check(statsEntry);
      atomic.set(statsKey, newStats);

      const result = await atomic.commit();
      if (result.ok) {
        return queueJob;
      }

      attempts++;
      if (attempts < maxAttempts) {
        // Wait a bit before retrying
        await new Promise((resolve) => setTimeout(resolve, Math.random() * 10));
      }
    }

    throw new QueueError(
      `Failed to enqueue job ${jobId} in queue ${this.name} after ${maxAttempts} attempts`,
    );
  }

  async enqueueMany(
    jobs: Array<Omit<QueueJob<TData>, "id" | "createdAt" | "retryCount">>,
    options: EnqueueOptions = {},
  ): Promise<QueueJob<TData>[]> {
    if (jobs.length === 0) return [];

    const now = new Date();
    const queueJobs: QueueJob<TData>[] = [];
    const atomic = this.kv.atomic();

    for (const job of jobs) {
      const jobId = ulid();
      const queueJob: QueueJob<TData> = {
        id: jobId,
        type: job.type,
        data: job.data,
        priority: options.priority ?? job.priority ?? 0,
        delay: options.delay ?? job.delay,
        maxRetries: options.maxRetries ?? job.maxRetries ?? 3,
        retryCount: 0,
        retryDelay: options.retryDelay ?? job.retryDelay ?? 1000,
        createdAt: now,
        scheduledAt: options.delay
          ? new Date(now.getTime() + options.delay)
          : now,
        deadLetterQueue: options.deadLetterQueue ?? job.deadLetterQueue,
      };

      queueJobs.push(queueJob);

      // Store the job
      atomic.set(this.getJobKey(jobId), queueJob);

      // Add to appropriate status index
      const status: JobStatus = queueJob.delay ? "delayed" : "pending";
      atomic.set([...this.getJobsByStatusKey(status), jobId], jobId);

      // Add to priority index for pending jobs
      if (status === "pending") {
        const priorityKey = [
          ...this.getJobsByPriorityKey(queueJob.priority!),
          now.getTime(),
          jobId,
        ];
        atomic.set(priorityKey, jobId);
      }
    }

    // Update stats
    const currentStats = await this.getStats();
    const pendingCount = queueJobs.filter((j) => !j.delay).length;
    const delayedCount = queueJobs.filter((j) => j.delay).length;

    const newStats: QueueStats = {
      ...currentStats,
      pending: currentStats.pending + pendingCount,
      delayed: currentStats.delayed + delayedCount,
      total: currentStats.total + queueJobs.length,
    };
    atomic.set(this.getStatsKey(), newStats);

    const result = await atomic.commit();
    if (!result.ok) {
      throw new QueueError(
        `Failed to enqueue ${jobs.length} jobs in queue ${this.name}`,
      );
    }

    return queueJobs;
  }

  async atomicEnqueue(
    jobs: Array<Omit<QueueJob<TData>, "id" | "createdAt" | "retryCount">>,
    options: EnqueueOptions = {},
  ): Promise<QueueJob<TData>[]> {
    return this.enqueueMany(jobs, { ...options, atomic: true });
  }

  async dequeue(): Promise<QueueJob<TData> | null> {
    // First, check for any delayed jobs that are now ready
    await this.processDelayedJobs();

    // Get highest priority pending job
    const priorityList = this.kv.list<string>({
      prefix: ["queues", this.name, "by_priority"],
    });

    let highestPriorityJobId: string | null = null;
    let highestPriorityKey: Deno.KvKey | null = null;
    let highestPriority = -1;

    for await (const entry of priorityList) {
      // Key structure: ["queues", queueName, "by_priority", priority, timestamp, jobId]
      const priority = entry.key[3] as number;

      if (priority > highestPriority) {
        highestPriority = priority;
        highestPriorityJobId = entry.value;
        highestPriorityKey = entry.key;
      }
    }

    if (!highestPriorityJobId || !highestPriorityKey) {
      return null;
    }

    // Get the job and mark it as processing
    const jobEntry = await this.kv.get<QueueJob<TData>>(
      this.getJobKey(highestPriorityJobId),
    );
    if (!jobEntry.value) {
      // Job was deleted, remove from priority queue
      await this.kv.delete(highestPriorityKey);
      return this.dequeue(); // Try again
    }

    const job = jobEntry.value;
    const updatedJob: QueueJob<TData> = {
      ...job,
      processedAt: new Date(),
    };

    const atomic = this.kv.atomic();

    // Update job status to processing
    atomic.set(this.getJobKey(job.id), updatedJob);

    // Remove from pending status and priority indices
    atomic.delete([...this.getJobsByStatusKey("pending"), job.id]);
    atomic.delete(highestPriorityKey);

    // Add to processing status
    atomic.set([...this.getJobsByStatusKey("processing"), job.id], job.id);

    // Update stats
    const currentStats = await this.getStats();
    const newStats: QueueStats = {
      ...currentStats,
      pending: Math.max(0, currentStats.pending - 1),
      processing: currentStats.processing + 1,
    };
    atomic.set(this.getStatsKey(), newStats);

    const result = await atomic.commit();
    if (!result.ok) {
      // Retry once
      await new Promise((resolve) => setTimeout(resolve, 100));
      return this.dequeue();
    }

    return updatedJob;
  }

  private async processDelayedJobs(): Promise<void> {
    const now = new Date();
    const delayedJobs = this.kv.list<string>({
      prefix: this.getJobsByStatusKey("delayed"),
    });

    const jobsToActivate: string[] = [];

    for await (const entry of delayedJobs) {
      const jobId = entry.value;
      const job = await this.getJob(jobId);

      if (job && job.scheduledAt && job.scheduledAt <= now) {
        jobsToActivate.push(jobId);
      }
    }

    if (jobsToActivate.length === 0) return;

    const atomic = this.kv.atomic();

    for (const jobId of jobsToActivate) {
      const job = await this.getJob(jobId);
      if (!job) continue;

      // Remove from delayed status
      atomic.delete([...this.getJobsByStatusKey("delayed"), jobId]);

      // Add to pending status and priority index
      atomic.set([...this.getJobsByStatusKey("pending"), jobId], jobId);
      const priorityKey = [
        ...this.getJobsByPriorityKey(job.priority!),
        now.getTime(),
        jobId,
      ];
      atomic.set(priorityKey, jobId);
    }

    // Update stats
    const currentStats = await this.getStats();
    const newStats: QueueStats = {
      ...currentStats,
      delayed: Math.max(0, currentStats.delayed - jobsToActivate.length),
      pending: currentStats.pending + jobsToActivate.length,
    };
    atomic.set(this.getStatsKey(), newStats);

    await atomic.commit();
  }

  async getJob(jobId: string): Promise<QueueJob<TData> | null> {
    const entry = await this.kv.get<QueueJob<TData>>(this.getJobKey(jobId));
    return entry.value;
  }

  async getJobs(
    status?: JobStatus[],
    limit = 50,
    offset = 0,
  ): Promise<QueueJob<TData>[]> {
    const jobs: QueueJob<TData>[] = [];

    if (status && status.length > 0) {
      for (const s of status) {
        const statusJobs = this.kv.list<string>({
          prefix: this.getJobsByStatusKey(s),
        });

        let count = 0;
        for await (const entry of statusJobs) {
          if (count < offset) {
            count++;
            continue;
          }
          if (jobs.length >= limit) break;

          const job = await this.getJob(entry.value);
          if (job) {
            jobs.push(job);
          }
          count++;
        }
      }
    } else {
      // Get all jobs
      const allJobs = this.kv.list<QueueJob<TData>>({
        prefix: ["queues", this.name, "jobs"],
      });

      let count = 0;
      for await (const entry of allJobs) {
        if (count < offset) {
          count++;
          continue;
        }
        if (jobs.length >= limit) break;

        jobs.push(entry.value);
        count++;
      }
    }

    return jobs;
  }

  async getStats(): Promise<QueueStats> {
    const entry = await this.kv.get<QueueStats>(this.getStatsKey());
    return entry.value ?? {
      pending: 0,
      processing: 0,
      completed: 0,
      failed: 0,
      delayed: 0,
      total: 0,
    };
  }

  async removeJob(jobId: string): Promise<boolean> {
    const job = await this.getJob(jobId);
    if (!job) {
      return false;
    }

    const atomic = this.kv.atomic();

    // Remove job
    atomic.delete(this.getJobKey(jobId));

    // Remove from all status indices
    const statuses: JobStatus[] = [
      "pending",
      "processing",
      "completed",
      "failed",
      "delayed",
      "retrying",
    ];
    for (const status of statuses) {
      atomic.delete([...this.getJobsByStatusKey(status), jobId]);
    }

    // Remove from priority index if pending
    if (!job.processedAt && !job.delay) {
      // We need to find and remove from priority index
      const priorityPrefix = [...this.getJobsByPriorityKey(job.priority!)];
      const priorityEntries = this.kv.list<string>({ prefix: priorityPrefix });

      for await (const entry of priorityEntries) {
        if (entry.value === jobId) {
          atomic.delete(entry.key);
          break;
        }
      }
    }

    // Update stats
    const currentStats = await this.getStats();
    const jobStatus = this.getJobStatus(job);
    const newStats: QueueStats = {
      ...currentStats,
      [jobStatus]: Math.max(0, (currentStats as any)[jobStatus] - 1),
      total: Math.max(0, currentStats.total - 1),
    };
    atomic.set(this.getStatsKey(), newStats);

    const result = await atomic.commit();
    return result.ok;
  }

  private getJobStatus(job: QueueJob<TData>): JobStatus {
    if (job.completedAt) return "completed";
    if (job.failedAt) return "failed";
    if (job.processedAt) return "processing";
    if (job.delay && job.scheduledAt && job.scheduledAt > new Date()) {
      return "delayed";
    }
    return "pending";
  }

  async clear(status?: JobStatus[]): Promise<number> {
    const jobs = await this.getJobs(status);
    let deletedCount = 0;

    for (const job of jobs) {
      const deleted = await this.removeJob(job.id);
      if (deleted) deletedCount++;
    }

    return deletedCount;
  }

  createWorker<TResult>(
    processor: JobProcessor<TData, TResult>,
    options: WorkerOptions = {},
  ): QueueWorker<TData, TResult> {
    return new QueueWorkerImpl(this, processor, options);
  }

  // Job completion methods for worker use
  async completeJob(jobId: string, jobResult?: any): Promise<void> {
    const job = await this.getJob(jobId);
    if (!job) {
      throw new JobNotFoundError(this.name, jobId);
    }

    const completedJob: QueueJob<TData> = {
      ...job,
      completedAt: new Date(),
    };

    const atomic = this.kv.atomic();

    // Update job
    atomic.set(this.getJobKey(jobId), completedJob);

    // Move from processing to completed
    atomic.delete([...this.getJobsByStatusKey("processing"), jobId]);
    atomic.set([...this.getJobsByStatusKey("completed"), jobId], jobId);

    // Update stats
    const currentStats = await this.getStats();
    const newStats: QueueStats = {
      ...currentStats,
      processing: Math.max(0, currentStats.processing - 1),
      completed: currentStats.completed + 1,
    };
    atomic.set(this.getStatsKey(), newStats);

    const result = await atomic.commit();
    if (!result.ok) {
      throw new QueueError(
        `Failed to complete job ${jobId} in queue ${this.name}`,
      );
    }
  }

  async failJob(jobId: string, error: Error): Promise<void> {
    const job = await this.getJob(jobId);
    if (!job) {
      throw new JobNotFoundError(this.name, jobId);
    }

    const shouldRetry = (job.retryCount ?? 0) < (job.maxRetries ?? 3);

    if (shouldRetry) {
      // Retry the job
      await this.retryJob(jobId, error);
    } else {
      // Move to failed or dead letter queue
      if (job.deadLetterQueue) {
        await this.moveToDeadLetterQueue(job, error);
      } else {
        await this.markJobAsFailed(jobId, error);
      }
    }
  }

  private async retryJob(jobId: string, error: Error): Promise<void> {
    const job = await this.getJob(jobId);
    if (!job) return;

    const retryJob: QueueJob<TData> = {
      ...job,
      retryCount: (job.retryCount ?? 0) + 1,
      scheduledAt: new Date(Date.now() + (job.retryDelay || 1000)),
      error: error.message,
    };

    const atomic = this.kv.atomic();

    // Update job
    atomic.set(this.getJobKey(jobId), retryJob);

    // Move from processing to delayed (for retry)
    atomic.delete([...this.getJobsByStatusKey("processing"), jobId]);
    atomic.set([...this.getJobsByStatusKey("delayed"), jobId], jobId);

    // Update stats
    const currentStats = await this.getStats();
    const newStats: QueueStats = {
      ...currentStats,
      processing: Math.max(0, currentStats.processing - 1),
      delayed: currentStats.delayed + 1,
    };
    atomic.set(this.getStatsKey(), newStats);

    await atomic.commit();
  }

  private async markJobAsFailed(jobId: string, error: Error): Promise<void> {
    const job = await this.getJob(jobId);
    if (!job) return;

    const failedJob: QueueJob<TData> = {
      ...job,
      failedAt: new Date(),
      error: error.message,
    };

    const atomic = this.kv.atomic();

    // Update job
    atomic.set(this.getJobKey(jobId), failedJob);

    // Move from processing to failed
    atomic.delete([...this.getJobsByStatusKey("processing"), jobId]);
    atomic.set([...this.getJobsByStatusKey("failed"), jobId], jobId);

    // Update stats
    const currentStats = await this.getStats();
    const newStats: QueueStats = {
      ...currentStats,
      processing: Math.max(0, currentStats.processing - 1),
      failed: currentStats.failed + 1,
    };
    atomic.set(this.getStatsKey(), newStats);

    await atomic.commit();
  }

  private async moveToDeadLetterQueue(
    job: QueueJob<TData>,
    error: Error,
  ): Promise<void> {
    if (!job.deadLetterQueue) return;

    // Create a new queue instance for the dead letter queue
    const dlq = new KVMQueue(job.deadLetterQueue, this.kv);

    // Add job to dead letter queue
    await dlq.enqueue({
      type: `failed_${job.type}`,
      data: {
        originalJob: job,
        error: error.message,
        failedAt: new Date(),
      },
    });

    // Remove from current queue
    await this.removeJob(job.id);
  }
}
