import type { FindManyOptions } from "./types.ts";
import type { ModelDocument, ModelConstructor } from "./model-types.ts";

/**
 * Comparison operators for where clauses
 */
export type ComparisonOperator = 
  | "equals" | "eq"
  | "notEquals" | "ne" 
  | "greaterThan" | "gt"
  | "greaterThanOrEqual" | "gte"
  | "lessThan" | "lt"
  | "lessThanOrEqual" | "lte"
  | "in"
  | "notIn"
  | "contains"
  | "startsWith"
  | "endsWith"
  | "exists"
  | "notExists";

/**
 * Sort direction
 */
export type SortDirection = "asc" | "desc";

/**
 * Where condition structure
 */
export interface WhereCondition {
  field: string;
  operator: ComparisonOperator;
  value: any;
}

/**
 * Sort configuration
 */
export interface SortConfig {
  field: string;
  direction: SortDirection;
}

/**
 * Query builder configuration
 */
export interface QueryConfig {
  where: WhereCondition[];
  sort: SortConfig[];
  limit?: number;
  offset?: number;
  cursor?: string;
  reverse?: boolean;
  select?: string[];
}

/**
 * Query builder interface for chaining
 */
export interface QueryBuilder<T = any> {
  // Where methods
  where(field: keyof T): WhereClause<T>;
  where(field: string): WhereClause<T>;
  where(conditions: Partial<T>): QueryBuilder<T>;
  
  // Sorting
  orderBy(field: keyof T, direction?: SortDirection): QueryBuilder<T>;
  orderBy(field: string, direction?: SortDirection): QueryBuilder<T>;
  
  // Pagination
  limit(count: number): QueryBuilder<T>;
  offset(count: number): QueryBuilder<T>;
  cursor(cursorValue: string): QueryBuilder<T>;
  reverse(): QueryBuilder<T>;
  
  // Selection
  select(fields: (keyof T)[]): QueryBuilder<T>;
  select(...fields: (keyof T)[]): QueryBuilder<T>;
  
  // Execution
  find(): Promise<(ModelDocument<T> & T)[]>;
  findOne(): Promise<(ModelDocument<T> & T) | null>;
  findOneOrThrow(): Promise<ModelDocument<T> & T>;
  count(): Promise<number>;
  exists(): Promise<boolean>;
  
  // Advanced
  clone(): QueryBuilder<T>;
  toConfig(): QueryConfig;
}

/**
 * Where clause builder for individual fields
 */
export interface WhereClause<T> {
  equals(value: any): QueryBuilder<T>;
  eq(value: any): QueryBuilder<T>;
  
  notEquals(value: any): QueryBuilder<T>;
  ne(value: any): QueryBuilder<T>;
  
  greaterThan(value: any): QueryBuilder<T>;
  gt(value: any): QueryBuilder<T>;
  
  greaterThanOrEqual(value: any): QueryBuilder<T>;
  gte(value: any): QueryBuilder<T>;
  
  lessThan(value: any): QueryBuilder<T>;
  lt(value: any): QueryBuilder<T>;
  
  lessThanOrEqual(value: any): QueryBuilder<T>;
  lte(value: any): QueryBuilder<T>;
  
  in(values: any[]): QueryBuilder<T>;
  notIn(values: any[]): QueryBuilder<T>;
  
  contains(value: string): QueryBuilder<T>;
  startsWith(value: string): QueryBuilder<T>;
  endsWith(value: string): QueryBuilder<T>;
  
  exists(): QueryBuilder<T>;
  notExists(): QueryBuilder<T>;
  
  between(min: any, max: any): QueryBuilder<T>;
}

/**
 * Query executor interface
 */
export interface QueryExecutor<T = any> {
  execute(config: QueryConfig): Promise<(ModelDocument<T> & T)[]>;
  executeOne(config: QueryConfig): Promise<(ModelDocument<T> & T) | null>;
  executeCount(config: QueryConfig): Promise<number>;
  executeExists(config: QueryConfig): Promise<boolean>;
}

/**
 * Query builder factory function type
 */
export type QueryBuilderFactory<T> = () => QueryBuilder<T>;