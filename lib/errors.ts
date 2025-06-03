/**
 * Base KVM error class that all other KVM errors extend
 */
export abstract class KVMError extends Error {
  abstract readonly code: string;

  constructor(message: string, public readonly context?: Record<string, any>) {
    super(message);
    this.name = this.constructor.name;

    // Maintain proper stack trace for where our error was thrown (only available on V8)
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor);
    }
  }

  /**
   * Convert error to a plain object for serialization
   */
  toJSON() {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      context: this.context,
      stack: this.stack,
    };
  }
}

/**
 * Thrown when data validation fails (e.g., Zod schema validation)
 */
export class KVMValidationError extends KVMError {
  readonly code = "KVM_VALIDATION_ERROR";

  constructor(
    public readonly field: string,
    public readonly value: any,
    public readonly rule: string,
    public readonly modelName?: string,
  ) {
    const modelPrefix = modelName ? `${modelName}: ` : "";
    super(
      `${modelPrefix}Validation failed for field '${field}': ${rule}`,
      {
        field,
        value,
        rule,
        modelName,
      },
    );
  }
}

/**
 * Thrown when a required record is not found
 */
export class KVMNotFoundError extends KVMError {
  readonly code = "KVM_NOT_FOUND_ERROR";

  constructor(
    public readonly modelName: string,
    public readonly identifier: string | Record<string, any>,
    public readonly searchType: "id" | "unique" | "first" | "query" = "id",
  ) {
    const identifierStr = typeof identifier === "string"
      ? identifier
      : JSON.stringify(identifier);

    super(
      `${modelName} not found${
        searchType !== "query" ? ` by ${searchType}` : ""
      }: ${identifierStr}`,
      {
        modelName,
        identifier,
        searchType,
      },
    );
  }
}

/**
 * Thrown when a database constraint is violated (e.g., unique constraint, foreign key)
 */
export class KVMConstraintError extends KVMError {
  readonly code = "KVM_CONSTRAINT_ERROR";

  constructor(
    public readonly constraintType:
      | "unique"
      | "foreign_key"
      | "check"
      | "not_null",
    public readonly field: string,
    public readonly value: any,
    public readonly modelName?: string,
  ) {
    const modelPrefix = modelName ? `${modelName}: ` : "";
    super(
      `${modelPrefix}Constraint violation (${constraintType}) on field '${field}' with value: ${value}`,
      {
        constraintType,
        field,
        value,
        modelName,
      },
    );
  }
}

/**
 * Thrown when an operation fails due to database/KV store issues
 */
export class KVMOperationError extends KVMError {
  readonly code = "KVM_OPERATION_ERROR";

  constructor(
    public readonly operation:
      | "create"
      | "read"
      | "update"
      | "delete"
      | "atomic",
    message: string,
    public readonly modelName?: string,
    public readonly originalError?: Error,
  ) {
    const modelPrefix = modelName ? `${modelName}: ` : "";
    super(
      `${modelPrefix}${operation} operation failed: ${message}`,
      {
        operation,
        modelName,
        originalError: originalError?.message,
      },
    );

    // Preserve the original error's stack if available
    if (originalError?.stack) {
      this.stack = originalError.stack;
    }
  }
}

/**
 * Thrown when there's a configuration or setup issue
 */
export class KVMConfigurationError extends KVMError {
  readonly code = "KVM_CONFIGURATION_ERROR";

  constructor(
    message: string,
    public readonly configPath?: string,
  ) {
    super(
      `Configuration error${configPath ? ` in ${configPath}` : ""}: ${message}`,
      {
        configPath,
      },
    );
  }
}

/**
 * Thrown when attempting an operation on a connection that's been closed
 */
export class KVMConnectionError extends KVMError {
  readonly code = "KVM_CONNECTION_ERROR";

  constructor(message: string = "KV connection is closed or unavailable") {
    super(message);
  }
}

/**
 * Thrown when there's a concurrency conflict (e.g., optimistic locking failure)
 */
export class KVMConcurrencyError extends KVMError {
  readonly code = "KVM_CONCURRENCY_ERROR";

  constructor(
    public readonly operation: string,
    public readonly modelName?: string,
    public readonly identifier?: string | Record<string, any>,
  ) {
    const modelPrefix = modelName ? `${modelName}: ` : "";
    const identifierStr = identifier
      ? ` (${
        typeof identifier === "string" ? identifier : JSON.stringify(identifier)
      })`
      : "";

    super(
      `${modelPrefix}Concurrency conflict during ${operation}${identifierStr}`,
      {
        operation,
        modelName,
        identifier,
      },
    );
  }
}

/**
 * Thrown when query syntax or parameters are invalid
 */
export class KVMQueryError extends KVMError {
  readonly code = "KVM_QUERY_ERROR";

