/**
 * Fluent model definition API for KVM
 * Provides an intuitive, chainable interface for defining models
 */

import { z, type ZodObject, type ZodRawShape, type ZodTypeAny } from "zod";
import { ulid } from "@std/ulid";
import type { KVMEntity, Key, SecondaryIndex, Relation } from "./types.ts";
import { RelationType, ValueType } from "./types.ts";
import { createModelClass } from "./model.ts";
import type { ModelConstructor } from "./model-types.ts";

/**
 * Field definition with chainable methods for validation and constraints
 */
export class FieldBuilder<T extends ZodTypeAny = ZodTypeAny> {
  private zodType: T;
  private fieldName: string;
  private isPrimaryKey = false;
  private isSecondaryIndex = false;
  private defaultValue?: any;
  private isReadOnly = false;

  constructor(fieldName: string, zodType: T) {
    this.fieldName = fieldName;
    this.zodType = zodType;
  }

  /**
   * Mark this field as the primary key
   */
  primaryKey(): this {
    this.isPrimaryKey = true;
    return this;
  }

  /**
   * Auto-generate ULID values for this field
   */
  ulid(): this {
    // Add ULID generation as default
    this.zodType = this.zodType.default(() => this.generateULID()) as unknown as T;
    return this;
  }

  /**
   * Generate a ULID (Universally Unique Lexicographically Sortable Identifier)
   */
  private generateULID(): string {
    return ulid();
  }

  /**
   * Mark this field as a secondary index
   */
  index(): this {
    this.isSecondaryIndex = true;
    return this;
  }

  /**
   * Set a default value for this field
   */
  default(value: any): this {
    this.defaultValue = value;
    this.zodType = this.zodType.default(value) as unknown as T;
    return this;
  }

  /**
   * Make this field required (removes optional)
   */
  required(): this {
    // Remove optional if it exists
    if ('_def' in this.zodType && 'innerType' in this.zodType._def) {
      this.zodType = this.zodType._def.innerType as unknown as T;
    }
    return this;
  }

  /**
   * Make this field optional
   */
  optional(): this {
    this.zodType = this.zodType.optional() as unknown as T;
    return this;
  }

  /**
   * Make this field read-only (immutable after creation)
   */
  immutable(): this {
    this.isReadOnly = true;
    return this;
  }

  /**
   * Add validation for string fields
   */
  min(length: number): this {
    if (this.zodType instanceof z.ZodString) {
      this.zodType = this.zodType.min(length) as unknown as T;
    } else if (this.zodType instanceof z.ZodNumber) {
      this.zodType = this.zodType.min(length) as unknown as T;
    }
    return this;
  }

  max(length: number): this {
    if (this.zodType instanceof z.ZodString) {
      this.zodType = this.zodType.max(length) as unknown as T;
    } else if (this.zodType instanceof z.ZodNumber) {
      this.zodType = this.zodType.max(length) as unknown as T;
    }
    return this;
  }

  /**
   * Add email validation for strings
   */
  email(): this {
    if (this.zodType instanceof z.ZodString) {
      this.zodType = this.zodType.email() as unknown as T;
    }
    return this;
  }

  /**
   * Add URL validation for strings
   */
  url(): this {
    if (this.zodType instanceof z.ZodString) {
      this.zodType = this.zodType.url() as unknown as T;
    }
    return this;
  }

  /**
   * Transform string to lowercase
   */
  lowercase(): this {
    if (this.zodType instanceof z.ZodString) {
      this.zodType = this.zodType.transform(val => val.toLowerCase()) as unknown as T;
    }
    return this;
  }

  /**
   * Transform string to uppercase
   */
  uppercase(): this {
    if (this.zodType instanceof z.ZodString) {
      this.zodType = this.zodType.transform(val => val.toUpperCase()) as unknown as T;
    }
    return this;
  }

