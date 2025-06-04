import type { FindManyOptions, KVMEntity } from "./types.ts";
import type { QueryBuilder, WhereClause } from "./query-types.ts";

/**
 * Options for watching individual records
 */
export type WatchOptions = {
  /** Whether to include deleted entries (null values) in the stream */
  includeDeleted?: boolean;
  /** Whether to emit raw stream events (may include duplicates) */
  raw?: boolean;
};

/**
 * Options for watching multiple records with queries
 */
export type WatchManyOptions = WatchOptions & {
  /** Filter conditions for which records to watch */
  where?: WhereClause<any>;
  /** Maximum number of records to watch simultaneously */
  limit?: number;
  /** Prefix to filter by */
  prefix?: Deno.KvKey;
  /** Whether to watch all matching records or just specific ones */
  watchAll?: boolean;
};

/**
 * Options for watching relations
 */
export type WatchRelationOptions = WatchOptions & {
  /** Name of the relation to watch */
  relation: string;
  /** Whether to include related entity changes */
  includeRelated?: boolean;
  /** Depth of nested relation watching */
  depth?: number;
};

/**
 * Represents a change event from the watch stream
 */
export type WatchEvent<T = any> = {
  /** The type of change that occurred */
  type: WatchEventType;
  /** The key that changed */
  key: Deno.KvKey;
  /** The current value (null if deleted) */
  value: T | null;
  /** The previous value (if available) */
  previousValue?: T | null;
  /** The versionstamp of the change */
  versionstamp: string | null;
  /** Timestamp when the change was detected */
  timestamp: Date;
  /** The model name this change belongs to */
  modelName: string;
};

/**
 * Types of watch events
 */
export enum WatchEventType {
  CREATED = "created",
  UPDATED = "updated",
  DELETED = "deleted",
  INITIAL = "initial", // Initial value when starting to watch
}

/**
 * Watch stream that can be consumed with async iteration
 */
export type WatchStream<T = any> = ReadableStream<WatchEvent<T>>;

/**
 * Options for Server-Sent Events integration
 */
export type SSEOptions = {
  /** Custom event name */
  eventName?: string;
  /** Whether to include metadata in events */
  includeMetadata?: boolean;
  /** Custom serializer for data */
  serializer?: (event: WatchEvent) => string;
  /** Heartbeat interval in milliseconds */
  heartbeatInterval?: number;
};

/**
 * Options for WebSocket integration
 */
export type WebSocketOptions = {
  /** Custom message type */
  messageType?: string;
  /** Whether to include metadata in messages */
  includeMetadata?: boolean;
  /** Custom serializer for messages */
  serializer?: (event: WatchEvent) => string;
  /** Whether to send ping/pong for connection health */
  enablePing?: boolean;
  /** Ping interval in milliseconds */
  pingInterval?: number;
};

/**
 * Function type for watch event callbacks
 */
export type WatchCallback<T = any> = (
  event: WatchEvent<T>,
) => void | Promise<void>;

/**
 * Watch result that includes both stream and control methods
 */
export type WatchResult<T = any> = {
  /** The watch stream for async iteration */
  stream: WatchStream<T>;
  /** Method to stop watching */
  stop: () => void;
  /** Method to add event callbacks */
  on: (callback: WatchCallback<T>) => () => void;
  /** Method to convert to Server-Sent Events response */
  toSSE: (options?: SSEOptions) => Response;
  /** Method to handle WebSocket connections */
  toWebSocket: (options?: WebSocketOptions) => (socket: WebSocket) => void;
};

/**
 * Internal watch state management
 */
export type WatchState = {
  /** Whether the watch is active */
  active: boolean;
  /** List of registered callbacks */
  callbacks: WatchCallback[];
  /** Controller for stopping the stream */
  controller?: ReadableStreamDefaultController;
  /** Abort controller for cleanup */
  abortController?: AbortController;
};

/**
 * Batch watch options for monitoring multiple entities
 */
export type BatchWatchOptions = {
  /** Map of entity names to their watch options */
  entities: Record<string, WatchManyOptions>;
  /** Global options applied to all entities */
  global?: WatchOptions;
  /** Maximum total number of keys to watch */
  maxKeys?: number;
};

/**
 * Multi-entity watch event
 */
export type BatchWatchEvent = {
  /** The entity that changed */
  entityName: string;
  /** The specific watch event */
  event: WatchEvent;
};