  constructor(
    message: string,
    public readonly queryContext?: Record<string, any>,
  ) {
    super(`Query error: ${message}`, { queryContext });
  }
}

/**
 * Thrown when batch operations encounter validation errors
 */
export class KVMBatchValidationError extends KVMError {
  readonly code = "KVM_BATCH_VALIDATION_ERROR";

  constructor(
    public readonly results: {
      valid: any[];
      invalid: Array<{ data: any; errors: any[]; index: number }>;
      stats: { total: number; valid: number; invalid: number };
    },
    public readonly modelName?: string,
  ) {
    const modelPrefix = modelName ? `${modelName}: ` : "";
    super(
      `${modelPrefix}Batch validation failed: ${results.invalid.length} of ${results.stats.total} items invalid`,
      {
        validCount: results.stats.valid,
        invalidCount: results.stats.invalid,
        totalCount: results.stats.total,
        modelName,
      },
    );
  }
}

/**
 * Thrown when batch operations partially fail
 */
export class KVMBatchOperationError extends KVMError {
  readonly code = "KVM_BATCH_OPERATION_ERROR";

  constructor(
    public readonly operation: "create" | "update" | "delete",
    public readonly succeeded: number,
    public readonly failed: number,
    public readonly errors: Array<
      { data?: any; key?: any; error: Error; index: number }
    >,
    public readonly modelName?: string,
  ) {
    const modelPrefix = modelName ? `${modelName}: ` : "";
    super(
      `${modelPrefix}Batch ${operation} partially failed: ${succeeded} succeeded, ${failed} failed`,
      {
        operation,
        succeeded,
        failed,
        totalErrors: errors.length,
        modelName,
      },
    );
  }
}

/**
 * Utility functions for error handling
 */
export class KVMErrorUtils {
  /**
   * Check if an error is a KVM error
   */
  static isKVMError(error: any): error is KVMError {
    return error instanceof KVMError;
  }

  /**
   * Check if an error is a specific type of KVM error
   */
  static isValidationError(error: any): error is KVMValidationError {
    return error instanceof KVMValidationError;
  }

  static isNotFoundError(error: any): error is KVMNotFoundError {
    return error instanceof KVMNotFoundError;
  }

  static isConstraintError(error: any): error is KVMConstraintError {
    return error instanceof KVMConstraintError;
  }

  static isOperationError(error: any): error is KVMOperationError {
    return error instanceof KVMOperationError;
  }

  static isConfigurationError(error: any): error is KVMConfigurationError {
    return error instanceof KVMConfigurationError;
  }

  static isConnectionError(error: any): error is KVMConnectionError {
    return error instanceof KVMConnectionError;
  }

  static isConcurrencyError(error: any): error is KVMConcurrencyError {
    return error instanceof KVMConcurrencyError;
  }

  static isQueryError(error: any): error is KVMQueryError {
    return error instanceof KVMQueryError;
  }

  static isBatchValidationError(error: any): error is KVMBatchValidationError {
    return error instanceof KVMBatchValidationError;
  }

  static isBatchOperationError(error: any): error is KVMBatchOperationError {
    return error instanceof KVMBatchOperationError;
  }

  /**
   * Wrap a non-KVM error in a KVM error
   */
  static wrap(
    error: Error,
    operation: "create" | "read" | "update" | "delete" | "atomic",
    modelName?: string,
  ): KVMOperationError {
    if (KVMErrorUtils.isKVMError(error)) {
      return error as KVMOperationError;
    }

    return new KVMOperationError(operation, error.message, modelName, error);
  }

  /**
   * Create a validation error from a Zod error
   */
  static fromZodError(
    zodError: any,
    modelName?: string,
  ): KVMValidationError {
    if (zodError.errors && zodError.errors.length > 0) {
      const firstError = zodError.errors[0];
      const field = firstError.path?.join(".") || "unknown";
      const rule = firstError.message || "validation failed";
      const value = firstError.received;

      return new KVMValidationError(field, value, rule, modelName);
    }

    return new KVMValidationError(
      "unknown",
      undefined,
      zodError.message || "Schema validation failed",
      modelName,
    );
  }

  /**
   * Extract user-friendly error message
   */
  static getUserMessage(error: any): string {
    if (KVMErrorUtils.isKVMError(error)) {
      return error.message;
    }

    // Handle common non-KVM errors
    if (error.name === "ZodError") {
      return "Invalid data provided";
    }

    return "An unexpected error occurred";
  }

  /**
   * Check if error should be retried
   */
  static isRetryable(error: any): boolean {
    if (KVMErrorUtils.isConnectionError(error)) {
      return true;
    }

    if (KVMErrorUtils.isConcurrencyError(error)) {
      return true;
    }

    if (KVMErrorUtils.isOperationError(error)) {
      // Some operation errors might be transient
      return error.operation === "atomic";
    }

    return false;
  }
}