  /**
   * Get the built field configuration
   */
  getConfig() {
    return {
      zodType: this.zodType,
      fieldName: this.fieldName,
      isPrimaryKey: this.isPrimaryKey,
      isSecondaryIndex: this.isSecondaryIndex,
      defaultValue: this.defaultValue,
      isReadOnly: this.isReadOnly,
    };
  }
}

/**
 * Fluent field chain that supports both field modifiers and model builder chaining
 */
export class FluentFieldChain {
  constructor(private builder: FluentModelBuilder, private fieldBuilder: FieldBuilder) {}

  // Field modifier methods that return the chain for continued field modification
  primaryKey(): this {
    this.fieldBuilder.primaryKey();
    return this;
  }

  required(): this {
    this.fieldBuilder.required();
    return this;
  }

  optional(): this {
    this.fieldBuilder.optional();
    return this;
  }

  email(): this {
    this.fieldBuilder.email();
    return this;
  }

  url(): this {
    this.fieldBuilder.url();
    return this;
  }

  lowercase(): this {
    this.fieldBuilder.lowercase();
    return this;
  }

  uppercase(): this {
    this.fieldBuilder.uppercase();
    return this;
  }

  min(value: number): this {
    this.fieldBuilder.min(value);
    return this;
  }

  max(value: number): this {
    this.fieldBuilder.max(value);
    return this;
  }

  default(value: any): this {
    this.fieldBuilder.default(value);
    return this;
  }

  ulid(): this {
    this.fieldBuilder.ulid();
    return this;
  }

  addIndex(): this {
    this.fieldBuilder.index();
    return this;
  }

  immutable(): this {
    this.fieldBuilder.immutable();
    return this;
  }

  // Model builder method delegation for chaining to next field
  string(name: string): FluentFieldChain {
    return this.builder.string(name);
  }

  number(name: string): FluentFieldChain {
    return this.builder.number(name);
  }

  boolean(name: string): FluentFieldChain {
    return this.builder.boolean(name);
  }

  date(name: string): FluentFieldChain {
    return this.builder.date(name);
  }

  enum<T extends [string, ...string[]]>(name: string, values: T): FluentFieldChain {
    return this.builder.enum(name, values);
  }

  array<T extends ZodTypeAny>(name: string, itemType: T): FluentFieldChain {
    return this.builder.array(name, itemType);
  }

  object<T extends ZodRawShape>(name: string, shape: T): FluentFieldChain {
    return this.builder.object(name, shape);
  }

  custom<T extends ZodTypeAny>(name: string, zodType: T): FluentFieldChain {
    return this.builder.field(name, zodType);
  }

  // Other model builder methods
  timestamps(): FluentModelBuilder {
    return this.builder.timestamps();
  }

  addModelIndex(fieldName: string, options?: { unique?: boolean; valueType?: ValueType }): FluentModelBuilder {
    return this.builder.index(fieldName, options);
  }

  hasMany(relationName: string, options: { 
    foreignKey: string; 
    through?: string;
    cascade?: boolean;
  }): FluentModelBuilder {
    return this.builder.hasMany(relationName, options);
  }

  belongsTo(relationName: string, options: {
    foreignKey: string;
    cascade?: boolean;
  }): FluentModelBuilder {
    return this.builder.belongsTo(relationName, options);
  }

  manyToMany(relationName: string, options: {
    through: string;
    foreignKey: string;
    cascade?: boolean;
  }): FluentModelBuilder {
    return this.builder.manyToMany(relationName, options);
  }

  build(kv: Deno.Kv): ModelConstructor {
    return this.builder.build(kv);
  }
}

/**
 * Main fluent model builder with chaining support
 */
export class FluentModelBuilder {
  private modelName: string;
  private fields: Map<string, FieldBuilder> = new Map();
  private secondaryIndexes: SecondaryIndex[] = [];
  private relations: Relation[] = [];
  private hasTimestamps = false;
  private primaryKeyField?: string;
  private currentField?: FieldBuilder;

