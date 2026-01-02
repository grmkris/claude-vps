# Service Factory Pattern

Services use factory functions with explicit dependency injection.

## Template

```typescript
import type { Database } from "@project/db";
import { DB_SCHEMA } from "@project/db";
import { and, eq } from "@project/db/drizzle";
import type { Logger } from "@project/logger";
import type { UserId, XxxId } from "@project/shared/typeid";
import { err, ok, type Result } from "neverthrow";

export type XxxServiceError =
  | { type: "NOT_FOUND"; message: string }
  | { type: "ALREADY_EXISTS"; message: string }
  | { type: "VALIDATION_FAILED"; message: string };

interface XxxServiceDeps {
  db: Database;
  logger: Logger;
}

export function createXxxService({ deps }: { deps: XxxServiceDeps }) {
  const { db, logger } = deps;

  return {
    async getById(id: XxxId) {
      return db.query.xxx.findFirst({
        where: eq(DB_SCHEMA.xxx.id, id),
        with: { user: true },
      });
    },

    async getByUser(userId: UserId) {
      return db.query.xxx.findFirst({
        where: eq(DB_SCHEMA.xxx.userId, userId),
      });
    },

    async create(
      userId: UserId,
      input: { value: string }
    ): Promise<Result<SelectXxx, XxxServiceError>> {
      const existing = await db.query.xxx.findFirst({
        where: eq(DB_SCHEMA.xxx.userId, userId),
      });

      if (existing) {
        return err({ type: "ALREADY_EXISTS", message: "Already exists" });
      }

      const result = await db.insert(DB_SCHEMA.xxx).values({ userId, ...input }).returning();
      logger.info({ userId }, "Created xxx");
      return ok(result[0]);
    },
  };
}

export type XxxService = ReturnType<typeof createXxxService>;
```

## Key Patterns

| Pattern          | Example                                                 |
| ---------------- | ------------------------------------------------------- |
| Deps interface   | `interface XxxServiceDeps { db, logger }`               |
| Factory function | `createXxxService({ deps })`                            |
| Type export      | `type XxxService = ReturnType<typeof createXxxService>` |
| DB access        | Import `DB_SCHEMA` from `@project/db`                   |
| Error handling   | `neverthrow` Result type with typed errors              |

## db.query vs db.select

| Use                   | Pattern                                              |
| --------------------- | ---------------------------------------------------- |
| **db.query** (prefer) | Simple lookups, single table, with relations         |
| **db.select**         | Complex joins, aggregations, custom column selection |

```typescript
// PREFER: Simple lookup with relations
const item = await db.query.item.findFirst({
  where: eq(DB_SCHEMA.item.id, itemId),
  with: { user: true, category: true },
});

// USE: Complex joins, aggregations
const items = await db
  .select({ item: DB_SCHEMA.item, user: DB_SCHEMA.user })
  .from(DB_SCHEMA.item)
  .innerJoin(DB_SCHEMA.user, eq(DB_SCHEMA.item.userId, DB_SCHEMA.user.id))
  .where(and(...conditions));
```

## neverthrow Pattern

Services return `Result<T, Error>` for fallible operations. Routers map to ORPC errors.

```typescript
import { err, ok, type Result } from "neverthrow";

export type XxxServiceError =
  | { type: "NOT_FOUND"; message: string }
  | { type: "ALREADY_EXISTS"; message: string }
  | { type: "INSUFFICIENT_BALANCE"; message: string };

async doSomething(): Promise<Result<Data, XxxServiceError>> {
  if (!found) return err({ type: "NOT_FOUND", message: "Not found" });
  if (exists) return err({ type: "ALREADY_EXISTS", message: "Already exists" });
  return ok(data);
}
```

## Adding to Context

Edit `packages/api/src/context.ts`:

```typescript
import { createXxxService } from "./services/xxx-service";

const xxxService = createXxxService({ deps: { db, logger } });

return { ...existing, xxxService };
```

## Dependency Order

Services are created in dependency order in context.ts:

1. Core deps: `db`, `logger` (no dependencies)
2. Base services: `userService`, `itemService` (only need db, logger)
3. Dependent services: Services that need other services as deps
4. Higher-level: Services with multiple service dependencies
