# Router Pattern

Routers use ORPC with procedures for API endpoints.

## Template

```typescript
import { ORPCError } from "@orpc/server";
import { NUMERIC_CONSTANTS } from "@project/shared/constants";
import { XxxId, UserId } from "@project/shared/typeid";
import { z } from "zod";
import { protectedProcedure, publicProcedure } from "../api";

export const xxxRouter = {
  byId: protectedProcedure
    .input(z.object({ id: XxxId }))
    .handler(async ({ context, input }) => {
      const userId = UserId.parse(context.session.user.id);
      const item = await context.xxxService.getById(userId, input.id);

      if (!item) {
        throw new ORPCError("NOT_FOUND", { message: "Item not found" });
      }

      return item;
    }),

  list: protectedProcedure
    .input(
      z.object({
        limit: z
          .number()
          .min(NUMERIC_CONSTANTS.pagination.minLimit)
          .max(NUMERIC_CONSTANTS.pagination.maxLimit)
          .optional()
          .default(NUMERIC_CONSTANTS.pagination.defaultLimit),
        offset: z.number().min(0).optional().default(0),
      })
    )
    .handler(async ({ context, input }) => {
      const userId = UserId.parse(context.session.user.id);
      const items = await context.xxxService.list(userId, input);

      return {
        items,
        limit: input.limit,
        offset: input.offset,
      };
    }),

  create: protectedProcedure
    .input(
      z.object({
        value: z.string().min(1).max(255),
      })
    )
    .handler(async ({ context, input }) => {
      const userId = UserId.parse(context.session.user.id);
      const result = await context.xxxService.create(userId, input);

      return result.match(
        (item) => ({ success: true, item }),
        (error) => {
          throw new ORPCError("BAD_REQUEST", { message: error.message });
        }
      );
    }),

  publicStats: publicProcedure.handler(async ({ context }) => {
    return context.xxxService.getPublicStats();
  }),
};
```

## Procedure Types

| Type                 | Usage                                |
| -------------------- | ------------------------------------ |
| `protectedProcedure` | Requires auth, has `context.session` |
| `publicProcedure`    | No auth required                     |

## Error Handling

Direct throw:

```typescript
throw new ORPCError("NOT_FOUND", { message: "Item not found" });
throw new ORPCError("BAD_REQUEST", { message: "Invalid input" });
```

## neverthrow → ORPC Mapping

Services return `Result<T, Error>`, routers map to ORPC errors with `.match()`:

```typescript
.handler(async ({ context, input }) => {
  const userId = UserId.parse(context.session.user.id);
  const result = await context.xxxService.doSomething(userId, input);

  return result.match(
    (data) => ({ success: true, data }),
    (error) => {
      throw new ORPCError(
        error.type === "NOT_FOUND" ? "NOT_FOUND" : "BAD_REQUEST",
        { message: error.message }
      );
    }
  );
});
```

Error type mapping:
| Service Error Type | ORPC Error Code |
|-------------------|-----------------|
| `NOT_FOUND` | `"NOT_FOUND"` |
| `ALREADY_EXISTS`, `VALIDATION_FAILED`, etc. | `"BAD_REQUEST"` |
| `UNAUTHORIZED` | `"UNAUTHORIZED"` |

## Common Input Patterns

```typescript
z.object({ limit: z.number().min(1).max(100).default(20), offset: z.number().min(0).default(0) })
z.object({ id: XxxId })
z.object({ status: z.enum(["ACTIVE", "COMPLETED"]) })
```

## Register Router

Add to `packages/api/src/routers/routers.ts`:

```typescript
import { xxxRouter } from "./xxx-router";

export const contract = { ...existing, xxx: xxxRouter };
```

## Async Side Effects

```typescript
.handler(async ({ context, input }) => {
  const result = await context.xxxService.create(input);

  Promise.all([
    context.notificationService.send(userId, "item_created"),
    context.analyticsService.track(userId, "item_created"),
  ]).catch((e) => context.logger.error({ error: e }, "Side effects failed"));

  return result;
})
```
