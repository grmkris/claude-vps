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
        const response = await fetch(`/rpc/box/${boxId}/sessions/stream`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            message: params.message,
            contextType: params.contextType ?? "chat",
            contextId: params.contextId,
          }),
          credentials: "include",
          signal: abortControllerRef.current.signal,
        });

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          throw new Error(
            (errorData as { error?: string }).error ||
              `Request failed: ${response.status}`
          );
        }

        const reader = response.body?.getReader();
        if (!reader) {
          throw new Error("No response body");
        }

        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });

          // Parse SSE events
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";

          let currentEvent = "";
          let currentData = "";

          for (const line of lines) {
            if (line.startsWith("event: ")) {
              currentEvent = line.slice(7);
            } else if (line.startsWith("data: ")) {
              currentData = line.slice(6);
            } else if (line === "" && currentData) {
              // Process event
              try {
                const msg = JSON.parse(currentData) as {
                  type: string;
                  event?: {
                    type: string;
                    content_block?: { type: string; name?: string };
                    delta?: { type: string; text?: string };
                  };
                };

                if (msg.type === "stream_event" && msg.event) {
                  const event = msg.event;

                  // Handle text deltas
                  if (
                    event.type === "content_block_delta" &&
                    event.delta?.type === "text_delta" &&
                    event.delta.text
                  ) {
                    setState((prev) => ({
                      ...prev,
                      streamingText: prev.streamingText + event.delta!.text!,
                    }));
                  }

                  // Handle tool start
                  if (
                    event.type === "content_block_start" &&
                    event.content_block?.type === "tool_use"
                  ) {
                    setState((prev) => ({
                      ...prev,
                      currentTool: event.content_block?.name ?? null,
                    }));
                  }

                  // Handle tool end
                  if (event.type === "content_block_stop") {
                    setState((prev) => ({
                      ...prev,
                      currentTool: null,
                    }));
                  }
                }

                // Handle errors
                if (currentEvent === "error") {
                  const errorMsg = msg as { message?: string };
                  setState((prev) => ({
                    ...prev,
                    error: errorMsg.message ?? "Unknown error",
                  }));
                }
              } catch {
                // Ignore parse errors
              }

              currentEvent = "";
              currentData = "";
            }
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
