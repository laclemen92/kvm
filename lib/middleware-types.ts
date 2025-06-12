/**
 * Type definitions for middleware/hooks system
 */

import type { ModelDocument } from "./model-types.ts";

/**
 * Available hook types for different lifecycle events
 */
export type HookType =
  | "validate" // Before validation
  | "create" // Before/after document creation
  | "update" // Before/after document update
  | "upsert" // Before/after upsert operations
  | "upsertMany" // Before/after batch upsert operations
  | "save" // Before/after save (create or update)
  | "delete" // Before/after document deletion
  | "find" // Before/after find operations
  | "findOne" // Before/after findOne operations
  | "init"; // After document initialization

/**
 * Hook timing - whether to run before or after the operation
 */
export type HookTiming = "pre" | "post";

/**
 * Context passed to hooks with operation details
 */
export interface HookContext<T = unknown> {
  /** The model name */
  modelName: string;
  /** The operation type */
  operation: HookType;
  /** The document being operated on (may be undefined for pre-create) */
  document?: ModelDocument<T> & T;
  /** The input data for create/update operations */
  input?: Partial<T> | unknown;
  /** Query conditions for find operations */
  conditions?: Record<string, unknown>;
  /** Additional options passed to the operation */
  options?: Record<string, unknown>;
  /** Whether this hook is running in a transaction */
  isTransaction?: boolean;
}

/**
 * Pre-hook function signature
 * Pre-hooks can modify the document/input and call next() to continue
 */
export type PreHookFunction<T = unknown> = (
  this: (ModelDocument<T> & T) | undefined,
  context: HookContext<T>,
  next: (error?: Error) => void,
) => void | Promise<void>;

/**
 * Post-hook function signature
 * Post-hooks receive the final document and cannot modify the operation
 */
export type PostHookFunction<T = unknown> = (
  this: (ModelDocument<T> & T) | undefined,
  context: HookContext<T>,
  result: unknown,
) => void | Promise<void>;

/**
 * Hook function - can be either pre or post
 */
export type HookFunction<T = unknown> =
  | PreHookFunction<T>
  | PostHookFunction<T>;

/**
 * Hook registration options
 */
export interface HookOptions {
  /** Priority for hook execution order (higher runs first) */
  priority?: number;
  /** Whether this hook should run in parallel with others */
  parallel?: boolean;
  /** Maximum execution time in milliseconds */
  timeout?: number;
  /** Tags for organizing and filtering hooks */
  tags?: string[];
  /** Whether this hook is enabled */
  enabled?: boolean;
}

/**
 * Registered hook with metadata
 */
export interface RegisteredHook<T = unknown> {
  /** The hook function */
  fn: HookFunction<T>;
  /** Hook timing */
  timing: HookTiming;
  /** Hook type */
  type: HookType;
  /** Hook options */
  options: HookOptions;
  /** Unique identifier for the hook */
  id: string;
}

/**
 * Hook execution result
 */
export interface HookExecutionResult {
  /** Whether all hooks executed successfully */
  success: boolean;
  /** Errors that occurred during hook execution */
  errors: Error[];
  /** Time taken to execute hooks in milliseconds */
  duration: number;
  /** Number of hooks that were executed */
  executed: number;
  /** Number of hooks that were skipped */
  skipped: number;
}

/**
 * Hook manager interface for registering and executing hooks
 */
export interface HookManager<T = unknown> {
  /** Register a pre-hook */
  pre(type: HookType, fn: PreHookFunction<T>, options?: HookOptions): void;

  /** Register a post-hook */
  post(type: HookType, fn: PostHookFunction<T>, options?: HookOptions): void;

  /** Remove a hook by ID */
  removeHook(id: string): boolean;

  /** Remove all hooks of a specific type */
  removeHooks(type: HookType, timing?: HookTiming): number;

  /** Get all registered hooks */
  getHooks(type?: HookType, timing?: HookTiming): RegisteredHook<T>[];

  /** Execute pre-hooks for a given operation */
  executePreHooks(
    type: HookType,
    context: HookContext<T>,
    document?: ModelDocument<T> & T,
  ): Promise<HookExecutionResult>;

  /** Execute post-hooks for a given operation */
  executePostHooks(
    type: HookType,
    context: HookContext<T>,
    result: unknown,
    document?: ModelDocument<T> & T,
  ): Promise<HookExecutionResult>;

  /** Clear all hooks */
  clearHooks(): void;

  /** Enable/disable hooks globally */
  setEnabled(enabled: boolean): void;

  /** Check if hooks are enabled */
  isEnabled(): boolean;
}

/**
 * Plugin interface for extending models with reusable functionality
 */
export interface Plugin<T = unknown> {
  /** Plugin name */
  name: string;
  /** Plugin version */
  version?: string;
  /** Install the plugin on a model */
  install(hooks: HookManager<T>, options?: Record<string, unknown>): void;
  /** Uninstall the plugin from a model */
  uninstall?(hooks: HookManager<T>): void;
}

/**
 * Built-in plugin options
 */
export interface TimestampPluginOptions {
  /** Field name for creation timestamp */
  createdAt?: string;
  /** Field name for update timestamp */
  updatedAt?: string;
  /** Whether to add timestamps automatically */
  addFields?: boolean;
}

export interface AuditPluginOptions {
  /** Function to get current user ID */
  getCurrentUser?: () => string | Promise<string>;
  /** Field name for created by */
  createdBy?: string;
  /** Field name for updated by */
  updatedBy?: string;
  /** Whether to track user information */
  trackUser?: boolean;
}

export interface ValidationPluginOptions {
  /** Custom validation rules */
  rules?: Record<
    string,
    (value: unknown, document: unknown) => boolean | Promise<boolean>
  >;
  /** Whether to stop on first validation error */
  stopOnFirstError?: boolean;
}

/**
 * Hook execution error with additional context
 */
export class HookExecutionError extends Error {
  override readonly name = "HookExecutionError";

  constructor(
    public readonly hookId: string,
    public readonly hookType: HookType,
    public readonly timing: HookTiming,
    public readonly originalError: Error,
    public readonly context: HookContext,
  ) {
    super(
      `Hook execution failed: ${hookId} (${timing}:${hookType}) - ${originalError.message}`,
    );
  }
}

/**
 * Hook timeout error
 */
export class HookTimeoutError extends Error {
  override readonly name = "HookTimeoutError";

  constructor(
    public readonly hookId: string,
    public readonly timeout: number,
  ) {
    super(`Hook execution timed out after ${timeout}ms: ${hookId}`);
  }
}

/**
 * Utility type for hook function type checking
 */
export type IsPreHook<T> = T extends PreHookFunction<unknown> ? true : false;
export type IsPostHook<T> = T extends PostHookFunction<unknown> ? true : false;
