"use client";

import type { BoxId } from "@vps-claude/shared";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { client, orpc } from "@/utils/orpc";

export function useBoxSessions(boxId: BoxId | undefined) {
  return useQuery({
    ...orpc.boxDetails.sessions.queryOptions({ input: { id: boxId! } }),
    enabled: Boolean(boxId),
    refetchInterval: 10000,
  });
}

export function useSendMessage(boxId: BoxId) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (params: {
      message: string;
      contextType?: string;
      contextId?: string;
    }) => {
      return client.boxDetails.sessionSend({
        id: boxId,
        message: params.message,
        contextType: params.contextType ?? "chat",
        contextId: params.contextId,
      });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: orpc.boxDetails.sessions.queryOptions({
          input: { id: boxId },
        }).queryKey,
      });
    },
  });
}
