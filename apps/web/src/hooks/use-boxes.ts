"use client";

import type { BoxId } from "@vps-claude/shared";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import type { CreateBoxInput, DeployBoxInput, Box } from "@/lib/orpc-types";

import { client, orpc } from "@/utils/orpc";

export function useBoxes() {
  return useQuery({
    ...orpc.box.list.queryOptions({ input: {} }),
    // Auto-poll every 5s while any box is deploying
    refetchInterval: (query) => {
      const hasDeploying = query.state.data?.boxes?.some(
        (b: Box) => b.status === "deploying"
      );
      return hasDeploying ? 5000 : false;
    },
  });
}

export function useBox(id: BoxId) {
  return useQuery(orpc.box.byId.queryOptions({ input: { id } }));
}

export function useCreateBox() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: CreateBoxInput) => client.box.create(input),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: orpc.box.list.queryOptions({ input: {} }).queryKey,
      });
      toast.success("Box created!");
    },
    onError: (error) => {
      toast.error(
        error instanceof Error ? error.message : "Failed to create box"
      );
    },
  });
}

export function useDeployBox() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: DeployBoxInput) => client.box.deploy(input),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: orpc.box.list.queryOptions({ input: {} }).queryKey,
      });
      toast.success("Deployment started!");
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Failed to deploy");
    },
  });
}

export function useDeleteBox() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: BoxId) => client.box.delete({ id }),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: orpc.box.list.queryOptions({ input: {} }).queryKey,
      });
      toast.success("Box deleted!");
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Failed to delete");
    },
  });
}

export function useBoxUrl(id: BoxId) {
  return useQuery({
    ...orpc.box.getUrl.queryOptions({ input: { id } }),
    enabled: !!id,
  });
}
