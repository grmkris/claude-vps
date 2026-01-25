"use client";

import type { BoxId } from "@vps-claude/shared";

import { useQuery } from "@tanstack/react-query";

import { orpc } from "@/utils/orpc";

export function useBoxEmails(boxId: BoxId | undefined) {
  return useQuery({
    ...orpc.box.emails.queryOptions({ input: { id: boxId! } }),
    enabled: Boolean(boxId),
    refetchInterval: 10000,
  });
}
