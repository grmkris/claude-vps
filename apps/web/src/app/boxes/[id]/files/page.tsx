"use client";

import type { BoxId } from "@vps-claude/shared";

import { useParams } from "next/navigation";

import { useBox } from "@/hooks/use-boxes";

import { FileBrowser } from "../components/file-browser";

export default function FilesPage() {
  const { id } = useParams<{ id: BoxId }>();
  const { data: boxData } = useBox(id);

  if (boxData?.box?.status !== "running") {
    return (
      <div className="rounded-lg border border-dashed border-border p-8 text-center">
        <p className="text-muted-foreground">Box is not running</p>
      </div>
    );
  }

  return <FileBrowser boxId={id} provider={boxData.box.provider} />;
}
