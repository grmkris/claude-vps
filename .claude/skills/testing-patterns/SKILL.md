---
name: testing-patterns
description: Test infrastructure patterns - PGlite for in-memory PostgreSQL, Redis/S3 mocks, TestSetup factory, Vitest. Use when writing tests or adding test infrastructure.
---

# Testing Infrastructure

Use this skill when writing tests. Tests use isolated in-memory infrastructure.

## Project Setup

Replace these placeholders for your project:
- `@project/` → your package scope (e.g., `@myapp/`)
- `packages/` paths follow standard monorepo layout

Expected packages:
- `@project/test-utils` - In-memory infrastructure (PGlite, Redis, S3)
- `@project/shared/typeid` - TypeID validators

## Test File Location

- Server tests: `apps/server/test/**/*.test.ts`
- Use Vitest (`describe`, `it`, `expect`, `beforeAll`, `afterAll`)

## Quick Start Template

```typescript
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { type TestSetup, createTestSetup } from "../test/test.setup";
import { createTestContext, createTestItem, fundUser } from "../test/test-helpers";
import { UserId } from "@project/shared/typeid";

describe("Feature Name", () => {
  let testSetup: TestSetup;

  beforeAll(async () => {
    testSetup = await createTestSetup();
  });

  afterAll(async () => {
    await testSetup.cleanup();
    await testSetup.close();
  });

  it("should do something", async () => {
    const { deps, users } = testSetup;
    const userId = UserId.parse(users.authenticated.id);

    const item = await createTestItem(deps.db, { title: "Test Item" });
    await fundUser(deps.userService, userId, 100);

    const result = await deps.itemService.create(userId, {
      itemId: item.id,
      value: "test",
    });

    expect(result.isOk()).toBe(true);
  });
});
```

## Additional Resources

- For TestSetup structure and in-memory infra, see [setup.md](setup.md)
- For test helper functions, see [helpers.md](helpers.md)
