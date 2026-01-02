# Schema 3-File Pattern

Each entity has 3 files in `packages/db/src/schema/{domain}/`:

- `xxx.db.ts` - Drizzle table definition
- `xxx.zod.ts` - Zod validation schemas
- `xxx.relations.ts` - Drizzle relations

## 1. Table Definition (xxx.db.ts)

```typescript
import {
  type XxxId,
  type UserId,
  typeIdGenerator,
} from "@project/shared/typeid";
import {
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  text,
  unique,
} from "drizzle-orm/pg-core";
import {
  baseEntityFields,
  createTimestampField,
  typeId,
} from "../../utils/db-utils";
import { user } from "../auth/auth.db";

export const xxxStatusEnum = pgEnum("xxx_status", [
  "ACTIVE",
  "COMPLETED",
  "CANCELLED",
]);

export const xxx = pgTable(
  "xxx",
  {
    id: typeId("xxx", "id")
      .primaryKey()
      .$defaultFn(() => typeIdGenerator("xxx"))
      .$type<XxxId>(),
    userId: typeId("user", "user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" })
      .$type<UserId>(),
    status: xxxStatusEnum("status").notNull().default("ACTIVE"),
    value: text("value").notNull(),
    amount: numeric("amount", { precision: 12, scale: 2 }).notNull(),
    count: integer("count").notNull().default(0),
    isActive: boolean("is_active").notNull().default(true),
    metadata: jsonb("metadata").$type<{ key?: string }>(),
    expiresAt: createTimestampField("expires_at"),
    ...baseEntityFields,
  },
  (table) => [
    index("idx_xxx_user").on(table.userId),
    index("idx_xxx_status").on(table.status),
    unique("unique_xxx_user").on(table.userId),
  ]
);
```

## 2. Zod Schemas (xxx.zod.ts)

```typescript
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { xxx } from "./xxx.db";

export const insertXxxSchema = createInsertSchema(xxx);
export const selectXxxSchema = createSelectSchema(xxx);
```

## 3. Relations (xxx.relations.ts)

```typescript
import { relations } from "drizzle-orm";
import { user } from "../auth/auth.db";
import { xxx } from "./xxx.db";

export const xxxRelations = relations(xxx, ({ one }) => ({
  user: one(user, {
    fields: [xxx.userId],
    references: [user.id],
  }),
}));
```

## 4. Barrel Export (schema.db.ts)

Add to the domain's `schema.db.ts`:

```typescript
/** biome-ignore-all lint/performance/noBarrelFile: this is a barrel file */
export * from "./xxx.db";
export * from "./xxx.zod";
export * from "./xxx.relations";
```

## TypeID Registration

First add the TypeID prefix to `packages/shared/src/typeid.schema.ts`:

```typescript
export const idTypesMapNameToPrefix = {
  // ... existing
  xxx: "xxx",  // 3-char prefix
} as const;

// ... at bottom:
export const XxxId = typeIdValidator("xxx");
export type XxxId = z.infer<typeof XxxId>;
```

## Field Types

| Type                                   | Usage                           |
| -------------------------------------- | ------------------------------- |
| `typeId("entity", "col")`              | TypeID columns (stored as UUID) |
| `text("col")`                          | Strings                         |
| `integer("col")`                       | Integers                        |
| `numeric("col", { precision, scale })` | Money/decimals                  |
| `boolean("col")`                       | Booleans                        |
| `jsonb("col").$type<T>()`              | JSON with TypeScript type       |
| `createTimestampField("col")`          | Timestamps with timezone        |
| `pgEnum("name", [...])`                | Enums                           |
| `baseEntityFields`                     | createdAt, updatedAt            |

## Zod Enum Pattern

Use `as const` + `z.enum()` for type-safe enums in `packages/shared/src/`:

```typescript
// packages/shared/src/xxx.schema.ts
export const STATUSES = ["active", "pending", "completed"] as const;
export const Status = z.enum(STATUSES);
export type Status = z.infer<typeof Status>;
```

## SERVICE_URLS (Optional)

If you need environment-specific URLs, create in `packages/shared/src/`:

```typescript
export const ENVIRONMENTS = ["dev", "prod"] as const;
export const Environment = z.enum(ENVIRONMENTS);
export type Environment = z.infer<typeof Environment>;

export const SERVICE_URLS: Record<Environment, { api: string; web: string }> = {
  dev: { api: "http://localhost:4200", web: "http://localhost:3000" },
  prod: { api: "https://api.example.com", web: "https://example.com" },
};
```
