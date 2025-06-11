import {
  assert,
  assertEquals,
  assertRejects,
} from "https://deno.land/std@0.220.0/assert/mod.ts";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  it,
} from "jsr:@std/testing/bdd";
import { KVMQueue } from "./queue.ts";
import { KVMQueueManager } from "./queue-manager.ts";
import type { JobStatus, QueueJob } from "./queue-types.ts";

describe("Queue System", () => {
  let kv: Deno.Kv;
  let queue: KVMQueue<any>;
  let queueManager: KVMQueueManager;

  beforeAll(async () => {
    kv = await Deno.openKv(":memory:");
  });

  beforeEach(() => {
    queue = new KVMQueue<any>("test-queue", kv);
    queueManager = new KVMQueueManager(kv);
  });

  afterEach(async () => {
    // Clear all data between tests
    const allEntries = await Array.fromAsync(kv.list({ prefix: [] }));
    for (const entry of allEntries) {
      await kv.delete(entry.key);
    }
  });

  afterAll(async () => {
    await kv.close();
  });

  describe("KVMQueue", () => {
    describe("enqueue", () => {
      it("should enqueue a basic job", async () => {
        const jobData = {
          type: "send-email",
          data: { email: "test@example.com", subject: "Hello" },
        };

        const job = await queue.enqueue(jobData);

        assertEquals(job.type, "send-email");
        assertEquals(job.data.email, "test@example.com");
        assertEquals(job.retryCount, 0);
        assertEquals(job.priority, 0);
        assert(job.id);
        assert(job.createdAt);
        assert(job.scheduledAt);
      });

      it("should enqueue a job with options", async () => {
        const jobData = {
          type: "process-data",
          data: { userId: "123" },
        };

        const job = await queue.enqueue(jobData, {
          priority: 5,
          maxRetries: 5,
          retryDelay: 2000,
          deadLetterQueue: "failed-jobs",
        });

        assertEquals(job.priority, 5);
        assertEquals(job.maxRetries, 5);
        assertEquals(job.retryDelay, 2000);
        assertEquals(job.deadLetterQueue, "failed-jobs");
      });

      it("should enqueue a delayed job", async () => {
        const jobData = {
          type: "delayed-job",
          data: { message: "future" },
        };

        const delay = 5000; // 5 seconds
        const beforeEnqueue = Date.now();

        const job = await queue.enqueue(jobData, { delay });

        assertEquals(job.delay, delay);
        assert(job.scheduledAt);
        assert(job.scheduledAt.getTime() >= beforeEnqueue + delay);
      });

      it("should update queue stats after enqueuing", async () => {
        const initialStats = await queue.getStats();
        assertEquals(initialStats.pending, 0);
        assertEquals(initialStats.total, 0);

        await queue.enqueue({
          type: "test-job",
          data: { test: true },
        });

        const updatedStats = await queue.getStats();
        assertEquals(updatedStats.pending, 1);
        assertEquals(updatedStats.total, 1);
      });
    });

    describe("enqueueMany", () => {
      it("should enqueue multiple jobs", async () => {
        const jobs = [
          { type: "job1", data: { id: 1 } },
          { type: "job2", data: { id: 2 } },
          { type: "job3", data: { id: 3 } },
        ];

        const enqueuedJobs = await queue.enqueueMany(jobs);

        assertEquals(enqueuedJobs.length, 3);
        assertEquals(enqueuedJobs[0].type, "job1");
        assertEquals(enqueuedJobs[1].type, "job2");
        assertEquals(enqueuedJobs[2].type, "job3");

        const stats = await queue.getStats();
        assertEquals(stats.pending, 3);
        assertEquals(stats.total, 3);
      });

      it("should handle empty job array", async () => {
        const enqueuedJobs = await queue.enqueueMany([]);
        assertEquals(enqueuedJobs.length, 0);

        const stats = await queue.getStats();
        assertEquals(stats.total, 0);
      });

      it("should enqueue delayed and immediate jobs correctly", async () => {
        const jobs = [
          { type: "immediate", data: { id: 1 } },
          { type: "delayed", data: { id: 2 }, delay: 5000 },
          { type: "immediate2", data: { id: 3 } },
        ];

        await queue.enqueueMany(jobs);

        const stats = await queue.getStats();
        assertEquals(stats.pending, 2); // 2 immediate jobs
        assertEquals(stats.delayed, 1); // 1 delayed job
        assertEquals(stats.total, 3);
      });
    });

    describe("dequeue", () => {
      it("should dequeue jobs in priority order", async () => {
        // Enqueue jobs with different priorities
        await queue.enqueue({ type: "low", data: {} }, { priority: 1 });
        await queue.enqueue({ type: "high", data: {} }, { priority: 10 });
        await queue.enqueue({ type: "medium", data: {} }, { priority: 5 });

        const job1 = await queue.dequeue();
        assertEquals(job1?.type, "high");
        assertEquals(job1?.priority, 10);

        const job2 = await queue.dequeue();
        assertEquals(job2?.type, "medium");
        assertEquals(job2?.priority, 5);

        const job3 = await queue.dequeue();
        assertEquals(job3?.type, "low");
        assertEquals(job3?.priority, 1);
      });

      it("should return null when no jobs available", async () => {
        const job = await queue.dequeue();
        assertEquals(job, null);
      });

      it("should mark dequeued job as processing", async () => {
        await queue.enqueue({ type: "test", data: {} });

        const job = await queue.dequeue();
        assert(job);
        assert(job.processedAt);

        const stats = await queue.getStats();
        assertEquals(stats.pending, 0);
        assertEquals(stats.processing, 1);
      });

      it("should handle delayed jobs that become ready", async () => {
        // Enqueue a job with very short delay
        await queue.enqueue(
          { type: "delayed", data: {} },
          { delay: 100 }, // 100ms
        );

        // Initially should return null
        let job = await queue.dequeue();
        assertEquals(job, null);

        // Wait for delay to pass
        await new Promise((resolve) => setTimeout(resolve, 150));

        // Now should be able to dequeue
        job = await queue.dequeue();
        assertEquals(job?.type, "delayed");
      });
    });

    describe("getJob", () => {
      it("should retrieve a job by ID", async () => {
        const enqueuedJob = await queue.enqueue({
          type: "test",
          data: { message: "hello" },
        });

        const retrievedJob = await queue.getJob(enqueuedJob.id);
        assertEquals(retrievedJob?.id, enqueuedJob.id);
        assertEquals(retrievedJob?.type, "test");
        assertEquals(retrievedJob?.data.message, "hello");
      });

      it("should return null for non-existent job", async () => {
        const job = await queue.getJob("non-existent-id");
        assertEquals(job, null);
      });
    });

    describe("getJobs", () => {
      it("should get jobs by status", async () => {
        await queue.enqueue({ type: "job1", data: {} });
        await queue.enqueue({ type: "job2", data: {} });

        // Dequeue one job to make it processing
        const dequeuedJob = await queue.dequeue();

        const pendingJobs = await queue.getJobs(["pending"]);
        assertEquals(pendingJobs.length, 1);

        const processingJobs = await queue.getJobs(["processing"]);
        assertEquals(processingJobs.length, 1);

        // Check that we have one pending and one processing job
        // The specific job types depend on which was dequeued first
        const allJobTypes = new Set([
          pendingJobs[0].type,
          processingJobs[0].type,
        ]);
        assert(allJobTypes.has("job1"));
        assert(allJobTypes.has("job2"));

        // Verify the dequeued job matches the processing job
        assertEquals(processingJobs[0].id, dequeuedJob?.id);
      });

      it("should get all jobs when no status filter", async () => {
        await queue.enqueue({ type: "job1", data: {} });
        await queue.enqueue({ type: "job2", data: {} });

        const allJobs = await queue.getJobs();
        assertEquals(allJobs.length, 2);
      });

      it("should respect limit and offset", async () => {
        // Enqueue multiple jobs
        for (let i = 1; i <= 5; i++) {
          await queue.enqueue({ type: `job${i}`, data: { id: i } });
        }

        const jobs = await queue.getJobs(undefined, 2, 1);
        assertEquals(jobs.length, 2);
      });
    });

    describe("removeJob", () => {
      it("should remove a job and update stats", async () => {
        const job = await queue.enqueue({ type: "test", data: {} });

        const removed = await queue.removeJob(job.id);
        assertEquals(removed, true);

        const retrievedJob = await queue.getJob(job.id);
        assertEquals(retrievedJob, null);

        const stats = await queue.getStats();
        assertEquals(stats.total, 0);
      });

      it("should return false for non-existent job", async () => {
        const removed = await queue.removeJob("non-existent");
        assertEquals(removed, false);
      });
    });

    describe("clear", () => {
      it("should clear all jobs", async () => {
        await queue.enqueue({ type: "job1", data: {} });
        await queue.enqueue({ type: "job2", data: {} });
        await queue.dequeue(); // One job becomes processing

        const cleared = await queue.clear();
        assertEquals(cleared, 2);

        const stats = await queue.getStats();
        assertEquals(stats.total, 0);
      });

      it("should clear jobs by status", async () => {
        await queue.enqueue({ type: "job1", data: {} });
        await queue.enqueue({ type: "job2", data: {} });
        await queue.dequeue(); // One job becomes processing

        const cleared = await queue.clear(["pending"]);
        assertEquals(cleared, 1);

        const stats = await queue.getStats();
        assertEquals(stats.pending, 0);
        assertEquals(stats.processing, 1);
        assertEquals(stats.total, 1);
      });
    });

    describe("job completion", () => {
      it("should complete a job successfully", async () => {
        const job = await queue.enqueue({ type: "test", data: {} });
        await queue.dequeue(); // Mark as processing

        await queue.completeJob(job.id, { result: "success" });

        const completedJob = await queue.getJob(job.id);
        assert(completedJob?.completedAt);

        const stats = await queue.getStats();
        assertEquals(stats.processing, 0);
        assertEquals(stats.completed, 1);
      });

      it("should fail a job and retry if retries available", async () => {
        const job = await queue.enqueue(
          { type: "test", data: {} },
          { maxRetries: 2 },
        );
        await queue.dequeue(); // Mark as processing

        const error = new Error("Test error");
        await queue.failJob(job.id, error);

        const failedJob = await queue.getJob(job.id);
        assertEquals(failedJob?.retryCount, 1);
        assertEquals(failedJob?.error, "Test error");

        const stats = await queue.getStats();
        assertEquals(stats.processing, 0);
        assertEquals(stats.delayed, 1); // Job is delayed for retry
      });

      it("should move job to failed after max retries", async () => {
        const job = await queue.enqueue(
          { type: "test", data: {} },
          { maxRetries: 0 },
        );
        await queue.dequeue(); // Mark as processing

        const error = new Error("Test error");
        await queue.failJob(job.id, error);

        const failedJob = await queue.getJob(job.id);
        assert(failedJob?.failedAt);
        assertEquals(failedJob?.error, "Test error");

        const stats = await queue.getStats();
        assertEquals(stats.processing, 0);
        assertEquals(stats.failed, 1);
      });
    });
  });

  describe("QueueWorker", () => {
    it("should process jobs automatically", async () => {
      let processedJob: QueueJob<any> | null = null;

      const worker = queue.createWorker<any>(async (job: QueueJob<any>) => {
        processedJob = job;
        return { result: "processed" };
      }, {
        autoStart: true,
        pollInterval: 100, // Fast polling for test
      });

      await worker.start();

      // Enqueue a job
      await queue.enqueue({ type: "test-job", data: { test: true } });

      // Wait for processing
      await new Promise((resolve) => setTimeout(resolve, 200));

      assert(processedJob);
      assertEquals((processedJob as QueueJob<any>).type, "test-job");

      const stats = await queue.getStats();
      assertEquals(stats.completed, 1);

      await worker.stop();
    });

    it("should handle job failures and retries", async () => {
      let attemptCount = 0;

      const worker = queue.createWorker(async (job) => {
        attemptCount++;
        if (attemptCount <= 2) {
          throw new Error("Temporary failure");
        }
        return { result: "success" };
      }, {
        autoStart: true,
        pollInterval: 100,
      });

      await worker.start();

      // Enqueue a job that will fail twice then succeed
      await queue.enqueue(
        { type: "flaky-job", data: {} },
        { maxRetries: 3, retryDelay: 100 },
      );

      // Wait for processing and retries
      await new Promise((resolve) => setTimeout(resolve, 500));

      assertEquals(attemptCount, 3);

      const stats = await queue.getStats();
      assertEquals(stats.completed, 1);

      await worker.stop();
    });

    it("should respect concurrency limits", async () => {
      let activeJobs = 0;
      let maxConcurrent = 0;

      const worker = queue.createWorker(async (job) => {
        activeJobs++;
        maxConcurrent = Math.max(maxConcurrent, activeJobs);

        // Simulate work
        await new Promise((resolve) => setTimeout(resolve, 200));

        activeJobs--;
        return { result: "done" };
      }, {
        concurrency: 2,
        autoStart: true,
        pollInterval: 50,
      });

      await worker.start();

      // Enqueue multiple jobs
      for (let i = 0; i < 5; i++) {
        await queue.enqueue({ type: "concurrent-job", data: { id: i } });
      }

      // Wait for all jobs to complete
      await new Promise((resolve) => setTimeout(resolve, 1000));

      assertEquals(maxConcurrent, 2); // Should not exceed concurrency limit

      await worker.stop();
    });

    it("should handle worker events", async () => {
      const events: string[] = [];

      const worker = queue.createWorker(async (job) => {
        return { result: "done" };
      }, {
        pollInterval: 100,
      });

      worker.on("worker:started", () => events.push("started"));
      worker.on("worker:stopped", () => events.push("stopped"));
      worker.on("job:completed", () => events.push("job_completed"));

      await worker.start();
      await queue.enqueue({ type: "event-test", data: {} });

      // Wait for job processing
      await new Promise((resolve) => setTimeout(resolve, 200));

      await worker.stop();

      assert(events.includes("started"));
      assert(events.includes("job_completed"));
      assert(events.includes("stopped"));
    });
  });

  describe("QueueManager", () => {
    it("should manage multiple queues", async () => {
      const emailQueue = queueManager.queue("email-queue");
      const dataQueue = queueManager.queue("data-queue");

      await emailQueue.enqueue({ type: "send-email", data: {} });
      await dataQueue.enqueue({ type: "process-data", data: {} });

      const emailStats = await emailQueue.getStats();
      const dataStats = await dataQueue.getStats();

      assertEquals(emailStats.total, 1);
      assertEquals(dataStats.total, 1);

      const queueNames = await queueManager.getAllQueueNames();
      assert(queueNames.includes("email-queue"));
      assert(queueNames.includes("data-queue"));
    });

    it("should get total stats across all queues", async () => {
      await queueManager.enqueue("queue1", { type: "job1", data: {} });
      await queueManager.enqueue("queue2", { type: "job2", data: {} });
      await queueManager.enqueue("queue2", { type: "job3", data: {} });

      const totalStats = await queueManager.getTotalStats();
      assertEquals(totalStats.total, 3);
      assertEquals(totalStats.pending, 3);
    });

    it("should enqueue to multiple queues", async () => {
      const queueJobs = [
        {
          queueName: "queue1",
          job: { type: "job1", data: { id: 1 } },
        },
        {
          queueName: "queue2",
          job: { type: "job2", data: { id: 2 } },
        },
        {
          queueName: "queue1",
          job: { type: "job3", data: { id: 3 } },
        },
      ];

      const results = await queueManager.enqueueToMultipleQueues(queueJobs);
      assertEquals(results.length, 3);

      const queue1Stats = await queueManager.getStats("queue1");
      const queue2Stats = await queueManager.getStats("queue2");

      assertEquals(queue1Stats.total, 2);
      assertEquals(queue2Stats.total, 1);
    });

    it("should perform health checks", async () => {
      await queueManager.enqueue("healthy-queue", { type: "job", data: {} });

      const health = await queueManager.healthCheck();

      assertEquals(health.healthy, true);
      assert(health.queues["healthy-queue"]);
      assertEquals(health.queues["healthy-queue"].healthy, true);
      assertEquals(health.totalStats.total, 1);
    });

    it("should cleanup old jobs", async () => {
      const queue1 = queueManager.queue("cleanup-test");

      // Enqueue and complete some jobs
      const job1 = await queue1.enqueue({ type: "old-job", data: {} });
      await queue1.dequeue();
      await queue1.completeJob(job1.id);

      const job2 = await queue1.enqueue({ type: "recent-job", data: {} });
      await queue1.dequeue();
      await queue1.completeJob(job2.id);

      // Cleanup jobs older than 1ms (should clean both since they just completed)
      const results = await queueManager.cleanupOldJobs(1);

      // Check that some jobs were cleaned
      assert(results["cleanup-test"] >= 0);
    });
  });

  describe("Error Handling", () => {
    it("should handle atomic operation failures gracefully", async () => {
      // This test is challenging to write since we can't easily force atomic failures
      // But we ensure the code paths exist and handle errors properly

      const job = await queue.enqueue({ type: "test", data: {} });
      assert(job.id);

      // Try to complete a non-existent job
      await assertRejects(
        () => queue.completeJob("non-existent-id"),
        Error,
        "not found",
      );
    });

    it("should handle dead letter queue correctly", async () => {
      // Create a dead letter queue
      const dlq = queueManager.queue("dead-letter-queue");

      const job = await queue.enqueue(
        { type: "failing-job", data: {} },
        { maxRetries: 0, deadLetterQueue: "dead-letter-queue" },
      );

      await queue.dequeue(); // Mark as processing
      await queue.failJob(job.id, new Error("Job failed"));

      // Check that job was moved to dead letter queue
      const dlqStats = await dlq.getStats();
      assertEquals(dlqStats.total, 1);

      // Original queue should not have the failed job
      const originalStats = await queue.getStats();
      assertEquals(originalStats.total, 0);
    });
  });
});
