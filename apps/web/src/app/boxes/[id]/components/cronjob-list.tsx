"use client";

import type { BoxCronjobId, BoxId } from "@vps-claude/shared";

import {
  CalendarClock,
  ChevronDown,
  ChevronRight,
  Clock,
  Pause,
  Play,
  Plus,
  Trash2,
} from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  useCronjobExecutions,
  useCronjobs,
  useDeleteCronjob,
  useToggleCronjob,
} from "@/hooks/use-cronjobs";
import { describeCron } from "@/utils/cron";
import { formatRelativeTime } from "@/utils/time";

import { CronjobForm } from "./cronjob-form";

function ExecutionStatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    pending: "bg-yellow-500/20 text-yellow-600",
    waking_box: "bg-blue-500/20 text-blue-600",
    running: "bg-blue-500/20 text-blue-600",
    completed: "bg-green-500/20 text-green-600",
    failed: "bg-red-500/20 text-red-600",
  };

  return (
    <span
      className={`text-xs font-medium px-2 py-0.5 rounded ${colors[status] ?? "bg-gray-500/20 text-gray-600"}`}
    >
      {status}
    </span>
  );
}

function CronjobExecutions({ cronjobId }: { cronjobId: BoxCronjobId }) {
  const { data, isLoading } = useCronjobExecutions(cronjobId, 10);
  const executions = data?.executions ?? [];

  if (isLoading) {
    return (
      <div className="space-y-2 py-2">
        {[1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-8 w-full" />
        ))}
      </div>
    );
  }

  if (executions.length === 0) {
    return (
      <p className="text-sm text-muted-foreground py-2">No executions yet</p>
    );
  }

  return (
    <div className="space-y-1 py-2">
      {executions.map((exec) => (
        <div
          key={exec.id}
          className="flex items-center justify-between text-sm py-1 px-2 rounded hover:bg-secondary/50"
        >
          <div className="flex items-center gap-2">
            <ExecutionStatusBadge status={exec.status} />
            <span className="text-muted-foreground">
              {formatRelativeTime(exec.startedAt)}
            </span>
          </div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            {exec.durationMs && (
              <span>{(exec.durationMs / 1000).toFixed(1)}s</span>
            )}
            {exec.errorMessage && (
              <span className="text-destructive truncate max-w-[200px]">
                {exec.errorMessage}
              </span>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

export function CronjobList({ boxId }: { boxId: BoxId }) {
  const { data, isLoading } = useCronjobs(boxId);
  const toggleCronjob = useToggleCronjob(boxId);
  const deleteCronjob = useDeleteCronjob(boxId);
  const [expandedId, setExpandedId] = useState<BoxCronjobId | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<BoxCronjobId | null>(null);

  const cronjobs = data?.cronjobs ?? [];

  const handleDelete = async (id: BoxCronjobId) => {
    if (!confirm("Delete this cronjob?")) return;
    deleteCronjob.mutate(id);
  };

  if (isLoading) {
    return (
      <div className="space-y-3">
        {[1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-16 w-full" />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h3 className="text-lg font-medium">Scheduled Tasks</h3>
        <Button
          size="sm"
          onClick={() => {
            setEditingId(null);
            setShowForm(true);
          }}
        >
          <Plus className="h-4 w-4 mr-1" />
          New Cronjob
        </Button>
      </div>

      {showForm && (
        <CronjobForm
          boxId={boxId}
          editingId={editingId}
          cronjob={
            editingId ? cronjobs.find((c) => c.id === editingId) : undefined
          }
          onClose={() => {
            setShowForm(false);
            setEditingId(null);
          }}
        />
      )}

      {cronjobs.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border p-8 text-center">
          <CalendarClock className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
          <p className="text-muted-foreground">No scheduled tasks</p>
          <p className="text-sm text-muted-foreground mt-1">
            Create a cronjob to run Claude on a schedule
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {cronjobs.map((cronjob) => (
            <div
              key={cronjob.id}
              className="rounded-lg border border-border bg-card overflow-hidden"
            >
              <div className="px-4 py-3 flex items-center gap-4">
                <button
                  type="button"
                  onClick={() =>
                    setExpandedId(expandedId === cronjob.id ? null : cronjob.id)
                  }
                  className="text-muted-foreground hover:text-foreground"
                >
                  {expandedId === cronjob.id ? (
                    <ChevronDown className="h-4 w-4" />
                  ) : (
                    <ChevronRight className="h-4 w-4" />
                  )}
                </button>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{cronjob.name}</span>
                    {!cronjob.enabled && (
                      <span className="text-xs px-2 py-0.5 rounded bg-secondary text-muted-foreground">
                        Disabled
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-3 text-sm text-muted-foreground">
                    <span className="flex items-center gap-1">
                      <Clock className="h-3 w-3" />
                      {describeCron(cronjob.schedule)}
                    </span>
                    {cronjob.lastRunAt && (
                      <span>Last: {formatRelativeTime(cronjob.lastRunAt)}</span>
                    )}
                    {cronjob.nextRunAt && cronjob.enabled && (
                      <span>Next: {formatRelativeTime(cronjob.nextRunAt)}</span>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => toggleCronjob.mutate(cronjob.id)}
                    disabled={toggleCronjob.isPending}
                    title={cronjob.enabled ? "Pause" : "Resume"}
                  >
                    {cronjob.enabled ? (
                      <Pause className="h-4 w-4" />
                    ) : (
                      <Play className="h-4 w-4" />
                    )}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setEditingId(cronjob.id);
                      setShowForm(true);
                    }}
                  >
                    Edit
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleDelete(cronjob.id)}
                    disabled={deleteCronjob.isPending}
                    className="text-destructive hover:text-destructive"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>

              {expandedId === cronjob.id && (
                <div className="px-4 pb-4 border-t border-border pt-3">
                  <div className="bg-secondary/50 rounded-md p-3 mb-3">
                    <p className="text-xs text-muted-foreground mb-1">
                      Prompt:
                    </p>
                    <pre className="text-sm whitespace-pre-wrap font-mono">
                      {cronjob.prompt}
                    </pre>
                  </div>
                  <div>
                    <p className="text-sm font-medium mb-2">
                      Recent Executions
                    </p>
                    <CronjobExecutions cronjobId={cronjob.id} />
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
