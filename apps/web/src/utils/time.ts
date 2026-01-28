export function formatRelativeTime(date: Date | string | null): string {
  if (!date) return "Never";
  const now = new Date();
  const d = typeof date === "string" ? new Date(date) : date;
  const diffMs = now.getTime() - d.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 0) {
    const futureMs = -diffMs;
    const futureMins = Math.floor(futureMs / 60000);
    const futureHours = Math.floor(futureMs / 3600000);
    if (futureMins < 60) return `in ${futureMins}m`;
    if (futureHours < 24) return `in ${futureHours}h`;
    return d.toLocaleDateString();
  }

  if (diffMins < 1) return "just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  return `${diffDays}d ago`;
}
