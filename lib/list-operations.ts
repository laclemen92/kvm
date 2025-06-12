/**
 * Advanced list operations for KVM - enhanced querying with range queries and cursor pagination
 */

import type { KVMEntity } from "./types.ts";

/**
 * Options for advanced list operations
 */
export interface ListOptions {
  /** Start key for range queries */
  start?: Deno.KvKey;
  /** End key for range queries */
  end?: Deno.KvKey;
  /** Prefix for key filtering */
  prefix?: Deno.KvKey;
  /** Maximum number of records to return */
  limit?: number;
  /** Cursor for pagination */
  cursor?: string;
  /** Whether to return results in reverse order */
  reverse?: boolean;
  /** Consistency level for the operation */
  consistency?: "strong" | "eventual";
  /** Batch size for streaming operations */
  batchSize?: number;
}

/**
 * Options for date/time range queries
 */
export interface DateRangeOptions {
  /** Field name for date filtering */
  field: string;
  /** Start date/time */
  start?: string | Date | number;
  /** End date/time */
  end?: string | Date | number;
  /** Maximum number of records to return */
  limit?: number;
  /** Whether to return results in reverse order */
  reverse?: boolean;
  /** Consistency level for the operation */
  consistency?: "strong" | "eventual";
}

/**
 * Result of list operations with pagination metadata
 */
export interface ListResult<T> {
  /** Array of records */
  data: Deno.KvEntry<T>[];
  /** Cursor for next page (if available) */
  nextCursor?: string;
  /** Whether there are more results */
  hasMore: boolean;
  /** Total count of results in this batch */
  count: number;
}

/**
 * Advanced list operation with range queries and cursor pagination
 */
export async function list<T = unknown>(
  entity: KVMEntity,
  kv: Deno.Kv,
  options?: ListOptions,
): Promise<ListResult<T>> {
  const listOptions: Deno.KvListOptions = {
    limit: options?.limit || 100,
    reverse: options?.reverse || false,
    consistency: options?.consistency || "strong",
  };

  let selector: Deno.KvListSelector;

  if (options?.start && options?.end) {
    // Range query
    selector = {
      start: options.start,
      end: options.end,
    };
  } else if (options?.prefix) {
    // Prefix query
    selector = {
      prefix: options.prefix,
    };
  } else {
    // Default to entity prefix
    selector = {
      prefix: [entity.name],
    };
  }

  // Handle cursor-based pagination
  if (options?.cursor) {
    try {
      // If cursor is JSON, parse it back to the key and use it as start
      const parsedKey = JSON.parse(options.cursor);
      if (Array.isArray(parsedKey)) {
        // For cursor pagination, adjust the selector to start after the last key
        if ("prefix" in selector) {
          // Convert prefix query to range query to support cursor
          const prefix = selector.prefix;
          // Create a key that's just after the cursor key
          const nextKey = [...parsedKey];
          // Increment the last component to get the next possible key
          const lastIdx = nextKey.length - 1;
          if (typeof nextKey[lastIdx] === "string") {
            nextKey[lastIdx] = nextKey[lastIdx] + "\x00"; // Add null byte to get next string
          } else if (typeof nextKey[lastIdx] === "number") {
            nextKey[lastIdx] = nextKey[lastIdx] + 1;
          }

          selector = {
            start: nextKey,
            end: [...prefix, "\uFFFF"], // End at the end of the prefix range
          };
        } else if ("start" in selector && "end" in selector) {
          // For range queries, update the start to be after the last key
          selector.start = parsedKey;
        }
      }
    } catch {
      // Only use native Deno cursors if they're not our JSON format
      // For now, skip invalid cursors
    }
  }

  // Collect all results from the iterator
  const results = await Array.fromAsync(kv.list<T>(selector, listOptions));

  // Determine if there are more results and create cursor
  const requestedLimit = options?.limit || 100;
  const hasMoreResults = results.length === requestedLimit;

  let nextCursor: string | undefined;
  if (hasMoreResults && results.length > 0) {
    // Only provide cursor if we got exactly the limit (might have more)
    nextCursor = JSON.stringify(results[results.length - 1].key);
  }

  // If we have a batch size limit, only return that many
  const finalResults = options?.batchSize
    ? results.slice(0, options.batchSize)
    : results;

  return {
    data: finalResults,
    nextCursor,
    hasMore: hasMoreResults,
    count: finalResults.length,
  };
}

/**
 * List records within a specific key range
 */
export async function listRange<T = unknown>(
  entity: KVMEntity,
  kv: Deno.Kv,
  startKey: Deno.KvKey,
  endKey: Deno.KvKey,
  options?: Omit<ListOptions, "start" | "end">,
): Promise<ListResult<T>> {
  return await list<T>(entity, kv, {
    ...options,
    start: startKey,
    end: endKey,
  });
}

/**
 * List records with a specific prefix
 */
export async function listByPrefix<T = unknown>(
  entity: KVMEntity,
  kv: Deno.Kv,
  prefix: Deno.KvKey,
  options?: Omit<ListOptions, "prefix">,
): Promise<ListResult<T>> {
  return await list<T>(entity, kv, {
    ...options,
    prefix,
  });
}

/**
 * Helper function to create date-based range queries
 */
