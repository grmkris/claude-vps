"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { orpc } from "@/utils/orpc";

export function useCredentials() {
  return useQuery(orpc.credential.list.queryOptions({ input: {} }));
}

export function useSetCredential() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: { key: string; value: string }) => {
      return await orpc.credential.set.call(input);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: orpc.credential.list.queryKey({ input: {} }),
      });
      toast.success("Credential saved");
    },
    onError: (error) => {
      toast.error(
        error instanceof Error ? error.message : "Failed to save credential"
      );
    },
  });
}

export function useDeleteCredential() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (key: string) => {
      return await orpc.credential.delete.call({ key });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: orpc.credential.list.queryKey({ input: {} }),
      });
      toast.success("Credential deleted");
    },
    onError: (error) => {
      toast.error(
        error instanceof Error ? error.message : "Failed to delete credential"
      );
    },
  });
}
