/**
 * Types and interfaces for the KVM migration system
 */

import type { KVMEntity } from "./types.ts";

/**
 * A single migration definition
 */
export interface Migration {
  /**
   * Unique version number for this migration
   */
  version: number;

  /**
   * Human-readable description of what this migration does
   */
  description: string;

  /**
   * Function to apply the migration (forward)
   */
  up: (kv: Deno.Kv, utils: MigrationUtils) => Promise<void>;

  /**
   * Function to reverse the migration (backward)
   */
  down: (kv: Deno.Kv, utils: MigrationUtils) => Promise<void>;

  /**
   * Optional timestamp when this migration was created
   */
  createdAt?: Date;

  /**
   * Optional list of entities this migration affects
   */
  affectedEntities?: string[];
}

/**
 * Options for running migrations
 */
export interface MigrationOptions {
  /**
   * Run migrations up to this version (inclusive)
   * If not specified, runs all pending migrations
   */
  toVersion?: number;

  /**
   * If true, continue running remaining migrations even if one fails
   * @default false
   */
  continueOnError?: boolean;

  /**
   * If true, perform a dry run without actually applying changes
   * @default false
   */
  dryRun?: boolean;

  /**
   * Directory path where migration files are located, or array of migrations
   * @default "./migrations"
   */
  migrationsPath?: string | Migration[];

  /**
   * Function called before each migration is executed
   */
  onBeforeMigration?: (migration: Migration) => void | Promise<void>;

  /**
   * Function called after each migration is executed
   */
  onAfterMigration?: (
    migration: Migration,
    result: MigrationExecutionResult,
  ) => void | Promise<void>;
}

/**
 * Result of running migrations
 */
export interface MigrationResult {
  /**
   * Whether the migration operation was successful
   */
  success: boolean;

  /**
   * Version before running migrations
   */
  previousVersion: number;

  /**
   * Current version after running migrations
   */
  currentVersion: number;

  /**
   * List of migrations that were executed
   */
  executedMigrations: MigrationExecutionResult[];

  /**
   * List of migrations that failed to execute
   */
  failedMigrations: MigrationExecutionResult[];

  /**
   * Total time taken to run all migrations
   */
  totalDuration: number;

  /**
   * Any errors that occurred during migration
   */
  errors: Error[];
}

/**
 * Result of executing a single migration
 */
export interface MigrationExecutionResult {
  /**
   * The migration that was executed
   */
  migration: Migration;

  /**
   * Whether the migration succeeded
   */
  success: boolean;

  /**
   * Direction of the migration (up or down)
   */
  direction: "up" | "down";

  /**
   * Time taken to execute this migration in milliseconds
   */
  duration: number;

  /**
   * Timestamp when the migration was executed
   */
  executedAt: Date;

  /**
   * Error that occurred during execution, if any
   */
  error?: Error;

  /**
   * Any additional metadata about the execution
   */
  metadata?: Record<string, any>;
}

/**
 * Current migration status
 */
export interface MigrationStatus {
  /**
   * Current schema version
   */
  currentVersion: number;

  /**
   * List of all available migrations
   */
  availableMigrations: Migration[];

  /**
   * List of migrations that have been applied
   */
  appliedMigrations: AppliedMigration[];

  /**
   * List of migrations that are pending (not yet applied)
   */
  pendingMigrations: Migration[];

  /**
   * Whether the database is up to date
   */
  isUpToDate: boolean;

  /**
   * Last migration execution result
   */
  lastMigration?: MigrationExecutionResult;
}

/**
 * Record of an applied migration stored in the database
 */
export interface AppliedMigration {
  /**
   * Migration version
   */
  version: number;

  /**
   * Migration description
   */
  description: string;

  /**
   * When the migration was applied
   */
  appliedAt: Date;

  /**
   * How long the migration took to run
   */
  duration: number;

  /**
   * Checksum of the migration file to detect changes
   */
  checksum?: string;
}

/**
 * Utility functions available to migrations
 */
export interface MigrationUtils {
  /**
   * Add a new field to all records of an entity
   */
  addField(
    entityName: string,
    fieldName: string,
    defaultValue: any,
  ): Promise<void>;

  /**
   * Remove a field from all records of an entity
   */
  removeField(entityName: string, fieldName: string): Promise<void>;

  /**
   * Rename a field in all records of an entity
   */
  renameField(
    entityName: string,
    oldName: string,
    newName: string,
  ): Promise<void>;

  /**
   * Transform a field value in all records of an entity
   */
  transformField(
    entityName: string,
    fieldName: string,
    transformer: (value: any, record: any) => any,
  ): Promise<void>;

  /**
   * Copy data from one entity to another
   */
  copyEntity(sourceEntity: string, targetEntity: string): Promise<void>;

  /**
   * Rename an entity (update all keys)
   */
  renameEntity(oldName: string, newName: string): Promise<void>;

  /**
   * Delete all records of an entity
   */
  truncateEntity(entityName: string): Promise<void>;

  /**
   * Get count of records in an entity
   */
  countRecords(entityName: string): Promise<number>;

  /**
   * Check if a field exists in entity records
   */
  fieldExists(entityName: string, fieldName: string): Promise<boolean>;

  /**
   * Batch process records with a custom function
   */
  batchProcess(
    entityName: string,
    processor: (
      records: Array<{ key: Deno.KvKey; value: any }>,
    ) => Promise<void>,
    batchSize?: number,
  ): Promise<void>;

  /**
   * Create a backup of an entity before migration
   */
  backupEntity(entityName: string, backupName?: string): Promise<string>;

  /**
   * Restore an entity from a backup
   */
  restoreEntity(entityName: string, backupName: string): Promise<void>;
}

/**
 * Configuration for migration storage
 */
export interface MigrationStorageConfig {
  /**
   * Key prefix for storing migration metadata
   * @default ["__migrations"]
   */
  keyPrefix?: Deno.KvKeyPart[];

  /**
   * Key for storing current schema version
   * @default ["__migrations", "version"]
   */
  versionKey?: Deno.KvKey;

  /**
   * Key prefix for storing applied migration records
   * @default ["__migrations", "applied"]
   */
  appliedMigrationsPrefix?: Deno.KvKey;
}

/**
 * Error thrown during migration operations
 */
export class MigrationError extends Error {
  constructor(
    message: string,
    public migration?: Migration,
    public originalError?: Error,
  ) {
    super(message);
    this.name = "MigrationError";
  }
}

/**
 * Error thrown when migrations are in an invalid state
 */
export class MigrationStateError extends Error {
  constructor(
    message: string,
    public currentVersion: number,
    public expectedVersion?: number,
  ) {
    super(message);
    this.name = "MigrationStateError";
  }
}
