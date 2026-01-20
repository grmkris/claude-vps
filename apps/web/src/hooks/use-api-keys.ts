"use client";

import type { API_KEY_PERMISSIONS } from "@vps-claude/auth";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { orpc } from "@/utils/orpc";

// Permission types for creating API keys
export type ApiKeyPermissions = {
  box?: (typeof API_KEY_PERMISSIONS.box)[number][];
  secret?: (typeof API_KEY_PERMISSIONS.secret)[number][];
  skill?: (typeof API_KEY_PERMISSIONS.skill)[number][];
};

export type CreateApiKeyInput = {
  name: string;
  permissions?: ApiKeyPermissions;
  expiresIn?: number; // seconds
};

export function useApiKeys() {
  return useQuery({
    queryKey: ["api-keys"],
    queryFn: async () => {
      const result = await orpc.apiKey.list.call({});
      return result.apiKeys;
    },
  });
}

export function useCreateApiKey() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: CreateApiKeyInput) => {
      return await orpc.apiKey.create.call({
        name: input.name,
        permissions: input.permissions,
        expiresIn: input.expiresIn,
      });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["api-keys"] });
      toast.success("API key created!");
    },
    onError: (error) => {
      toast.error(
        error instanceof Error ? error.message : "Failed to create API key"
      );
    },
  });
}

export function useRevokeApiKey() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (keyId: string) => {
      return await orpc.apiKey.delete.call({ keyId });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["api-keys"] });
      toast.success("API key revoked!");
    },
    onError: (error) => {
      toast.error(
        error instanceof Error ? error.message : "Failed to revoke API key"
      );
    },
  });
}
