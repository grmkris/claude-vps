"use client";

import type { BoxCronjobId, BoxId } from "@vps-claude/shared";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { orpc } from "@/utils/orpc";

export function useCronjobs(boxId: BoxId | undefined) {
  return useQuery({
    ...orpc.cronjob.list.queryOptions({ input: { boxId: boxId! } }),
    enabled: Boolean(boxId),
    refetchInterval: 30000,
  });
}

export function useCreateCronjob(boxId: BoxId) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: { name: string; schedule: string; prompt: string }) =>
      orpc.cronjob.create.call({
        boxId,
        ...input,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: orpc.cronjob.list.queryOptions({ input: { boxId } }).queryKey,
      });
    },
  });
}

export function useUpdateCronjob(boxId: BoxId) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: {
      id: BoxCronjobId;
      name?: string;
      schedule?: string;
      prompt?: string;
      enabled?: boolean;
    }) => orpc.cronjob.update.call(input),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: orpc.cronjob.list.queryOptions({ input: { boxId } }).queryKey,
      });
    },
  });
}

export function useDeleteCronjob(boxId: BoxId) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: BoxCronjobId) => orpc.cronjob.delete.call({ id }),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: orpc.cronjob.list.queryOptions({ input: { boxId } }).queryKey,
      });
    },
  });
}

export function useToggleCronjob(boxId: BoxId) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: BoxCronjobId) => orpc.cronjob.toggle.call({ id }),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: orpc.cronjob.list.queryOptions({ input: { boxId } }).queryKey,
      });
    },
  });
}

export function useCronjobExecutions(
  cronjobId: BoxCronjobId | undefined,
  limit?: number
) {
  return useQuery({
    ...orpc.cronjob.executions.queryOptions({
      input: { id: cronjobId!, limit },
    }),
    enabled: Boolean(cronjobId),
    refetchInterval: 10000,
  });
}
