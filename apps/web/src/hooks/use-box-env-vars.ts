"use client";

import type { BoxId } from "@vps-claude/shared";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { orpc } from "@/utils/orpc";

export function useBoxEnvVars(boxId: BoxId) {
  return useQuery(orpc.boxEnvVar.list.queryOptions({ input: { boxId } }));
}

export function useSetBoxEnvVar() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: {
      boxId: BoxId;
      key: string;
      type: "literal" | "credential_ref";
      value?: string;
      credentialKey?: string;
    }) => {
      return await orpc.boxEnvVar.set.call(input);
    },
    onSuccess: (_, vars) => {
      void queryClient.invalidateQueries({
        queryKey: orpc.boxEnvVar.list.queryKey({
          input: { boxId: vars.boxId },
        }),
      });
      toast.success("Environment variable saved");
    },
    onError: (error) => {
      toast.error(
        error instanceof Error
          ? error.message
          : "Failed to save environment variable"
      );
    },
  });
}

export function useDeleteBoxEnvVar() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: { boxId: BoxId; key: string }) => {
      return await orpc.boxEnvVar.delete.call(input);
    },
    onSuccess: (_, vars) => {
      void queryClient.invalidateQueries({
        queryKey: orpc.boxEnvVar.list.queryKey({
          input: { boxId: vars.boxId },
        }),
      });
      toast.success("Environment variable deleted");
    },
    onError: (error) => {
      toast.error(
        error instanceof Error
          ? error.message
          : "Failed to delete environment variable"
      );
    },
  });
}

export function useBulkSetBoxEnvVars() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: {
      boxId: BoxId;
      envVars: Array<{
        key: string;
        type: "literal" | "credential_ref";
        value?: string;
        credentialKey?: string;
      }>;
    }) => {
      return await orpc.boxEnvVar.bulkSet.call(input);
    },
    onSuccess: (_, vars) => {
      void queryClient.invalidateQueries({
        queryKey: orpc.boxEnvVar.list.queryKey({
          input: { boxId: vars.boxId },
        }),
      });
    },
    onError: (error) => {
      toast.error(
        error instanceof Error
          ? error.message
          : "Failed to save environment variables"
      );
    },
  });
}
