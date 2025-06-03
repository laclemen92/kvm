import type {
  QueryBuilder,
  WhereClause,
  QueryConfig,
  WhereCondition,
  SortConfig,
  SortDirection,
  ComparisonOperator,
  QueryExecutor,
} from "./query-types.ts";
import type { ModelDocument, ModelConstructor } from "./model-types.ts";
import type { KVMEntity, FindManyOptions } from "./types.ts";
import { findMany } from "./find.ts";

/**
 * WhereClause implementation for building field-specific conditions
 */
class WhereClauseImpl<T> implements WhereClause<T> {
  constructor(
    private field: string,
    private queryBuilder: KVMQueryBuilder<T>
  ) {}

  private addCondition(operator: ComparisonOperator, value: any): QueryBuilder<T> {
    this.queryBuilder.addWhereCondition({
      field: this.field,
      operator,
      value,
    });
    return this.queryBuilder;
  }

  equals(value: any): QueryBuilder<T> {
    return this.addCondition("equals", value);
  }

  eq(value: any): QueryBuilder<T> {
    return this.addCondition("eq", value);
  }

  notEquals(value: any): QueryBuilder<T> {
    return this.addCondition("notEquals", value);
  }

  ne(value: any): QueryBuilder<T> {
    return this.addCondition("ne", value);
  }

  greaterThan(value: any): QueryBuilder<T> {
    return this.addCondition("greaterThan", value);
  }

  gt(value: any): QueryBuilder<T> {
    return this.addCondition("gt", value);
  }

  greaterThanOrEqual(value: any): QueryBuilder<T> {
    return this.addCondition("greaterThanOrEqual", value);
  }

  gte(value: any): QueryBuilder<T> {
    return this.addCondition("gte", value);
  }

  lessThan(value: any): QueryBuilder<T> {
    return this.addCondition("lessThan", value);
  }

  lt(value: any): QueryBuilder<T> {
    return this.addCondition("lt", value);
  }

  lessThanOrEqual(value: any): QueryBuilder<T> {
    return this.addCondition("lessThanOrEqual", value);
  }

  lte(value: any): QueryBuilder<T> {
    return this.addCondition("lte", value);
  }

  in(values: any[]): QueryBuilder<T> {
    return this.addCondition("in", values);
  }

  notIn(values: any[]): QueryBuilder<T> {
    return this.addCondition("notIn", values);
  }

  contains(value: string): QueryBuilder<T> {
    return this.addCondition("contains", value);
  }

  startsWith(value: string): QueryBuilder<T> {
    return this.addCondition("startsWith", value);
  }

  endsWith(value: string): QueryBuilder<T> {
    return this.addCondition("endsWith", value);
  }

  exists(): QueryBuilder<T> {
    return this.addCondition("exists", true);
  }

  notExists(): QueryBuilder<T> {
    return this.addCondition("notExists", true);
  }

  between(min: any, max: any): QueryBuilder<T> {
    return this.queryBuilder
      .where(this.field).gte(min)
      .where(this.field).lte(max);
  }
}

/**
 * Main QueryBuilder implementation
 */
export class KVMQueryBuilder<T = any> implements QueryBuilder<T> {
  private config: QueryConfig = {
    where: [],
    sort: [],
  };

  constructor(
    private entity: KVMEntity,
    private kv: Deno.Kv,
    private ModelClass: ModelConstructor<T>
  ) {}

  /**
   * Add a where condition (internal method)
   */
  addWhereCondition(condition: WhereCondition): void {
    this.config.where.push(condition);
  }

  /**
   * Where clause methods
   */
  where(field: keyof T): WhereClause<T>;
  where(field: string): WhereClause<T>;
  where(conditions: Partial<T>): QueryBuilder<T>;
  where(fieldOrConditions: keyof T | string | Partial<T>): WhereClause<T> | QueryBuilder<T> {
    if (typeof fieldOrConditions === "object" && fieldOrConditions !== null) {
      // Handle object conditions: where({ name: "John", age: 30 })
      for (const [field, value] of Object.entries(fieldOrConditions)) {
        this.addWhereCondition({
          field,
          operator: "equals",
          value,
        });
      }
      return this;
    } else {
      // Handle field-specific conditions: where("name").equals("John")
      return new WhereClauseImpl(fieldOrConditions as string, this);
    }
  }

  /**
   * Sorting methods
   */
  orderBy(field: keyof T, direction?: SortDirection): QueryBuilder<T>;
  orderBy(field: string, direction?: SortDirection): QueryBuilder<T>;
  orderBy(field: keyof T | string, direction: SortDirection = "asc"): QueryBuilder<T> {
    this.config.sort.push({
      field: field as string,
      direction,
    });
    return this;
  }

  /**
   * Pagination methods
   */
  limit(count: number): QueryBuilder<T> {
    this.config.limit = count;
    return this;
  }

  offset(count: number): QueryBuilder<T> {
    this.config.offset = count;
    return this;
  }

  cursor(cursorValue: string): QueryBuilder<T> {
    this.config.cursor = cursorValue;
    return this;
  }

  reverse(): QueryBuilder<T> {
    this.config.reverse = true;
    return this;
  }

