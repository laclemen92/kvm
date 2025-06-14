# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with
code in this repository.

## Project Overview

KVM is an ORM-like data management layer for Deno KV, providing structured
entity definitions, schema validation, and CRUD operations. It's designed to
work like Prisma/TypeORM but specifically for Deno's key-value store.

## Development Commands

```bash
# Run all checks (format, lint, tests)
deno task check

# Run tests with coverage
deno task test

# Run tests for a specific file
deno test lib/create.test.ts

# Generate coverage reports
deno task coverage        # Console output
deno task cov:gen:html   # HTML report

# Check documentation
deno task check:docs
```

## Architecture

The codebase follows a modular CRUD pattern where each operation is a separate
module:

- **Entity Definition**: `KVMEntity<T>` defines the structure with:
  - `primaryKey`: Array of key components (static strings or entity field
    references)
  - `secondaryIndexes`: Additional lookup patterns with KEY/VALUE storage types
  - `relations`: One-to-many relationships between entities
  - `zodSchema`: Zod schema for validation

- **Core Operations**:
  - `create()`: Atomic creation with primary and secondary index updates
  - `find()`: Query operations supporting findUnique and findMany
  - `update()`: Atomic updates maintaining index consistency
  - `delete()`: Removes records and all associated indexes

- **Key Generation**: The `generateKey()` function in `utils.ts` is central to
  how data is stored, creating hierarchical keys from entity definitions.

## Testing Strategy

Tests use Deno's built-in testing framework with in-memory KV stores. When
writing tests:

- Use `:memory:` for the KV store path
- Each test should be self-contained with its own KV instance
- Test files follow the pattern `{module}.test.ts`

## Type System

The project makes heavy use of TypeScript generics and Zod for type safety:

- Entity types are inferred from Zod schemas
- All CRUD operations maintain full type safety
- Relations are type-checked at compile time

## Important Notes

- The project supports both Deno v1.x and v2.x
- All write operations use Deno KV's atomic API for consistency
- Secondary indexes can store either keys (KEY type) or full values (VALUE type)
- The project is marked as "under construction" and not yet stable for
  production use
