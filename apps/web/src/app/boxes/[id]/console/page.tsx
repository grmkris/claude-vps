"use client";

import type { BoxId } from "@vps-claude/shared";

import { useParams } from "next/navigation";

import { BoxCommandRunner } from "@/components/box-command-runner";
import { useBox } from "@/hooks/use-boxes";

export default function ConsolePage() {
  const { id } = useParams<{ id: BoxId }>();
  const { data: boxData } = useBox(id);

  if (boxData?.box?.status !== "running") {
    return (
      <div className="rounded-lg border border-dashed border-border p-8 text-center">
        <p className="text-muted-foreground">Box is not running</p>
      </div>
    );
  }

  return <BoxCommandRunner boxId={id} className="h-[500px]" />;
}