  /**
   * Selection methods
   */
  select(fields: (keyof T)[]): QueryBuilder<T>;
  select(...fields: (keyof T)[]): QueryBuilder<T>;
  select(...args: any[]): QueryBuilder<T> {
    const fields = Array.isArray(args[0]) ? args[0] : args;
    this.config.select = fields.map(f => f as string);
    return this;
  }

  /**
   * Execution methods
   */
  async find(): Promise<(ModelDocument<T> & T)[]> {
    const results = await this.executeQuery();
    return results.map(result => new this.ModelClass(result.value) as ModelDocument<T> & T);
  }

  async findOne(): Promise<(ModelDocument<T> & T) | null> {
    // Limit to 1 for efficiency
    const originalLimit = this.config.limit;
    this.config.limit = 1;
    
    const results = await this.find();
    
    // Restore original limit
    this.config.limit = originalLimit;
    
    return results.length > 0 ? results[0] : null;
  }

  async findOneOrThrow(): Promise<ModelDocument<T> & T> {
    const result = await this.findOne();
    if (!result) {
      throw new Error(`${this.entity.name} not found`);
    }
    return result;
  }

  async count(): Promise<number> {
    const results = await this.executeQuery();
    return results.length;
  }

  async exists(): Promise<boolean> {
    const count = await this.count();
    return count > 0;
  }

  /**
   * Utility methods
   */
  clone(): QueryBuilder<T> {
    const cloned = new KVMQueryBuilder(this.entity, this.kv, this.ModelClass);
    cloned.config = {
      where: [...this.config.where],
      sort: [...this.config.sort],
      limit: this.config.limit,
      offset: this.config.offset,
      cursor: this.config.cursor,
      reverse: this.config.reverse,
      select: this.config.select ? [...this.config.select] : undefined,
    };
    return cloned;
  }

  toConfig(): QueryConfig {
    return { ...this.config };
  }

  /**
   * Execute the query against Deno KV
   */
  private async executeQuery() {
    // For complex queries with where conditions or sorting, we need to fetch all data first
    // and then apply filtering/sorting client-side
    const needsClientSideProcessing = this.config.where.length > 0 || this.config.sort.length > 0;
    
    // Convert QueryBuilder config to FindManyOptions
    const options: FindManyOptions = {};
    
    // Only apply KV-level optimizations if we don't need client-side processing
    if (!needsClientSideProcessing) {
      if (this.config.limit) {
        options.limit = this.config.limit;
      }
      
      if (this.config.cursor) {
        options.cursor = this.config.cursor;
      }
      
      if (this.config.reverse) {
        options.reverse = this.config.reverse;
      }
    }

    // Get entries
    let results = await findMany<T>(this.entity, this.kv, options);

    // Apply where conditions (client-side filtering)
    if (this.config.where.length > 0) {
      results = results.filter(entry => {
        return this.config.where.every(condition => {
          return this.evaluateCondition(entry.value, condition);
        });
      });
    }

    // Apply sorting (client-side)
    if (this.config.sort.length > 0) {
      results.sort((a, b) => {
        for (const sortConfig of this.config.sort) {
          const aValue = (a.value as any)[sortConfig.field];
          const bValue = (b.value as any)[sortConfig.field];
          
          let comparison = 0;
          if (aValue < bValue) comparison = -1;
          else if (aValue > bValue) comparison = 1;
          
          if (comparison !== 0) {
            return sortConfig.direction === "desc" ? -comparison : comparison;
          }
        }
        return 0;
      });
    }

    // Apply offset
    if (this.config.offset) {
      results = results.slice(this.config.offset);
    }

    // Apply limit (after offset and filtering)
    if (this.config.limit) {
      results = results.slice(0, this.config.limit);
    }

    return results;
  }

  /**
   * Evaluate a single condition against a value
   */
  private evaluateCondition(value: any, condition: WhereCondition): boolean {
    const fieldValue = (value as any)[condition.field];
    
    switch (condition.operator) {
      case "equals":
      case "eq":
        return fieldValue === condition.value;
        
      case "notEquals":
      case "ne":
        return fieldValue !== condition.value;
        
      case "greaterThan":
      case "gt":
        return fieldValue > condition.value;
        
      case "greaterThanOrEqual":
      case "gte":
        return fieldValue >= condition.value;
        
      case "lessThan":
      case "lt":
        return fieldValue < condition.value;
        
      case "lessThanOrEqual":
      case "lte":
        return fieldValue <= condition.value;
        
      case "in":
        return Array.isArray(condition.value) && condition.value.includes(fieldValue);
        
      case "notIn":
        return Array.isArray(condition.value) && !condition.value.includes(fieldValue);
        
      case "contains":
        return typeof fieldValue === "string" && 
               typeof condition.value === "string" && 
               fieldValue.includes(condition.value);
               
      case "startsWith":
        return typeof fieldValue === "string" && 
               typeof condition.value === "string" && 
               fieldValue.startsWith(condition.value);
               
      case "endsWith":
        return typeof fieldValue === "string" && 
               typeof condition.value === "string" && 
               fieldValue.endsWith(condition.value);
               
      case "exists":
        return fieldValue !== undefined && fieldValue !== null;
        
      case "notExists":
        return fieldValue === undefined || fieldValue === null;
        
      default:
        return false;
    }
  }
}