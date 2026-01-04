import type { BoxStatus } from "@/lib/orpc-types";

interface StatusDotProps {
  status: BoxStatus;
  showLabel?: boolean;
}

const statusConfig = {
  pending: { label: "Pending", className: "status-dot--pending" },
  deploying: { label: "Deploying", className: "status-dot--deploying" },
  running: { label: "Running", className: "status-dot--running" },
  error: { label: "Error", className: "status-dot--error" },
  deleted: { label: "Deleted", className: "status-dot--pending" },
} as const;

export function StatusDot({ status, showLabel = false }: StatusDotProps) {
  const config = statusConfig[status] || statusConfig.pending;

  return (
    <span className="inline-flex items-center gap-2">
      <span className={`status-dot ${config.className}`} />
      {showLabel && (
        <span className="text-sm text-muted-foreground">{config.label}</span>
      )}
    </span>
  );
}
