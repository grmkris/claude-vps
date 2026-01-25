"use client";

import type { BoxId } from "@vps-claude/shared";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { client, orpc } from "@/utils/orpc";

export function useFileList(boxId: BoxId | undefined, path: string) {
  return useQuery({
    ...orpc.boxFs.list.queryOptions({ input: { id: boxId!, path } }),
    enabled: Boolean(boxId),
  });
}

export function useFileUpload(boxId: BoxId) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      path,
      content,
    }: {
      path: string;
      content: string; // base64
    }) => client.boxFs.write({ id: boxId, path, content }),
    onSuccess: (_, variables) => {
      // Extract directory from path for cache invalidation
      const dir =
        variables.path.substring(0, variables.path.lastIndexOf("/")) || "/";
      void queryClient.invalidateQueries({
        queryKey: orpc.boxFs.list.queryOptions({
          input: { id: boxId, path: dir },
        }).queryKey,
      });
      toast.success("File uploaded");
    },
    onError: (error) => {
      toast.error(
        error instanceof Error ? error.message : "Failed to upload file"
      );
    },
  });
}
