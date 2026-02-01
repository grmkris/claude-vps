"use client";

import type { BoxId } from "@vps-claude/shared";

import { useParams } from "next/navigation";

import { useBox } from "@/hooks/use-boxes";

import { CronjobList } from "../components/cronjob-list";

export default function CronjobsPage() {
  const { id } = useParams<{ id: BoxId }>();
  const { data: boxData } = useBox(id);

  if (boxData?.box?.status !== "running") {
    return (
      <div className="rounded-lg border border-dashed border-border p-8 text-center">
        <p className="text-muted-foreground">Box is not running</p>
      </div>
    );
  }

  return <CronjobList boxId={id} />;
}
