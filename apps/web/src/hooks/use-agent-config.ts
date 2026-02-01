"use client";

import type { BoxId, McpServerConfig } from "@vps-claude/shared";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { orpc } from "@/utils/orpc";

export function useAgentConfig(boxId: BoxId) {
  return useQuery({
    queryKey: ["agentConfig", boxId],
    queryFn: async () => {
      const result = await orpc.boxAgentConfig.get.call({ boxId });
      return result.config;
    },
  });
}

export type { McpServerConfig };

export function useUpdateAgentConfig() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: {
      boxId: BoxId;
      model?: string;
      systemPrompt?: string | null;
      appendSystemPrompt?: string | null;
      tools?: string[] | null;
      allowedTools?: string[] | null;
      disallowedTools?: string[] | null;
      permissionMode?: string | null;
      maxTurns?: number | null;
      maxBudgetUsd?: string | null;
      persistSession?: boolean | null;
      mcpServers?: Record<string, McpServerConfig> | null;
    }) => {
      return await orpc.boxAgentConfig.update.call(input);
    },
    onSuccess: (_, vars) => {
      void queryClient.invalidateQueries({
        queryKey: ["agentConfig", vars.boxId],
      });
      toast.success("Agent configuration saved");
    },
    onError: (error) => {
      toast.error(
        error instanceof Error
          ? error.message
          : "Failed to save agent configuration"
      );
    },
  });
}
