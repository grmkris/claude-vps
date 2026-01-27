"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { orpc } from "@/utils/orpc";

export function useSecrets() {
  return useQuery({
    queryKey: ["secrets"],
    queryFn: async () => {
      const result = await orpc.secret.list.call({});
      return result.secrets;
    },
  });
}

export function useSetSecret() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: { key: string; value: string }) => {
      return await orpc.secret.set.call(input);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["secrets"] });
      toast.success("Variable saved and synced to running boxes");
    },
    onError: (error) => {
      toast.error(
        error instanceof Error ? error.message : "Failed to save variable"
      );
    },
  });
}

export function useDeleteSecret() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (key: string) => {
      return await orpc.secret.delete.call({ key });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["secrets"] });
      toast.success("Variable deleted and synced to running boxes");
    },
    onError: (error) => {
      toast.error(
        error instanceof Error ? error.message : "Failed to delete variable"
      );
    },
  });
}
