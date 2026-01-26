"use client";

import type { BoxId } from "@vps-claude/shared";

import {
  ChevronRight,
  File,
  Folder,
  Home,
  RefreshCw,
  Upload,
} from "lucide-react";
import { useRef, useState } from "react";

import type { FileEntry } from "@/lib/orpc-types";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useFileList, useFileUpload } from "@/hooks/use-filesystem";

interface FileBrowserProps {
  boxId: BoxId;
}

function formatFileSize(bytes?: number): string {
  if (bytes === undefined) return "-";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function sortEntries(entries: FileEntry[]): FileEntry[] {
  return [...entries].sort((a, b) => {
    // Directories first
    if (a.isDir && !b.isDir) return -1;
    if (!a.isDir && b.isDir) return 1;
    // Then alphabetically
    return a.name.localeCompare(b.name);
  });
}

export function FileBrowser({ boxId }: FileBrowserProps) {
  const [currentPath, setCurrentPath] = useState("/home/sprite");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { data, isLoading, refetch, isRefetching } = useFileList(
    boxId,
    currentPath
  );
  const uploadMutation = useFileUpload(boxId);

  const entries = data?.entries ? sortEntries(data.entries) : [];

  const pathParts = currentPath.split("/").filter(Boolean);

  const handleNavigate = (entry: FileEntry) => {
    if (entry.isDir) {
      setCurrentPath(entry.path);
    }
  };

  const handleBreadcrumbClick = (index: number) => {
    if (index === -1) {
      setCurrentPath("/");
    } else {
      const newPath = "/" + pathParts.slice(0, index + 1).join("/");
      setCurrentPath(newPath);
    }
  };

  const handleParentDir = () => {
    if (currentPath === "/") return;
    const parent =
      currentPath.substring(0, currentPath.lastIndexOf("/")) || "/";
    setCurrentPath(parent);
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async () => {
      const base64 = (reader.result as string).split(",")[1];
      if (!base64) return;

      const targetPath =
        currentPath === "/" ? `/${file.name}` : `${currentPath}/${file.name}`;
      await uploadMutation.mutateAsync({ path: targetPath, content: base64 });
      void refetch();
    };
    reader.readAsDataURL(file);

    // Reset input
    e.target.value = "";
  };

  return (
    <div className="rounded-lg border border-border bg-card">
      {/* Toolbar */}
      <div className="flex items-center justify-between border-b border-border px-4 py-2">
        {/* Breadcrumbs */}
        <div className="flex items-center gap-1 text-sm overflow-x-auto">
          <button
            type="button"
            onClick={() => handleBreadcrumbClick(-1)}
            className="flex items-center gap-1 hover:text-foreground text-muted-foreground transition-colors shrink-0"
          >
            <Home className="h-4 w-4" />
          </button>
          {pathParts.map((part, idx) => (
            <div key={idx} className="flex items-center gap-1 shrink-0">
              <ChevronRight className="h-4 w-4 text-muted-foreground" />
              <button
                type="button"
                onClick={() => handleBreadcrumbClick(idx)}
                className={`hover:text-foreground transition-colors ${
                  idx === pathParts.length - 1
                    ? "text-foreground font-medium"
                    : "text-muted-foreground"
                }`}
              >
                {part}
              </button>
            </div>
          ))}
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2 shrink-0">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => refetch()}
            disabled={isRefetching}
          >
            <RefreshCw
              className={`h-4 w-4 ${isRefetching ? "animate-spin" : ""}`}
            />
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploadMutation.isPending}
          >
            <Upload className="h-4 w-4 mr-1" />
            Upload
          </Button>
          <input
            ref={fileInputRef}
            type="file"
            className="hidden"
            onChange={handleFileSelect}
          />
        </div>
      </div>

      {/* File list */}
      <div className="divide-y divide-border">
        {isLoading ? (
          <div className="p-4 space-y-2">
            {[1, 2, 3, 4, 5].map((i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        ) : entries.length === 0 ? (
          <div className="p-8 text-center text-muted-foreground">
            <Folder className="h-8 w-8 mx-auto mb-2 opacity-50" />
            <p>Empty directory</p>
          </div>
        ) : (
          <>
            {/* Parent directory */}
            {currentPath !== "/" && (
              <button
                type="button"
                onClick={handleParentDir}
                className="w-full px-4 py-2 flex items-center gap-3 hover:bg-secondary/50 transition-colors text-left"
              >
                <Folder className="h-4 w-4 text-muted-foreground" />
                <span className="flex-1 text-muted-foreground">..</span>
              </button>
            )}

            {/* Entries */}
            {entries.map((entry) => (
              <button
                key={entry.path}
                type="button"
                onClick={() => handleNavigate(entry)}
                disabled={!entry.isDir}
                className={`w-full px-4 py-2 flex items-center gap-3 text-left transition-colors ${
                  entry.isDir
                    ? "hover:bg-secondary/50 cursor-pointer"
                    : "cursor-default"
                }`}
              >
                {entry.isDir ? (
                  <Folder className="h-4 w-4 text-blue-500" />
                ) : (
                  <File className="h-4 w-4 text-muted-foreground" />
                )}
                <span className="flex-1 truncate">{entry.name}</span>
                {!entry.isDir && (
                  <span className="text-xs text-muted-foreground">
                    {formatFileSize(entry.size)}
                  </span>
                )}
              </button>
            ))}
          </>
        )}
      </div>
    </div>
  );
}
