"use client";

import type { BoxId } from "@vps-claude/shared";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { client, orpc } from "@/utils/orpc";

export function useBoxSessions(boxId: BoxId | undefined) {
  return useQuery({
    ...orpc.boxSessions.list.queryOptions({ input: { id: boxId! } }),
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
      return client.boxSessions.send({
        id: boxId,
        message: params.message,
        contextType: params.contextType ?? "chat",
        contextId: params.contextId,
      });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: orpc.boxSessions.list.queryOptions({
          input: { id: boxId },
        }).queryKey,
      });
    },
  });
}

export function useSessionHistory(
  boxId: BoxId | undefined,
  sessionId: string | null
) {
  return useQuery({
    ...orpc.boxSessions.history.queryOptions({
      input: { id: boxId!, sessionId: sessionId! },
    }),
    enabled: Boolean(boxId && sessionId),
  });
}
