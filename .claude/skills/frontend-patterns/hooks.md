# Detailed Hook Patterns

## Mutation with Error Code Handling

```typescript
"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { client, orpc } from "@/utils/orpc";

interface ORPCErrorData {
  code?: string;
  message?: string;
}

function getErrorData(error: unknown): ORPCErrorData {
  if (error && typeof error === "object" && "data" in error) {
    return (error as { data: ORPCErrorData }).data ?? {};
  }
  return {};
}

export function useCreateItem() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: { name: string; value: number }) =>
      client.item.create(input),

    onSuccess: (_data, input) => {
      queryClient.invalidateQueries({
        queryKey: orpc.item.list.queryOptions({ input: {} }).queryKey,
      });
      queryClient.invalidateQueries({
        queryKey: orpc.user.me.queryOptions({ input: {} }).queryKey,
      });
      toast.success(`Created ${input.name}!`);
    },

    onError: (error) => {
      const { code, message } = getErrorData(error);
      const fallback = error instanceof Error ? error.message : "Failed";

      switch (code) {
        case "INSUFFICIENT_BALANCE":
          toast.error("Not enough balance");
          break;
        case "ALREADY_EXISTS":
          toast.error("Item already exists");
          break;
        case "NOT_FOUND":
          toast.error("Item not found");
          break;
        case "VALIDATION_FAILED":
          toast.error("Invalid input");
          break;
        default:
          toast.error(message ?? fallback);
      }
    },
  });
}
```

## Backend Error Codes

Common error codes returned by the backend:

```typescript
switch (code) {
  case "INSUFFICIENT_BALANCE":
  case "ALREADY_EXISTS":
  case "NOT_FOUND":
  case "VALIDATION_FAILED":
  case "UNAUTHORIZED":
  case "FORBIDDEN":
  // Add more as needed
}
```

## Cache Invalidation

```typescript
queryClient.invalidateQueries({
  queryKey: orpc.item.list.queryOptions({ input: {} }).queryKey,
});

await Promise.all([
  queryClient.invalidateQueries({
    queryKey: orpc.item.list.queryOptions({ input: {} }).queryKey,
  }),
  queryClient.invalidateQueries({
    queryKey: orpc.user.me.queryOptions({ input: {} }).queryKey,
  }),
]);
```

## Infinite Query Pattern

```typescript
import { useInfiniteQuery } from "@tanstack/react-query";

export function useItemList() {
  return useInfiniteQuery({
    queryKey: ["items", "list"],
    queryFn: async ({ pageParam }) => {
      return client.item.list({ cursor: pageParam, limit: 10 });
    },
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    initialPageParam: undefined as string | undefined,
  });
}
```

## Polling Pattern

```typescript
for (let i = 0; i < 15; i++) {
  const result = await client.user.me({});
  if (result.avatarUrl) break;
  await new Promise((r) => setTimeout(r, 2000));
}
```
