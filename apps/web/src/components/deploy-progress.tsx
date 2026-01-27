"use client";

import {
  Check,
  ChevronDown,
  ChevronRight,
  Circle,
  Loader2,
  X,
} from "lucide-react";
import { useMemo, useState } from "react";

import type { Box } from "@/lib/orpc-types";

import { useDeployProgress } from "@/hooks/use-boxes";
import { cn } from "@/lib/utils";

export function DeployProgress({ boxId }: { boxId: Box["id"] }) {
  const { data } = useDeployProgress(boxId);
  const [expanded, setExpanded] = useState(false);
  const [expandedParents, setExpandedParents] = useState<Set<string>>(
    new Set()
  );

  const {
    parentSteps,
    childrenByParent,
    currentStep,
    completed,
    total,
    hasError,
  } = useMemo(() => {
    const steps = data?.steps ?? [];
    const parents = steps
      .filter((s) => !s.parentId)
      .sort((a, b) => a.stepOrder - b.stepOrder);
    const done = parents.filter((s) => s.status === "completed").length;
    const current =
      parents.find((s) => s.status === "running") ??
      parents.find((s) => s.status === "pending");
    const error = parents.some((s) => s.status === "failed");

    // Group children by parent
    const childMap = new Map<string, typeof steps>();
    for (const step of steps) {
      if (step.parentId) {
        const existing = childMap.get(step.parentId) ?? [];
        existing.push(step);
        childMap.set(step.parentId, existing);
      }
    }

    return {
      parentSteps: parents,
      childrenByParent: childMap,
      currentStep: current,
      completed: done,
      total: parents.length,
      hasError: error,
    };
  }, [data?.steps]);

  const toggleParent = (parentId: string) => {
    setExpandedParents((prev) => {
      const next = new Set(prev);
      if (next.has(parentId)) {
        next.delete(parentId);
      } else {
        next.add(parentId);
      }
      return next;
    });
  };

  const percentage = total > 0 ? (completed / total) * 100 : 0;

  return (
    <div className="space-y-2">
      {/* Header: step name + count */}
      <div className="flex items-center justify-between text-sm">
        <span className="text-muted-foreground truncate">
          {currentStep?.name ?? "Preparing..."}
        </span>
        <span className="font-mono text-xs text-muted-foreground">
          {completed}/{total}
        </span>
      </div>

      {/* Progress bar with glow */}
      <div className="h-1 bg-secondary/50 rounded-full overflow-hidden">
        <div
          className={cn(
            "h-full rounded-full transition-all duration-500 ease-out",
            hasError
              ? "bg-destructive"
              : "bg-primary shadow-[0_0_8px_hsl(var(--primary)/0.5)]"
          )}
          style={{ width: `${percentage}%` }}
        />
      </div>

      {/* Expand toggle */}
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="text-xs text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1"
      >
        <ChevronDown
          className={cn(
            "h-3 w-3 transition-transform",
            expanded && "rotate-180"
          )}
        />
        {expanded ? "Hide" : "Details"}
      </button>

      {/* Expanded step list */}
      {expanded && (
        <div className="space-y-1 text-xs border-l border-border pl-3 ml-1">
          {parentSteps.map((step) => {
            const children = childrenByParent.get(step.id);
            const hasChildren = children && children.length > 0;
            const isExpanded = expandedParents.has(step.id);

            return (
              <div key={step.id}>
                {hasChildren ? (
                  <button
                    type="button"
                    onClick={() => toggleParent(step.id)}
                    className="flex items-center gap-2 hover:bg-muted/50 rounded px-1 -ml-1 transition-colors w-full text-left"
                  >
                    <StepIcon status={step.status} />
                    <span
                      className={cn(
                        "flex-1",
                        step.status === "running" && "text-foreground",
                        step.status === "completed" && "text-muted-foreground",
                        step.status === "failed" && "text-destructive"
                      )}
                    >
                      {step.name}
                    </span>
                    {isExpanded ? (
                      <ChevronDown className="h-3 w-3 text-muted-foreground" />
                    ) : (
                      <ChevronRight className="h-3 w-3 text-muted-foreground" />
                    )}
                  </button>
                ) : (
                  <div className="flex items-center gap-2">
                    <StepIcon status={step.status} />
                    <span
                      className={cn(
                        step.status === "running" && "text-foreground",
                        step.status === "completed" && "text-muted-foreground",
                        step.status === "failed" && "text-destructive"
                      )}
                    >
                      {step.name}
                    </span>
                  </div>
                )}

                {/* Nested children */}
                {hasChildren && isExpanded && (
                  <div className="space-y-1 border-l border-border/50 pl-3 ml-1.5 mt-1">
                    {children.map((child) => (
                      <div key={child.id} className="flex items-center gap-2">
                        <StepIcon status={child.status} />
                        <span
                          className={cn(
                            child.status === "running" && "text-foreground",
                            child.status === "completed" &&
                              "text-muted-foreground",
                            child.status === "failed" && "text-destructive"
                          )}
                        >
                          {child.name}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function StepIcon({ status }: { status: string }) {
  if (status === "completed")
    return <Check className="h-3 w-3 text-green-500" />;
  if (status === "running")
    return <Loader2 className="h-3 w-3 text-primary animate-spin" />;
  if (status === "failed") return <X className="h-3 w-3 text-destructive" />;
  return <Circle className="h-3 w-3 text-muted-foreground/50" />;
}
