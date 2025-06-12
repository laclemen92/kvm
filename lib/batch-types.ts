import type {
  CreateOptions,
  DeleteOptions,
  UpdateOptions,
} from "./model-types.ts";

/**
 * Options for batch create operations
 */
export interface BatchCreateOptions extends CreateOptions {
  /**
   * If true, all operations are performed in a single atomic transaction.
   * Either all succeed or all fail.
   * @default true
   */
  atomic?: boolean;

  /**
   * If true, continues processing even if some items fail validation.
   * Only applicable when atomic is false.
   * @default false
   */
  continueOnError?: boolean;

  /**
   * If true, returns partial results even if some operations fail.
   * Only applicable when atomic is false.
   * @default false
   */
  returnPartialResults?: boolean;

  /**
   * If true, validates all items before attempting any database operations.
   * @default true
   */
  validateBeforeWrite?: boolean;

  /**
   * Maximum number of items to process in a single batch.
   * Useful for very large datasets.
   */
  batchSize?: number;

  /**
   * Maximum number of retry attempts for failed operations.
   * @default 0
   */
  maxRetries?: number;

  /**
   * Delay between retry attempts in milliseconds.
   * @default 1000
   */
  retryDelay?: number;

  /**
   * If true, rolls back all successful operations if any operation fails.
   * Only applicable when atomic is false.
   * @default false
   */
  rollbackOnAnyFailure?: boolean;

  /**
   * Function to determine if an error should be retried.
   * If not provided, uses default retry logic.
   */
  shouldRetry?: (error: Error, attempt: number) => boolean;

  /**
   * Function called before each retry attempt.
   * Useful for logging or implementing exponential backoff.
   */
  onRetry?: (
    error: Error,
    attempt: number,
    data: unknown,
  ) => void | Promise<void>;
}

/**
 * Options for batch update operations
 */
export interface BatchUpdateOptions extends UpdateOptions {
  /**
   * If true, all operations are performed in a single atomic transaction.
   * @default true
   */
  atomic?: boolean;

  /**
   * If true, continues processing even if some items fail.
   * @default false
   */
  continueOnError?: boolean;

  /**
   * If true, returns partial results even if some operations fail.
   * @default false
   */
  returnPartialResults?: boolean;

  /**
   * Maximum number of items to process in a single batch.
   */
  batchSize?: number;

  /**
   * Maximum number of retry attempts for failed operations.
   * @default 0
   */
  maxRetries?: number;

  /**
   * Delay between retry attempts in milliseconds.
   * @default 1000
   */
  retryDelay?: number;

  /**
   * If true, rolls back all successful operations if any operation fails.
   * Only applicable when atomic is false.
   * @default false
   */
  rollbackOnAnyFailure?: boolean;

  /**
   * Function to determine if an error should be retried.
   */
  shouldRetry?: (error: Error, attempt: number) => boolean;

  /**
   * Function called before each retry attempt.
   */
  onRetry?: (
    error: Error,
    attempt: number,
    data: unknown,
  ) => void | Promise<void>;
}

/**
 * Options for batch delete operations
 */
export interface BatchDeleteOptions extends DeleteOptions {
  /**
   * If true, all operations are performed in a single atomic transaction.
   * @default true
   */
  atomic?: boolean;

  /**
   * If true, continues processing even if some items fail.
   * @default false
   */
  continueOnError?: boolean;

  /**
   * If true, returns information about deleted items.
   * @default false
   */
  returnDeletedItems?: boolean;

  /**
   * If true, returns partial results even if some operations fail.
   * @default false
   */
  returnPartialResults?: boolean;

  /**
   * Maximum number of items to process in a single batch.
   */
  batchSize?: number;

  /**
   * Maximum number of retry attempts for failed operations.
   * @default 0
   */
  maxRetries?: number;

  /**
   * Delay between retry attempts in milliseconds.
   * @default 1000
   */
  retryDelay?: number;

  /**
   * If true, rolls back all successful operations if any operation fails.
   * Only applicable when atomic is false.
   * @default false
   */
  rollbackOnAnyFailure?: boolean;

  /**
   * Function to determine if an error should be retried.
   */
  shouldRetry?: (error: Error, attempt: number) => boolean;

  /**
   * Function called before each retry attempt.
   */
  onRetry?: (
    error: Error,
    attempt: number,
    data: unknown,
  ) => void | Promise<void>;
}

/**
 * Individual item validation result
 */
export interface ValidationResult<T> {
  /**
   * The data that was validated
   */
  data: T;

  /**
   * Whether the data is valid
   */
  valid: boolean;

  /**
   * Validation errors if any
   */
  errors: Array<{
    field: string;
    message: string;
    rule: string;
    value?: unknown;
  }>;

  /**
   * Index in the original batch
   */
  index: number;
}

/**
 * Result of a batch validation operation
 */
export interface BatchValidationResult<T> {
  /**
   * Valid items that passed validation
   */
  valid: T[];

  /**
   * Invalid items with their validation errors
   */
  invalid: ValidationResult<T>[];

  /**
   * Summary statistics
   */
  stats: {
    total: number;
    valid: number;
    invalid: number;
  };
}

/**
 * Result of a batch create operation
 */
export interface BatchCreateResult<T> {
  /**
   * Successfully created items
   */
  created: T[];

  /**
   * Failed items with errors
   */
  failed: Array<{
    data: unknown;
    error: Error;
    index: number;
    retryCount?: number;
    finalAttempt?: boolean;
  }>;

  /**
   * Summary statistics
   */
  stats: {
    total: number;
    created: number;
    failed: number;
    retried: number;
    rolledBack: number;
  };
}

/**
 * Result of a batch update operation
 */
export interface BatchUpdateResult<T> {
  /**
   * Successfully updated items
   */
  updated: T[];

  /**
   * Items that were not found
   */
  notFound: Array<{
    key: unknown;
    index: number;
  }>;

  /**
   * Failed items with errors
   */
  failed: Array<{
    key: unknown;
    data: unknown;
    error: Error;
    index: number;
    retryCount?: number;
    finalAttempt?: boolean;
  }>;

  /**
   * Summary statistics
   */
  stats: {
    total: number;
    updated: number;
    notFound: number;
    failed: number;
    retried: number;
    rolledBack: number;
  };
}

/**
 * Result of a batch delete operation
 */
export interface BatchDeleteResult<T> {
  /**
   * Successfully deleted items (if returnDeletedItems is true)
   */
  deleted: T[];

  /**
   * Number of items deleted (always provided)
   */
  deletedCount: number;

  /**
   * Items that were not found
   */
  notFound: Array<{
    key: unknown;
    index: number;
  }>;

  /**
   * Failed items with errors
   */
  failed: Array<{
    key: unknown;
    error: Error;
    index: number;
    retryCount?: number;
    finalAttempt?: boolean;
  }>;

  /**
   * Summary statistics
   */
  stats: {
    total: number;
    deleted: number;
    notFound: number;
    failed: number;
    retried: number;
    rolledBack: number;
  };
}

/**
 * Input for batch update operations
 */
export interface BatchUpdateInput<T> {
  /**
   * The key to identify the record
   */
  key: string | Deno.KvKeyPart | Record<string, unknown>;

  /**
   * The data to update
   */
  data: Partial<T>;

  /**
   * Update-specific options
   */
  options?: UpdateOptions;
}

/**
 * Input for batch delete operations
 */
export interface BatchDeleteInput {
  /**
   * The key to identify the record
   */
  key: string | Deno.KvKeyPart | Record<string, unknown>;

  /**
   * Delete-specific options
   */
  options?: DeleteOptions;
}
