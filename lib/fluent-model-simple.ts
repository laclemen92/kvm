/**
 * Simplified Fluent model definition API for KVM
 * Provides an intuitive, chainable interface for defining models
 */

import { z, type ZodRawShape, type ZodTypeAny } from "zod";
import { ulid } from "@std/ulid";
import type { Key, KVMEntity, Relation, SecondaryIndex } from "./types.ts";
import { RelationType, ValueType } from "./types.ts";
import { createModelClass } from "./model.ts";
import type { ModelConstructor } from "./model-types.ts";

/**
 * Field definition return type
 */
export interface FieldDefinition {
  zodType: ZodTypeAny;
  isPrimaryKey: boolean;
  isIndex: boolean;
}

/**
 * Simple field definition helper
 */
export class SimpleField {
  static string(options?: {
    required?: boolean;
    min?: number;
    max?: number;
    email?: boolean;
    url?: boolean;
    lowercase?: boolean;
    uppercase?: boolean;
    default?: string | (() => string);
    ulid?: boolean;
    primaryKey?: boolean;
    index?: boolean;
  }): FieldDefinition {
    let zodType = z.string();

    if (options?.min !== undefined) zodType = zodType.min(options.min);
    if (options?.max !== undefined) zodType = zodType.max(options.max);
    if (options?.email) zodType = zodType.email();
    if (options?.url) zodType = zodType.url();
    if (options?.lowercase) zodType = zodType.toLowerCase();
    if (options?.uppercase) zodType = zodType.toUpperCase();

    if (options?.ulid) {
      zodType = zodType.default(() => generateULID());
    } else if (options?.default !== undefined) {
      const defaultValue = options.default;
      zodType = zodType.default(
        typeof defaultValue === "function" ? defaultValue : () => defaultValue,
      );
    } else if (!options?.required) {
      // Only make optional if no default is provided
      zodType = zodType.optional();
    }

    return {
      zodType,
      isPrimaryKey: options?.primaryKey || false,
      isIndex: options?.index || false,
    };
  }

  static number(options?: {
    required?: boolean;
    min?: number;
    max?: number;
    int?: boolean;
    positive?: boolean;
    default?: number | (() => number);
    primaryKey?: boolean;
    index?: boolean;
  }): FieldDefinition {
    let zodType = z.number();

    if (options?.min !== undefined) zodType = zodType.min(options.min);
    if (options?.max !== undefined) zodType = zodType.max(options.max);
    if (options?.int) zodType = zodType.int();
    if (options?.positive) zodType = zodType.positive();

    if (options?.default !== undefined) {
      const defaultValue = options.default;
      zodType = zodType.default(
        typeof defaultValue === "function" ? defaultValue : () => defaultValue,
      );
    } else if (!options?.required) {
      // Only make optional if no default is provided
      zodType = zodType.optional();
    }

    return {
      zodType,
      isPrimaryKey: options?.primaryKey || false,
      isIndex: options?.index || false,
    };
  }

  static boolean(options?: {
    required?: boolean;
    default?: boolean | (() => boolean);
    primaryKey?: boolean;
    index?: boolean;
  }) {
    let zodType = z.boolean();

    if (options?.default !== undefined) {
      const defaultValue = options.default;
      zodType = zodType.default(
        typeof defaultValue === "function" ? defaultValue : () => defaultValue,
      );
    } else if (!options?.required) {
      // Only make optional if no default is provided
      zodType = zodType.optional();
    }

    return {
      zodType,
      isPrimaryKey: options?.primaryKey || false,
      isIndex: options?.index || false,
    };
  }

  static date(options?: {
    required?: boolean;
    default?: Date | (() => Date);
    immutable?: boolean;
    autoUpdate?: boolean;
    primaryKey?: boolean;
    index?: boolean;
  }) {
    let zodType = z.date();

    if (options?.default !== undefined) {
      const defaultValue = options.default;
      zodType = zodType.default(
        typeof defaultValue === "function" ? defaultValue : () => defaultValue,
      );
    } else if (options?.autoUpdate) {
      zodType = zodType.default(() => new Date());
    } else if (!options?.required) {
      // Only make optional if no default is provided
      zodType = zodType.optional();
    }

    return {
      zodType,
      isPrimaryKey: options?.primaryKey || false,
      isIndex: options?.index || false,
      isImmutable: options?.immutable || false,
      isAutoUpdate: options?.autoUpdate || false,
    };
  }

  static enum<T extends [string, ...string[]]>(values: T, options?: {
    required?: boolean;
    default?: T[number] | (() => T[number]);
    primaryKey?: boolean;
    index?: boolean;
  }) {
    let zodType = z.enum(values);

    if (options?.default !== undefined) {
      const defaultValue = options.default;
      zodType = zodType.default(
        typeof defaultValue === "function" ? defaultValue : () => defaultValue,
      );
    } else if (!options?.required) {
      // Only make optional if no default is provided
      zodType = zodType.optional();
    }

    return {
      zodType,
      isPrimaryKey: options?.primaryKey || false,
      isIndex: options?.index || false,
    };
  }

  static array<T extends ZodTypeAny>(itemType: T, options?: {
    required?: boolean;
    min?: number;
    max?: number;
    default?: unknown[] | (() => unknown[]);
    primaryKey?: boolean;
    index?: boolean;
  }) {
    let zodType = z.array(itemType);

    if (options?.min !== undefined) zodType = zodType.min(options.min);
    if (options?.max !== undefined) zodType = zodType.max(options.max);

    if (options?.default !== undefined) {
      const defaultValue = options.default;
      zodType = zodType.default(
        typeof defaultValue === "function" ? defaultValue : () => defaultValue,
      );
    } else if (!options?.required) {
      // Only make optional if no default is provided
      zodType = zodType.optional();
    }

    return {
      zodType,
      isPrimaryKey: options?.primaryKey || false,
      isIndex: options?.index || false,
    };
  }

