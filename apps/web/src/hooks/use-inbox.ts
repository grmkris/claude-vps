"use client";

import type { BoxId } from "@vps-claude/shared";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { orpc } from "@/utils/orpc";

export function useInboxItems(
  boxId: BoxId | undefined,
  options?: {
    type?: ("email" | "cron" | "webhook" | "message")[];
    status?: "pending" | "delivered" | "read";
    limit?: number;
  }
) {
  return useQuery({
    ...orpc.agentInbox.listByBox.queryOptions({
      input: {
        boxId: boxId!,
        type: options?.type,
        status: options?.status,
        limit: options?.limit,
      },
    }),
    enabled: Boolean(boxId),
    refetchInterval: 10000,
  });
}

export function useInboxCounts(boxId: BoxId | undefined) {
  return useQuery({
    ...orpc.agentInbox.getUnreadCounts.queryOptions({
      input: { boxId: boxId! },
    }),
    enabled: Boolean(boxId),
    refetchInterval: 30000,
  });
}

export function useMarkInboxRead() {
  const queryClient = useQueryClient();

  return useMutation(
    orpc.agentInbox.markRead.mutationOptions({
      onSuccess: ({ boxId }) => {
        void queryClient.invalidateQueries({
          queryKey: orpc.agentInbox.listByBox.queryKey({
            input: { boxId },
          }),
        });
      },
    })
  );
}