export async function listByDateRange<T = unknown>(
  entity: KVMEntity,
  kv: Deno.Kv,
  options: DateRangeOptions,
): Promise<ListResult<T>> {
  // Convert dates to ISO strings for lexicographic ordering
  let startDate: string | undefined;
  let endDate: string | undefined;

  if (options.start) {
    if (options.start instanceof Date) {
      startDate = options.start.toISOString();
    } else if (typeof options.start === "number") {
      startDate = new Date(options.start).toISOString();
    } else {
      startDate = options.start;
    }
  }

  if (options.end) {
    if (options.end instanceof Date) {
      endDate = options.end.toISOString();
    } else if (typeof options.end === "number") {
      endDate = new Date(options.end).toISOString();
    } else {
      endDate = options.end;
    }
  }

  // Build key range for date-based queries
  const startKey = startDate
    ? [entity.name, options.field, startDate]
    : [entity.name, options.field];
  const endKey = endDate
    ? [entity.name, options.field, endDate]
    : [entity.name, options.field, "\uFFFF"];

  return await listRange<T>(entity, kv, startKey, endKey, {
    limit: options.limit,
    reverse: options.reverse,
    consistency: options.consistency,
  });
}

/**
 * Stream results for large datasets with automatic batching
 */
export async function* listStream<T = unknown>(
  entity: KVMEntity,
  kv: Deno.Kv,
  options?: ListOptions,
): AsyncGenerator<Deno.KvEntry<T>, void, unknown> {
  let cursor: string | undefined;
  let hasMore = true;
  const batchSize = options?.batchSize || 100;

  while (hasMore) {
    const result = await list<T>(entity, kv, {
      ...options,
      cursor,
      limit: batchSize,
    });

    for (const entry of result.data) {
      yield entry;
    }

    cursor = result.nextCursor;
    hasMore = result.hasMore;
  }
}

/**
 * Count records matching the given criteria
 */
export async function count(
  entity: KVMEntity,
  kv: Deno.Kv,
  options?: Omit<ListOptions, "limit" | "cursor">,
): Promise<number> {
  // Use list operation with no limit to count all matching records
  const result = await list(entity, kv, {
    ...options,
    limit: Number.MAX_SAFE_INTEGER, // Get all records
  });

  return result.data.length;
}

/**
 * Get paginated results with metadata
 */
export interface PaginationOptions {
  /** Page number (1-based) */
  page?: number;
  /** Number of items per page */
  pageSize?: number;
  /** Cursor-based pagination cursor */
  cursor?: string;
  /** Additional list options */
  listOptions?: Omit<ListOptions, "limit" | "cursor">;
}

export interface PaginatedResult<T> {
  /** Current page data */
  data: Deno.KvEntry<T>[];
  /** Pagination metadata */
  pagination: {
    page: number;
    pageSize: number;
    hasNextPage: boolean;
    hasPreviousPage: boolean;
    nextCursor?: string;
    totalInBatch: number;
  };
}

/**
 * Get paginated results with helpful metadata
 */
export async function paginate<T = unknown>(
  entity: KVMEntity,
  kv: Deno.Kv,
  options?: PaginationOptions,
): Promise<PaginatedResult<T>> {
  const page = options?.page || 1;
  const pageSize = options?.pageSize || 20;

  // For cursor-based pagination, ignore page parameter
  if (options?.cursor) {
    const result = await list<T>(entity, kv, {
      ...options.listOptions,
      cursor: options.cursor,
      limit: pageSize,
    });

    return {
      data: result.data,
      pagination: {
        page: 1, // Not meaningful for cursor-based pagination
        pageSize,
        hasNextPage: result.hasMore,
        hasPreviousPage: false, // Can't determine with cursor pagination
        nextCursor: result.nextCursor,
        totalInBatch: result.count,
      },
    };
  }

  // Offset-based pagination (less efficient but more familiar)
  const skip = (page - 1) * pageSize;

  // For offset-based pagination, we need to get enough records to skip + pageSize + 1
  // to determine if there's a next page
  const result = await list<T>(entity, kv, {
    ...options?.listOptions,
    limit: skip + pageSize + 1, // Get enough records to skip and check if more exist
  });

  // Skip the first `skip` items
  const paginatedData = result.data.slice(skip, skip + pageSize);
  const hasNextPage = result.data.length > skip + pageSize;

  // Provide cursor for next page if there are more results
  let nextCursor: string | undefined;
  if (hasNextPage && paginatedData.length > 0) {
    nextCursor = JSON.stringify(paginatedData[paginatedData.length - 1].key);
  }

  return {
    data: paginatedData,
    pagination: {
      page,
      pageSize,
      hasNextPage,
      hasPreviousPage: page > 1,
      nextCursor,
      totalInBatch: paginatedData.length,
    },
  };
}

/**
 * Utility functions for common key patterns
 */
export const KeyUtils = {
  /**
   * Create a key for date-based indexing
   */
  dateKey(
    entityName: string,
    field: string,
    date: Date | string | number,
  ): Deno.KvKey {
    const dateStr = date instanceof Date
      ? date.toISOString()
      : typeof date === "number"
      ? new Date(date).toISOString()
      : date;

    return [entityName, field, dateStr];
  },

  /**
   * Create a key range for date queries
   */
  dateRange(
    entityName: string,
    field: string,
    start?: Date | string | number,
    end?: Date | string | number,
  ): { start: Deno.KvKey; end: Deno.KvKey } {
    const startKey = start
      ? this.dateKey(entityName, field, start)
      : [entityName, field, ""];

    const endKey = end
      ? this.dateKey(entityName, field, end)
      : [entityName, field, "\uFFFF"];

    return { start: startKey, end: endKey };
  },

  /**
   * Create a key for hierarchical data
   */
  hierarchicalKey(
    entityName: string,
    ...parts: (string | number)[]
  ): Deno.KvKey {
    return [entityName, ...parts];
  },

  /**
   * Create a key for user-specific data
   */
  userKey(
    entityName: string,
    userId: string,
    ...additionalParts: (string | number)[]
  ): Deno.KvKey {
    return [entityName, "by_user", userId, ...additionalParts];
  },
};