  static object<T extends ZodRawShape>(shape: T, options?: {
    required?: boolean;
    default?: Record<string, unknown> | (() => Record<string, unknown>);
    primaryKey?: boolean;
    index?: boolean;
  }) {
    let zodType = z.object(shape);

    if (options?.default !== undefined) {
      const defaultValue = options.default;
      zodType = zodType.default(
        typeof defaultValue === "function" ? defaultValue : () => defaultValue,
      );
    } else if (!options?.required) {
      // Only make optional if no default is provided
      zodType = zodType.optional();
    }

    return {
      zodType,
      isPrimaryKey: options?.primaryKey || false,
      isIndex: options?.index || false,
    };
  }

  static id(options?: {
    ulid?: boolean;
    uuid?: boolean;
  }) {
    let defaultFn: () => string;

    if (options?.ulid) {
      defaultFn = generateULID;
    } else {
      defaultFn = () => crypto.randomUUID();
    }

    return {
      zodType: z.string().default(defaultFn),
      isPrimaryKey: true,
      isIndex: false,
    };
  }

  static timestamps() {
    return {
      createdAt: {
        zodType: z.date().default(() => new Date()),
        isPrimaryKey: false,
        isIndex: false,
        isImmutable: true,
      },
      updatedAt: {
        zodType: z.date().default(() => new Date()),
        isPrimaryKey: false,
        isIndex: false,
        isAutoUpdate: true,
      },
    };
  }
}

/**
 * Generate a ULID (Universally Unique Lexicographically Sortable Identifier)
 */
function generateULID(): string {
  return ulid();
}

/**
 * Simple model definition interface
 */
export interface SimpleModelDefinition {
  fields: Record<string, any>;
  indexes?: string[];
  relations?: {
    hasMany?: Record<
      string,
      { foreignKey: string; through?: string; cascade?: boolean }
    >;
    belongsTo?: Record<string, { foreignKey: string; cascade?: boolean }>;
    manyToMany?: Record<
      string,
      { through: string; foreignKey: string; cascade?: boolean }
    >;
  };
  timestamps?: boolean;
}

/**
 * Simple fluent model builder
 */
export class SimpleFluentKVM {
  private kv: Deno.Kv;

  constructor(kv: Deno.Kv) {
    this.kv = kv;
  }

  /**
   * Define a model with a simple schema definition
   */
  defineModel<T = any>(
    name: string,
    definition: SimpleModelDefinition,
  ): ModelConstructor<T> {
    const schemaShape: ZodRawShape = {};
    const secondaryIndexes: SecondaryIndex[] = [];
    const relations: Relation[] = [];
    let primaryKey: Key = [{ name }];

    // Add timestamps if requested
    if (definition.timestamps) {
      const timestamps = SimpleField.timestamps();
      definition.fields = {
        ...definition.fields,
        ...timestamps,
      };
    }

    // Process fields
    for (const [fieldName, fieldDef] of Object.entries(definition.fields)) {
      schemaShape[fieldName] = fieldDef.zodType;

      // Handle primary key
      if (fieldDef.isPrimaryKey) {
        primaryKey = [{ name, key: fieldName }];
      }

      // Handle secondary indexes
      if (fieldDef.isIndex) {
        secondaryIndexes.push({
          name: `${name}_by_${fieldName}`,
          key: [{ name, key: fieldName }],
          valueType: ValueType.VALUE,
          unique: false,
        });
      }
    }

    // Add explicit indexes
    if (definition.indexes) {
      for (const indexField of definition.indexes) {
        secondaryIndexes.push({
          name: `${name}_by_${indexField}`,
          key: [{ name, key: indexField }],
          valueType: ValueType.VALUE,
          unique: false,
        });
      }
    }

    // Process relations
    if (definition.relations?.hasMany) {
      for (
        const [relationName, config] of Object.entries(
          definition.relations.hasMany,
        )
      ) {
        relations.push({
          entityName: relationName,
          fields: [config.foreignKey],
          type: RelationType.ONE_TO_MANY,
          foreignKey: config.foreignKey,
          through: config.through,
          cascade: config.cascade || false,
        });
      }
    }

    if (definition.relations?.belongsTo) {
      for (
        const [relationName, config] of Object.entries(
          definition.relations.belongsTo,
        )
      ) {
        relations.push({
          entityName: relationName,
          fields: [config.foreignKey],
          type: RelationType.BELONGS_TO,
          foreignKey: config.foreignKey,
          cascade: config.cascade || false,
        });
      }
    }

    if (definition.relations?.manyToMany) {
      for (
        const [relationName, config] of Object.entries(
          definition.relations.manyToMany,
        )
      ) {
        relations.push({
          entityName: relationName,
          fields: [config.foreignKey],
          type: RelationType.MANY_TO_MANY,
          foreignKey: config.foreignKey,
          through: config.through,
          cascade: config.cascade || false,
        });
      }
    }

    // Build the entity
    const entity: KVMEntity = {
      name,
      primaryKey,
      schema: z.object(schemaShape),
      secondaryIndexes: secondaryIndexes.length > 0
        ? secondaryIndexes
        : undefined,
      relations: relations.length > 0 ? relations : undefined,
    };

    // Create and return the model class
    return createModelClass<T>(name, entity, this.kv);
  }

  /**
   * Access to field builder for convenience
   */
  get field() {
    return SimpleField;
  }
}

// Export convenience creators
export const field = SimpleField;
