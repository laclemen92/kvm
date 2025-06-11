/**
 * Migration utility functions for common schema operations
 */

import type { MigrationUtils } from "./migration-types.ts";

/**
 * Concrete implementation of migration utilities
 */
export class KVMMigrationUtils implements MigrationUtils {
  constructor(private kv: Deno.Kv) {}

  /**
   * Add a new field to all records of an entity
   */
  async addField(
    entityName: string,
    fieldName: string,
    defaultValue: any,
  ): Promise<void> {
    await this.batchProcess(
      entityName,
      async (records) => {
        const atomic = this.kv.atomic();

        for (const record of records) {
          // Only add field if it doesn't exist
          if (
            record.value && typeof record.value === "object" &&
            !(fieldName in record.value)
          ) {
            atomic.set(record.key, {
              ...record.value,
              [fieldName]: defaultValue,
            });
          }
        }

        const result = await atomic.commit();
        if (!result.ok) {
          throw new Error(`Failed to add field ${fieldName} to ${entityName}`);
        }
      },
    );
  }

  /**
   * Remove a field from all records of an entity
   */
  async removeField(entityName: string, fieldName: string): Promise<void> {
    await this.batchProcess(
      entityName,
      async (records) => {
        const atomic = this.kv.atomic();

        for (const record of records) {
          if (
            record.value && typeof record.value === "object" &&
            fieldName in record.value
          ) {
            const { [fieldName]: removed, ...rest } = record.value;
            atomic.set(record.key, rest);
          }
        }

        const result = await atomic.commit();
        if (!result.ok) {
          throw new Error(
            `Failed to remove field ${fieldName} from ${entityName}`,
          );
        }
      },
    );
  }

  /**
   * Rename a field in all records of an entity
   */
  async renameField(
    entityName: string,
    oldName: string,
    newName: string,
  ): Promise<void> {
    await this.batchProcess(
      entityName,
      async (records) => {
        const atomic = this.kv.atomic();

        for (const record of records) {
          if (
            record.value && typeof record.value === "object" &&
            oldName in record.value
          ) {
            const { [oldName]: value, ...rest } = record.value;
            atomic.set(record.key, {
              ...rest,
              [newName]: value,
            });
          }
        }

        const result = await atomic.commit();
        if (!result.ok) {
          throw new Error(
            `Failed to rename field ${oldName} to ${newName} in ${entityName}`,
          );
        }
      },
    );
  }

  /**
   * Transform a field value in all records of an entity
   */
  async transformField(
    entityName: string,
    fieldName: string,
    transformer: (value: any, record: any) => any,
  ): Promise<void> {
    await this.batchProcess(
      entityName,
      async (records) => {
        const atomic = this.kv.atomic();

        for (const record of records) {
          if (
            record.value && typeof record.value === "object" &&
            fieldName in record.value
          ) {
            const transformedValue = transformer(
              record.value[fieldName],
              record.value,
            );
            atomic.set(record.key, {
              ...record.value,
              [fieldName]: transformedValue,
            });
          }
        }

        const result = await atomic.commit();
        if (!result.ok) {
          throw new Error(
            `Failed to transform field ${fieldName} in ${entityName}`,
          );
        }
      },
    );
  }

  /**
   * Copy data from one entity to another
   */
  async copyEntity(sourceEntity: string, targetEntity: string): Promise<void> {
    const sourceRecords: Array<{ key: Deno.KvKey; value: any }> = [];

    // Collect all source records
    for await (const entry of this.kv.list({ prefix: [sourceEntity] })) {
      sourceRecords.push({ key: entry.key, value: entry.value });
    }

    // Copy in batches
    await this.batchProcess(
      sourceEntity,
      async (records) => {
        const atomic = this.kv.atomic();

        for (const record of records) {
          // Create new key with target entity prefix
          const newKey = [targetEntity, ...record.key.slice(1)];
          atomic.set(newKey, record.value);
        }

        const result = await atomic.commit();
        if (!result.ok) {
          throw new Error(
            `Failed to copy from ${sourceEntity} to ${targetEntity}`,
          );
        }
      },
    );
  }

  /**
   * Rename an entity (update all keys)
   */
  async renameEntity(oldName: string, newName: string): Promise<void> {
    // First copy to new name
    await this.copyEntity(oldName, newName);

    // Then delete old entity
    await this.truncateEntity(oldName);
  }

  /**
   * Delete all records of an entity
   */
  async truncateEntity(entityName: string): Promise<void> {
    await this.batchProcess(
      entityName,
      async (records) => {
        const atomic = this.kv.atomic();

        for (const record of records) {
          atomic.delete(record.key);
        }

        const result = await atomic.commit();
        if (!result.ok) {
          throw new Error(`Failed to truncate entity ${entityName}`);
        }
      },
    );
  }

  /**
   * Get count of records in an entity
   */
  async countRecords(entityName: string): Promise<number> {
    let count = 0;
    for await (const _ of this.kv.list({ prefix: [entityName] })) {
      count++;
    }
    return count;
  }

