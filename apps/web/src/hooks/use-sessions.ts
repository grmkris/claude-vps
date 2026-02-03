"use client";

import type { BoxId } from "@vps-claude/shared";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useRef, useState } from "react";

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

interface StreamingState {
  isStreaming: boolean;
  streamingText: string;
  currentTool: string | null;
  error: string | null;
}

export function useStreamingSession(boxId: BoxId) {
  const queryClient = useQueryClient();
  const [state, setState] = useState<StreamingState>({
    isStreaming: false,
    streamingText: "",
    currentTool: null,
    error: null,
  });
  const abortControllerRef = useRef<AbortController | null>(null);

  const sendStreamingMessage = useCallback(
    async (params: {
      message: string;
      contextType?: string;
      contextId?: string;
    }) => {
      // Abort any existing stream
      abortControllerRef.current?.abort();
      abortControllerRef.current = new AbortController();

      setState({
        isStreaming: true,
        streamingText: "",
        currentTool: null,
        error: null,
      });

      try {
        const stream = await client.boxSessions.stream(
          {
            id: boxId,
            message: params.message,
            contextType: params.contextType ?? "chat",
            contextId: params.contextId,
          },
          { signal: abortControllerRef.current.signal }
        );

        for await (const chunk of stream) {
          const { event, data } = chunk as {
            event: string;
            data: {
              type?: string;
              event?: {
                type: string;
                content_block?: { type: string; name?: string };
                delta?: { type: string; text?: string };
              };
              message?: string;
            };
          };

          if (data?.type === "stream_event" && data.event) {
            const evt = data.event;

            // Handle text deltas
            if (
              evt.type === "content_block_delta" &&
              evt.delta?.type === "text_delta" &&
              evt.delta.text
            ) {
              setState((prev) => ({
                ...prev,
                streamingText: prev.streamingText + evt.delta!.text!,
              }));
            }

            // Handle tool start
            if (
              evt.type === "content_block_start" &&
              evt.content_block?.type === "tool_use"
            ) {
              setState((prev) => ({
                ...prev,
                currentTool: evt.content_block?.name ?? null,
              }));
            }

            // Handle tool end
            if (evt.type === "content_block_stop") {
              setState((prev) => ({
                ...prev,
                currentTool: null,
              }));
            }
          }

          // Handle errors
          if (event === "error") {
            setState((prev) => ({
              ...prev,
              error: data?.message ?? "Unknown error",
            }));
          }
        }
      } catch (error) {
        if ((error as Error).name !== "AbortError") {
          setState((prev) => ({
            ...prev,
            error: error instanceof Error ? error.message : "Unknown error",
          }));
        }
      } finally {
        setState((prev) => ({ ...prev, isStreaming: false }));

        // Refresh sessions list
        void queryClient.invalidateQueries({
          queryKey: orpc.boxSessions.list.queryOptions({
            input: { id: boxId },
          }).queryKey,
        });
      }
    },
    [boxId, queryClient]
  );

  const cancelStream = useCallback(() => {
    abortControllerRef.current?.abort();
    setState((prev) => ({ ...prev, isStreaming: false }));
  }, []);

  return {
    ...state,
    sendStreamingMessage,
    cancelStream,
  };
}
