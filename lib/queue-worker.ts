// Queue Worker Implementation for KVM

import type {
  JobProcessor,
  QueueJob,
  QueueWorker,
  WorkerOptions,
} from "./queue-types.ts";
import { JobProcessingError } from "./queue-types.ts";
import type { KVMQueue } from "./queue.ts";

export class QueueWorkerImpl<TData = any, TResult = any>
  implements QueueWorker<TData, TResult> {
  private _isRunning = false;
  private _isPaused = false;
  private _activeJobs = 0;
  private _processedCount = 0;
  private _failedCount = 0;
  private _pollingTimer: number | null = null;
  private _jobTimeouts = new Map<string, number>();
  private _eventListeners = new Map<string, Array<(...args: any[]) => void>>();

  constructor(
    private readonly queue: KVMQueue<TData>,
    private readonly processor: JobProcessor<TData, TResult>,
    private readonly options: WorkerOptions = {},
  ) {
    // Set default options
    this.options = {
      concurrency: 1,
      maxRetries: 3,
      retryDelay: 1000,
      pollInterval: 1000,
      timeout: 30000,
      autoStart: false,
      ...options,
    };
  }

  async start(): Promise<void> {
    if (this._isRunning) return;

    this._isRunning = true;
    this._isPaused = false;

    this.emit("worker:started", this.queue.name);

    // Start polling for jobs
    this._startPolling();
  }

  async stop(): Promise<void> {
    if (!this._isRunning) return;

    this._isRunning = false;

    // Stop polling
    if (this._pollingTimer !== null) {
      clearTimeout(this._pollingTimer);
      this._pollingTimer = null;
    }

    // Wait for active jobs to complete (with timeout)
    const maxWaitTime = 30000; // 30 seconds
    const startTime = Date.now();

    while (this._activeJobs > 0 && (Date.now() - startTime) < maxWaitTime) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    // Clear any remaining job timeouts
    for (const timeoutId of this._jobTimeouts.values()) {
      clearTimeout(timeoutId);
    }
    this._jobTimeouts.clear();

    this.emit("worker:stopped", this.queue.name);
  }

  async pause(): Promise<void> {
    this._isPaused = true;
    this.emit("worker:paused", this.queue.name);
  }

  async resume(): Promise<void> {
    if (!this._isRunning) {
      await this.start();
      return;
    }

    this._isPaused = false;
    this.emit("worker:resumed", this.queue.name);

    // Resume polling
    this._startPolling();
  }

  isRunning(): boolean {
    return this._isRunning;
  }

  isPaused(): boolean {
    return this._isPaused;
  }

  getStats() {
    return {
      processed: this._processedCount,
      failed: this._failedCount,
      active: this._activeJobs,
    };
  }

  on(event: string, listener: (...args: any[]) => void): void {
    if (!this._eventListeners.has(event)) {
      this._eventListeners.set(event, []);
    }
    this._eventListeners.get(event)!.push(listener);
  }

  off(event: string, listener: (...args: any[]) => void): void {
    const listeners = this._eventListeners.get(event);
    if (listeners) {
      const index = listeners.indexOf(listener);
      if (index > -1) {
        listeners.splice(index, 1);
      }
    }
  }

  private emit(event: string, ...args: any[]): void {
    const listeners = this._eventListeners.get(event);
    if (listeners) {
      for (const listener of listeners) {
        try {
          listener(...args);
        } catch (error) {
          console.error(`Error in event listener for ${event}:`, error);
        }
      }
    }
  }

  private _startPolling(): void {
    if (!this._isRunning || this._isPaused) return;

    this._pollingTimer = setTimeout(async () => {
      await this._pollForJobs();
      this._startPolling(); // Schedule next poll
    }, this.options.pollInterval);
  }

  private async _pollForJobs(): Promise<void> {
    if (!this._isRunning || this._isPaused) return;

    // Check if we have capacity for more jobs
    const maxConcurrency = this.options.concurrency!;
    if (this._activeJobs >= maxConcurrency) return;

    try {
      // Try to get a job from the queue
      const job = await this.queue.dequeue();
      if (!job) return; // No jobs available

      // Process the job
      this._processJob(job);

      // If we still have capacity, try to get another job immediately
      if (this._activeJobs < maxConcurrency - 1) {
        setTimeout(() => this._pollForJobs(), 0);
      }
    } catch (error) {
      this.emit("worker:error", error);

      if (this.options.onError) {
        try {
          await this.options.onError(error as Error, null as any);
        } catch (handlerError) {
          console.error("Error in worker error handler:", handlerError);
        }
      }
    }
  }

  private async _processJob(job: QueueJob<TData>): Promise<void> {
    this._activeJobs++;

    // Set up job timeout
    let timeoutId: number | undefined;
    if (this.options.timeout && this.options.timeout > 0) {
      timeoutId = setTimeout(() => {
        this._handleJobTimeout(job);
      }, this.options.timeout);
      this._jobTimeouts.set(job.id, timeoutId);
    }

    try {
      this.emit("job:started", job);

      // Process the job
      const result = await this.processor(job);

      // Clear timeout
      if (timeoutId) {
        clearTimeout(timeoutId);
        this._jobTimeouts.delete(job.id);
      }

      // Mark job as completed
      await this.queue.completeJob(job.id, result);

      this._processedCount++;
      this.emit("job:completed", job, result);

      if (this.options.onJobComplete) {
        try {
          await this.options.onJobComplete(job, result);
        } catch (handlerError) {
          console.error("Error in job complete handler:", handlerError);
        }
      }
    } catch (error) {
      // Clear timeout
      if (timeoutId) {
        clearTimeout(timeoutId);
        this._jobTimeouts.delete(job.id);
      }

      await this._handleJobError(job, error as Error);
    } finally {
      this._activeJobs--;
    }
  }

  private async _handleJobError(
    job: QueueJob<TData>,
    error: Error,
  ): Promise<void> {
    this._failedCount++;

    const jobError = new JobProcessingError(
      `Job ${job.id} failed: ${error.message}`,
      this.queue.name,
      job.id,
      error,
    );

    try {
      // Let the queue handle retry logic
      await this.queue.failJob(job.id, error);

      this.emit("job:failed", job, jobError);

      if (this.options.onJobFailed) {
        try {
          await this.options.onJobFailed(job, jobError);
        } catch (handlerError) {
          console.error("Error in job failed handler:", handlerError);
        }
      }

      // Check if this is a retry
      if ((job.retryCount ?? 0) < (job.maxRetries ?? 3)) {
        this.emit("job:retry", job, jobError);

        if (this.options.onJobRetry) {
          try {
            await this.options.onJobRetry(job, jobError);
          } catch (handlerError) {
            console.error("Error in job retry handler:", handlerError);
          }
        }
      }
    } catch (queueError) {
      this.emit("worker:error", queueError);

      if (this.options.onError) {
        try {
          await this.options.onError(queueError as Error, job);
        } catch (handlerError) {
          console.error("Error in worker error handler:", handlerError);
        }
      }
    }
  }

  private async _handleJobTimeout(job: QueueJob<TData>): Promise<void> {
    const timeoutError = new Error(
      `Job ${job.id} timed out after ${this.options.timeout}ms`,
    );
    await this._handleJobError(job, timeoutError);
  }
}