  constructor(modelName: string) {
    this.modelName = modelName;
  }

  /**
   * Add a string field and enable field-specific chaining
   */
  string(name: string): FluentFieldChain {
    const field = new FieldBuilder(name, z.string());
    this.fields.set(name, field);
    this.currentField = field;
    return new FluentFieldChain(this, field);
  }

  /**
   * Add a number field
   */
  number(name: string): FluentFieldChain {
    const field = new FieldBuilder(name, z.number());
    this.fields.set(name, field);
    this.currentField = field;
    return new FluentFieldChain(this, field);
  }

  /**
   * Add a boolean field
   */
  boolean(name: string): FluentFieldChain {
    const field = new FieldBuilder(name, z.boolean());
    this.fields.set(name, field);
    this.currentField = field;
    return new FluentFieldChain(this, field);
  }

  /**
   * Add a date field (accepts Date objects, stores as ISO strings for Deno KV compatibility)
   */
  date(name: string): FluentFieldChain {
    // Accept Date objects and convert to ISO strings for storage in Deno KV
    const dateSchema = z.union([
      z.date(),
      z.string().datetime().transform(str => new Date(str))
    ]).transform(val => {
      // Convert input to Date if it's a string, then store as ISO string
      const date = val instanceof Date ? val : new Date(val);
      return date.toISOString();
    });
    const field = new FieldBuilder(name, dateSchema);
    this.fields.set(name, field);
    this.currentField = field;
    return new FluentFieldChain(this, field);
  }

  /**
   * Add an enum field
   */
  enum<T extends [string, ...string[]]>(name: string, values: T): FluentFieldChain {
    const field = new FieldBuilder(name, z.enum(values));
    this.fields.set(name, field);
    this.currentField = field;
    return new FluentFieldChain(this, field);
  }

  /**
   * Add an array field
   */
  array<T extends ZodTypeAny>(name: string, itemType: T): FluentFieldChain {
    const field = new FieldBuilder(name, z.array(itemType));
    this.fields.set(name, field);
    this.currentField = field;
    return new FluentFieldChain(this, field);
  }

  /**
   * Add an object field
   */
  object<T extends ZodRawShape>(name: string, shape: T): FluentFieldChain {
    const field = new FieldBuilder(name, z.object(shape));
    this.fields.set(name, field);
    this.currentField = field;
    return new FluentFieldChain(this, field);
  }

  /**
   * Add a generic field with custom Zod type
   */
  field<T extends ZodTypeAny>(name: string, zodType: T): FluentFieldChain {
    const field = new FieldBuilder(name, zodType);
    this.fields.set(name, field);
    this.currentField = field;
    return new FluentFieldChain(this, field);
  }

  /**
   * Add automatic createdAt and updatedAt timestamps
   */
  timestamps(): this {
    this.hasTimestamps = true;
    
    // Add createdAt field (store as ISO string)
    const createdAtField = new FieldBuilder("createdAt", 
      z.string().datetime().default(() => new Date().toISOString())
    );
    createdAtField.immutable();
    this.fields.set("createdAt", createdAtField);
    
    // Add updatedAt field (store as ISO string)
    const updatedAtField = new FieldBuilder("updatedAt", 
      z.string().datetime().default(() => new Date().toISOString())
    );
    this.fields.set("updatedAt", updatedAtField);
    
    return this;
  }

  /**
   * Add a secondary index
   */
  index(fieldName: string, options?: { unique?: boolean; valueType?: ValueType }): this {
    this.secondaryIndexes.push({
      name: `${this.modelName}_by_${fieldName}`,
      key: [{ name: this.modelName, key: fieldName }],
      valueType: options?.valueType || ValueType.VALUE,
      unique: options?.unique || false,
    });
    return this;
  }