  /**
   * Check if a field exists in entity records
   */
  async fieldExists(entityName: string, fieldName: string): Promise<boolean> {
    for await (const entry of this.kv.list({ prefix: [entityName] })) {
      if (entry.value && typeof entry.value === "object") {
        return fieldName in entry.value;
      }
    }
    return false;
  }

  /**
   * Batch process records with a custom function
   */
  async batchProcess(
    entityName: string,
    processor: (
      records: Array<{ key: Deno.KvKey; value: any }>,
    ) => Promise<void>,
    batchSize: number = 100,
  ): Promise<void> {
    let batch: Array<{ key: Deno.KvKey; value: any }> = [];

    for await (const entry of this.kv.list({ prefix: [entityName] })) {
      batch.push({ key: entry.key, value: entry.value });

      if (batch.length >= batchSize) {
        await processor(batch);
        batch = [];
      }
    }

    // Process remaining items
    if (batch.length > 0) {
      await processor(batch);
    }
  }

  /**
   * Create a backup of an entity before migration
   */
  async backupEntity(entityName: string, backupName?: string): Promise<string> {
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const finalBackupName = backupName ?? `${entityName}_backup_${timestamp}`;

    await this.copyEntity(entityName, `__backups_${finalBackupName}`);

    // Store backup metadata
    const backupMeta = {
      originalEntity: entityName,
      backupName: finalBackupName,
      createdAt: new Date(),
      recordCount: await this.countRecords(entityName),
    };

    await this.kv.set(["__backup_meta", finalBackupName], backupMeta);

    return finalBackupName;
  }

  /**
   * Restore an entity from a backup
   */
  async restoreEntity(entityName: string, backupName: string): Promise<void> {
    const backupEntityName = `__backups_${backupName}`;

    // Check if backup exists
    const backupCount = await this.countRecords(backupEntityName);
    if (backupCount === 0) {
      throw new Error(`Backup ${backupName} not found or empty`);
    }

    // Clear current entity
    await this.truncateEntity(entityName);

    // Restore from backup
    await this.copyEntity(backupEntityName, entityName);
  }

  /**
   * List all available backups
   */
  async listBackups(): Promise<
    Array<{
      backupName: string;
      originalEntity: string;
      createdAt: Date;
      recordCount: number;
    }>
  > {
    const backups: Array<any> = [];

    for await (const entry of this.kv.list({ prefix: ["__backup_meta"] })) {
      if (entry.value) {
        backups.push(entry.value);
      }
    }

    return backups.sort((a, b) =>
      b.createdAt.getTime() - a.createdAt.getTime()
    );
  }

  /**
   * Delete a backup
   */
  async deleteBackup(backupName: string): Promise<void> {
    const backupEntityName = `__backups_${backupName}`;

    // Delete backup data
    await this.truncateEntity(backupEntityName);

    // Delete backup metadata
    await this.kv.delete(["__backup_meta", backupName]);
  }

  /**
   * Create an index on a field (add secondary index entries)
   */
  async createIndex(
    entityName: string,
    fieldName: string,
    indexName?: string,
  ): Promise<void> {
    const finalIndexName = indexName ?? `${entityName}_by_${fieldName}`;

    await this.batchProcess(
      entityName,
      async (records) => {
        const atomic = this.kv.atomic();

        for (const record of records) {
          if (
            record.value && typeof record.value === "object" &&
            fieldName in record.value
          ) {
            const fieldValue = record.value[fieldName];
            const indexKey = [finalIndexName, fieldValue];

            // Store reference to the main record
            atomic.set(indexKey, record.key);
          }
        }

        const result = await atomic.commit();
        if (!result.ok) {
          throw new Error(
            `Failed to create index ${finalIndexName} on ${entityName}.${fieldName}`,
          );
        }
      },
    );
  }

  /**
   * Drop an index
   */
  async dropIndex(indexName: string): Promise<void> {
    await this.truncateEntity(indexName);
  }

  /**
   * Get migration statistics
   */
  async getMigrationStats(): Promise<{
    entityCounts: Record<string, number>;
    totalRecords: number;
    backupCount: number;
  }> {
    const entityCounts: Record<string, number> = {};
    let totalRecords = 0;
    const entityNames = new Set<string>();

    // Collect all entity names
    for await (const entry of this.kv.list({ prefix: [] })) {
      if (Array.isArray(entry.key) && entry.key.length > 0) {
        const entityName = entry.key[0] as string;
        if (!entityName.startsWith("__")) { // Skip internal keys
          entityNames.add(entityName);
        }
      }
    }

    // Count records per entity
    for (const entityName of entityNames) {
      const count = await this.countRecords(entityName);
      entityCounts[entityName] = count;
      totalRecords += count;
    }

    const backups = await this.listBackups();

    return {
      entityCounts,
      totalRecords,
      backupCount: backups.length,
    };
  }
}
