import type { ZodObject, ZodRawShape } from "zod";

/**
 * KVMEntity that defines everything about the entity.
 * This includes the primaryKey ex. users
 * secondaryIndexes ex. users_by_session
 * relations ex. "users", "user1", "posts"
 * schema ex. { id: string; age: number; name: string; }
 */
// deno-lint-ignore ban-types
export type KVMEntity<T extends ZodRawShape = {}> = {
  name: string;
  primaryKey: Key; // primary key could be some moving thing tho. 'users' works her. but 'electronics', 'computers', ${brand}, ${storageType} wouldn't work well with string[]
  secondaryIndexes?: SecondaryIndexes;
  atomic?: boolean;
  schema: ZodObject<T>;
  relations?: Relations;
};

/**
 * An array of Relation objects
 */
export type Relations = Relation[];

/**
 * Define a relation to another entity
 */
export type Relation = {
  // entity: KVMEntity;
  entityName: string;
  fields: string[];
  // references: string[];
  valueType?: ValueType;
  valueKey?: string;
  type: string;
};

/**
 * Array of SecondaryIndexes for defining multiple per entity
 */
export type SecondaryIndexes = SecondaryIndex[];

/**
 * Definition of a secondaryIndex
 */
export type SecondaryIndex = {
  key: Key;
  valueType?: ValueType;
  valueKey?: string;
  unique?: boolean;
  name: string;
};

/**
 * ValueType defines how the value of the kv entry
 * is stored. If "KEY" then it is a reference, ex. "user1"
 * but if "VALUE" then it is a copy of the original value
 * ex. { id: user1, name: "john smith", age; 29 }
 */
export enum ValueType {
  KEY = "KEY",
  VALUE = "VALUE",
}

/**
 * Array of KeyParts define a Key
 */
export type Key = KeyParts[];

/**
 * KeyParts can consist of a name and/or key
 */
export type KeyParts = {
  name?: string;
  key?: string;
};

/**
 * The options for performing a findMany operation
 */
export type FindManyOptions = {
  selector?: Deno.KvListSelector;
  prefix?: Deno.KvKey;
  limit?: number;
  cursor?: string;
  reverse?: boolean;
};