  /**
   * Add a relation to another model
   */
  hasMany(relationName: string, options: { 
    foreignKey: string; 
    through?: string;
    cascade?: boolean;
  }): this {
    this.relations.push({
      entityName: relationName,
      fields: [options.foreignKey],
      type: RelationType.ONE_TO_MANY,
      foreignKey: options.foreignKey,
      through: options.through,
      cascade: options.cascade || false,
    });
    return this;
  }

  /**
   * Add a belongs-to relation
   */
  belongsTo(relationName: string, options: {
    foreignKey: string;
    cascade?: boolean;
  }): this {
    this.relations.push({
      entityName: relationName,
      fields: [options.foreignKey],
      type: RelationType.BELONGS_TO,
      foreignKey: options.foreignKey,
      cascade: options.cascade || false,
    });
    return this;
  }

  /**
   * Add a many-to-many relation
   */
  manyToMany(relationName: string, options: {
    through: string;
    foreignKey: string;
    cascade?: boolean;
  }): this {
    this.relations.push({
      entityName: relationName,
      fields: [options.foreignKey],
      type: RelationType.MANY_TO_MANY,
      foreignKey: options.foreignKey,
      through: options.through,
      cascade: options.cascade || false,
    });
    return this;
  }

  /**
   * Build the final entity and create the model class
   */
  build(kv: Deno.Kv): ModelConstructor {
    // Build the Zod schema from fields
    const schemaShape: ZodRawShape = {};
    let primaryKey: Key = [{ name: this.modelName }];

    for (const [name, fieldBuilder] of this.fields.entries()) {
      const config = fieldBuilder.getConfig();
      schemaShape[name] = config.zodType;

      // Handle primary key
      if (config.isPrimaryKey) {
        this.primaryKeyField = name;
        primaryKey = [{ name: this.modelName, key: name }];
      }

      // Handle secondary indexes
      if (config.isSecondaryIndex) {
        this.secondaryIndexes.push({
          name: `${this.modelName}_by_${name}`,
          key: [{ name: this.modelName, key: name }],
          valueType: ValueType.VALUE,
          unique: false,
        });
      }
    }

    // If no primary key was specified, add a default id field
    if (!this.primaryKeyField) {
      schemaShape.id = z.string().default(() => crypto.randomUUID());
      primaryKey = [{ name: this.modelName, key: "id" }];
    }

    const schema = z.object(schemaShape);

    // Build the entity
    const entity: KVMEntity = {
      name: this.modelName,
      primaryKey,
      schema,
      secondaryIndexes: this.secondaryIndexes.length > 0 ? this.secondaryIndexes : undefined,
      relations: this.relations.length > 0 ? this.relations : undefined,
    };

    // Create and return the model class
    return createModelClass(this.modelName, entity, kv);
  }
}

/**
 * Main KVM class with fluent model definition
 */
export class FluentKVM {
  private kv: Deno.Kv;

  constructor(kv: Deno.Kv) {
    this.kv = kv;
  }

  /**
   * Start defining a new model with fluent API
   */
  defineModel(name: string): FluentModelBuilder {
    return new FluentModelBuilder(name);
  }

  /**
   * Create a model with traditional entity definition (backward compatibility)
   */
  model<T = any>(name: string, entity: KVMEntity): ModelConstructor<T> {
    return createModelClass<T>(name, entity, this.kv);
  }

  /**
   * Convenience field type creators for standalone use
   */
  static string(name: string) {
    return new FieldBuilder(name, z.string());
  }

  static number(name: string) {
    return new FieldBuilder(name, z.number());
  }

  static boolean(name: string) {
    return new FieldBuilder(name, z.boolean());
  }

  static date(name: string) {
    return new FieldBuilder(name, z.date());
  }

  static enum<T extends [string, ...string[]]>(name: string, values: T) {
    return new FieldBuilder(name, z.enum(values));
  }

  static array<T extends ZodTypeAny>(name: string, itemType: T) {
    return new FieldBuilder(name, z.array(itemType));
  }

  static object<T extends ZodRawShape>(name: string, shape: T) {
    return new FieldBuilder(name, z.object(shape));
  }
}