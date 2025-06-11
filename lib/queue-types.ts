// Queue System Types for KVM

export interface QueueJob<TData = any> {
  id: string;
  type: string;
  data: TData;
  priority?: number;
  delay?: number;
  maxRetries?: number;
  retryCount?: number;
  retryDelay?: number;
  createdAt: Date;
  scheduledAt?: Date;
  processedAt?: Date;
  completedAt?: Date;
  failedAt?: Date;
  error?: string;
  deadLetterQueue?: string;
}

export interface QueueOptions {
  maxRetries?: number;
  retryDelay?: number;
  deadLetterQueue?: string;
  priority?: number;
  delay?: number;
  atomic?: boolean;
}

export interface EnqueueOptions extends QueueOptions {
  // Additional options for enqueue operations
}

export interface WorkerOptions {
  concurrency?: number;
  maxRetries?: number;
  retryDelay?: number;
  pollInterval?: number;
  timeout?: number;
  autoStart?: boolean;
  onError?: (error: Error, job: QueueJob) => Promise<void> | void;
  onJobComplete?: (job: QueueJob, result?: any) => Promise<void> | void;
  onJobFailed?: (job: QueueJob, error: Error) => Promise<void> | void;
  onJobRetry?: (job: QueueJob, error: Error) => Promise<void> | void;
}

export interface QueueStats {
  pending: number;
  processing: number;
  completed: number;
  failed: number;
  delayed: number;
  total: number;
}

export interface JobProcessor<TData = any, TResult = any> {
  (job: QueueJob<TData>): Promise<TResult> | TResult;
}

export interface QueueManager {
  enqueue<TData>(
    queueName: string,
    job: Omit<QueueJob<TData>, "id" | "createdAt" | "retryCount">,
    options?: EnqueueOptions,
  ): Promise<QueueJob<TData>>;

  enqueueMany<TData>(
    queueName: string,
    jobs: Array<Omit<QueueJob<TData>, "id" | "createdAt" | "retryCount">>,
    options?: EnqueueOptions,
  ): Promise<QueueJob<TData>[]>;

  dequeue(queueName: string): Promise<QueueJob | null>;

  getJob(queueName: string, jobId: string): Promise<QueueJob | null>;

  getJobs(
    queueName: string,
    status?: JobStatus[],
    limit?: number,
    offset?: number,
  ): Promise<QueueJob[]>;

  getStats(queueName: string): Promise<QueueStats>;

  removeJob(queueName: string, jobId: string): Promise<boolean>;

  clearQueue(queueName: string, status?: JobStatus[]): Promise<number>;

  createWorker<TData, TResult>(
    queueName: string,
    processor: JobProcessor<TData, TResult>,
    options?: WorkerOptions,
  ): QueueWorker<TData, TResult>;
}

export type JobStatus =
  | "pending"
  | "processing"
  | "completed"
  | "failed"
  | "delayed"
  | "retrying";

export interface QueueWorker<TData = any, TResult = any> {
  start(): Promise<void>;
  stop(): Promise<void>;
  pause(): Promise<void>;
  resume(): Promise<void>;
  isRunning(): boolean;
  isPaused(): boolean;
  getStats(): {
    processed: number;
    failed: number;
    active: number;
  };
  on(event: string, listener: (...args: any[]) => void): void;
  off(event: string, listener: (...args: any[]) => void): void;
}

export interface Queue<TData = any> {
  name: string;

  enqueue(
    job: Omit<QueueJob<TData>, "id" | "createdAt" | "retryCount">,
    options?: EnqueueOptions,
  ): Promise<QueueJob<TData>>;

  enqueueMany(
    jobs: Array<Omit<QueueJob<TData>, "id" | "createdAt" | "retryCount">>,
    options?: EnqueueOptions,
  ): Promise<QueueJob<TData>[]>;

  dequeue(): Promise<QueueJob<TData> | null>;

  getJob(jobId: string): Promise<QueueJob<TData> | null>;

  getJobs(
    status?: JobStatus[],
    limit?: number,
    offset?: number,
  ): Promise<QueueJob<TData>[]>;

  getStats(): Promise<QueueStats>;

  removeJob(jobId: string): Promise<boolean>;

  clear(status?: JobStatus[]): Promise<number>;

  createWorker<TResult>(
    processor: JobProcessor<TData, TResult>,
    options?: WorkerOptions,
  ): QueueWorker<TData, TResult>;

  // Utility methods
  atomicEnqueue(
    jobs: Array<Omit<QueueJob<TData>, "id" | "createdAt" | "retryCount">>,
    options?: EnqueueOptions,
  ): Promise<QueueJob<TData>[]>;

  // Job completion methods (used by workers)
  completeJob(jobId: string, result?: any): Promise<void>;
  failJob(jobId: string, error: Error): Promise<void>;
}

// Error types
export class QueueError extends Error {
  constructor(
    message: string,
    public queueName?: string,
    public jobId?: string,
  ) {
    super(message);
    this.name = "QueueError";
  }
}

export class JobNotFoundError extends QueueError {
  constructor(queueName: string, jobId: string) {
    super(`Job ${jobId} not found in queue ${queueName}`, queueName, jobId);
    this.name = "JobNotFoundError";
  }
}

export class QueueNotFoundError extends QueueError {
  constructor(queueName: string) {
    super(`Queue ${queueName} not found`, queueName);
    this.name = "QueueNotFoundError";
  }
}

export class JobProcessingError extends QueueError {
  constructor(
    message: string,
    queueName: string,
    jobId: string,
    public originalError?: Error,
  ) {
    super(message, queueName, jobId);
    this.name = "JobProcessingError";
  }
}
