"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { client, orpc } from "@/utils/orpc";

export function useEnvironments() {
  return useQuery(orpc.environment.list.queryOptions());
}

export function useEnvironment(id: string) {
  return useQuery(orpc.environment.byId.queryOptions({ id }));
}

export function useCreateEnvironment() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: { name: string; password: string }) =>
      client.environment.create(input),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: orpc.environment.list.queryOptions().queryKey,
      });
      toast.success("Environment created!");
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Failed to create environment");
    },
  });
}

export function useDeployEnvironment() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: { id: string; password: string }) => client.environment.deploy(input),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: orpc.environment.list.queryOptions().queryKey,
      });
      toast.success("Deployment started!");
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Failed to deploy");
    },
  });
}

export function useDeleteEnvironment() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => client.environment.delete({ id }),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: orpc.environment.list.queryOptions().queryKey,
      });
      toast.success("Environment deleted!");
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Failed to delete");
    },
  });
}

export function useEnvironmentUrl(id: string) {
  return useQuery({
    ...orpc.environment.getUrl.queryOptions({ id }),
    enabled: !!id,
  });
}
