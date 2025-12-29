---
name: frontend-patterns
description: React/Next.js data patterns - React Query hooks, ORPC client integration, error handling, cache invalidation. Complements frontend-design skill (visuals).
---

# React/Next.js Patterns

Use this skill for data layer and React patterns. For visual design, use `frontend-design` skill.

## Project Setup

Replace these placeholders for your project:
- `@project/` → your package scope (e.g., `@myapp/`)
- `apps/web/` paths follow standard monorepo layout

Expected setup:
- `@project/auth` - better-auth config
- `@project/shared` - SERVICE_URLS, shared types
- `@/utils/orpc` - ORPC client, queryClient

## ORPC Client Setup

```typescript
import { client, orpc, queryClient } from "@/utils/orpc";

const data = await client.item.get({});
const queryKey = orpc.item.get.queryOptions({}).queryKey;
```

## Quick Patterns

### Query Hook

```typescript
"use client";
import { useQuery } from "@tanstack/react-query";
import { orpc } from "@/utils/orpc";

export function useItems() {
  return useQuery(orpc.item.list.queryOptions({}));
}
```

### Mutation Hook

```typescript
"use client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { client, orpc } from "@/utils/orpc";

export function useCreateItem() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input) => client.item.create(input),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: orpc.item.list.queryOptions({ input: {} }).queryKey,
      });
      toast.success("Created!");
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Failed");
    },
  });
}
```

## Additional Resources

- For detailed hook patterns and error handling, see [hooks.md](hooks.md)
- For auth client and provider setup, see [providers.md](providers.md)

## File Locations

| Pattern | Location |
|---------|----------|
| Hooks | `apps/web/src/hooks/` |
| ORPC client | `apps/web/src/utils/orpc.ts` |
| Types | `apps/web/src/lib/orpc-types.ts` |
| Auth client | `apps/web/src/lib/auth-client.ts` |
| Providers | `apps/web/src/components/providers.tsx` |

## Best Practices

1. **Always "use client"** at top of hook files
2. **Import from @/utils/orpc** for client/orpc/queryClient
3. **Toast on success/error** using Sonner
4. **Invalidate related queries** in onSuccess
5. **Handle error codes explicitly** with switch statement
