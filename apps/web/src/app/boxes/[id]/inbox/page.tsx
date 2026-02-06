"use client";

import type { BoxId } from "@vps-claude/shared";

import { SERVICE_URLS } from "@vps-claude/shared/services.schema";
import { Clock, Mail, MailOpen, MessageSquare, Webhook } from "lucide-react";
import { useParams } from "next/navigation";
import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { env } from "@/env";
import { useBox } from "@/hooks/use-boxes";
import {
  useInboxCounts,
  useInboxItems,
  useMarkInboxRead,
} from "@/hooks/use-inbox";

type InboxType = "email" | "cron" | "webhook" | "message";

type InboxItem = NonNullable<
  ReturnType<typeof useInboxItems>["data"]
>["items"][number];

const TYPE_ICONS: Record<InboxType, typeof Mail> = {
  email: Mail,
  cron: Clock,
  webhook: Webhook,
  message: MessageSquare,
};

const TYPE_COLORS: Record<InboxType, string> = {
  email: "bg-blue-500/20 text-blue-600",
  cron: "bg-purple-500/20 text-purple-600",
  webhook: "bg-orange-500/20 text-orange-600",
  message: "bg-green-500/20 text-green-600",
};

const STATUS_COLORS: Record<string, string> = {
  pending: "bg-yellow-500/20 text-yellow-600",
  delivered: "bg-blue-500/20 text-blue-600",
  read: "bg-gray-500/20 text-gray-600",
};

function TypeBadge({ type }: { type: InboxType }) {
  const Icon = TYPE_ICONS[type];
  return (
    <span
      className={`inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded ${TYPE_COLORS[type]}`}
    >
      <Icon className="h-3 w-3" />
      {type}
    </span>
  );
}

function StatusBadge({ status }: { status: string }) {
  return (
    <span
      className={`text-xs font-medium px-2 py-0.5 rounded ${STATUS_COLORS[status] ?? "bg-gray-500/20 text-gray-600"}`}
    >
      {status}
    </span>
  );
}

function formatRelativeTime(date: Date | string): string {
  const now = new Date();
  const d = typeof date === "string" ? new Date(date) : date;
  const diffMs = now.getTime() - d.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return "just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  return `${diffDays}d ago`;
}

function getItemTitle(item: InboxItem): string {
  if (item.type === "email") {
    return item.metadata?.subject ?? "(no subject)";
  }
  if (item.type === "cron") {
    return `Cron trigger: ${item.metadata?.cronJobId ?? "unknown"}`;
  }
  if (item.type === "webhook") {
    return "Webhook payload";
  }
  if (item.type === "message") {
    return "Inter-agent message";
  }
  return "Unknown item";
}

function getItemSender(item: InboxItem): string {
  if (item.sourceType === "external" && item.sourceExternal) {
    return item.sourceExternal.name ?? item.sourceExternal.email ?? "Unknown";
  }
  if (item.sourceType === "box" && item.sourceBoxId) {
    return `Box: ${item.sourceBoxId}`;
  }
  if (item.sourceType === "system") {
    return "System";
  }
  return "Unknown";
}

function FilterButton({
  active,
  onClick,
  icon: Icon,
  label,
  count,
}: {
  active: boolean;
  onClick: () => void;
  icon?: typeof Mail;
  label: string;
  count?: number;
}) {
  return (
    <Button
      variant={active ? "default" : "outline"}
      size="sm"
      onClick={onClick}
      className="gap-1.5"
    >
      {Icon && <Icon className="h-4 w-4" />}
      {label}
      {count !== undefined && count > 0 && (
        <Badge variant={active ? "outline" : "secondary"} className="ml-1">
          {count}
        </Badge>
      )}
    </Button>
  );
}

export default function InboxPage() {
  const { id } = useParams<{ id: BoxId }>();
  const { data: boxData } = useBox(id);
  const [activeType, setActiveType] = useState<InboxType | "all">("all");
  const [expandedItem, setExpandedItem] = useState<string | null>(null);

  const typeFilter = activeType === "all" ? undefined : [activeType];
  const { data: inboxData, isLoading } = useInboxItems(id, {
    type: typeFilter,
  });
  const { data: countsData } = useInboxCounts(id);
  const markRead = useMarkInboxRead();

  const box = boxData?.box;
  const items = inboxData?.items ?? [];
  const counts = countsData?.counts;

  const agentsDomain = SERVICE_URLS[env.NEXT_PUBLIC_ENV].agentsDomain;
  const emailAddress = box ? `${box.subdomain}@${agentsDomain}` : null;

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
      <div className="flex flex-wrap gap-2">
        <FilterButton
          active={activeType === "all"}
          onClick={() => setActiveType("all")}
          label="All"
          count={counts?.total}
        />
        <FilterButton
          active={activeType === "email"}
          onClick={() => setActiveType("email")}
          icon={Mail}
          label="Email"
          count={counts?.email}
        />
        <FilterButton
          active={activeType === "cron"}
          onClick={() => setActiveType("cron")}
          icon={Clock}
          label="Cron"
          count={counts?.cron}
        />
        <FilterButton
          active={activeType === "webhook"}
          onClick={() => setActiveType("webhook")}
          icon={Webhook}
          label="Webhook"
          count={counts?.webhook}
        />
        <FilterButton
          active={activeType === "message"}
          onClick={() => setActiveType("message")}
          icon={MessageSquare}
          label="Message"
          count={counts?.message}
        />
      </div>

      {items.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border p-8 text-center">
          <MailOpen className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
          <p className="text-muted-foreground">No items yet</p>
          {activeType === "all" || activeType === "email" ? (
            <p className="text-sm text-muted-foreground mt-1">
              Send an email to <span className="font-mono">{emailAddress}</span>{" "}
              to get started
            </p>
          ) : null}
        </div>
      ) : (
        <div className="space-y-2">
          {items.map((item) => (
            <div
              key={item.id}
              className="rounded-lg border border-border bg-card overflow-hidden"
            >
              <button
                type="button"
                className="w-full px-4 py-3 flex items-center gap-4 hover:bg-secondary/50 transition-colors text-left"
                onClick={() =>
                  setExpandedItem(expandedItem === item.id ? null : item.id)
                }
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <TypeBadge type={item.type as InboxType} />
                    <StatusBadge status={item.status} />
                    <span className="font-medium truncate">
                      {getItemSender(item)}
                    </span>
                  </div>
                  <p className="text-sm text-muted-foreground truncate">
                    {getItemTitle(item)}
                  </p>
                </div>
                <span className="text-xs text-muted-foreground whitespace-nowrap">
                  {formatRelativeTime(item.createdAt)}
                </span>
              </button>

              {expandedItem === item.id && (
                <div className="px-4 pb-4 border-t border-border pt-3 space-y-3">
                  <div className="text-sm space-y-1">
                    <p>
                      <span className="text-muted-foreground">From:</span>{" "}
                      {getItemSender(item)}
                    </p>
                    <p>
                      <span className="text-muted-foreground">Type:</span>{" "}
                      {item.type}
                    </p>
                    <p>
                      <span className="text-muted-foreground">Received:</span>{" "}
                      {new Date(item.createdAt).toLocaleString()}
                    </p>
                    {item.deliveredAt && (
                      <p>
                        <span className="text-muted-foreground">
                          Delivered:
                        </span>{" "}
                        {new Date(item.deliveredAt).toLocaleString()}
                      </p>
                    )}
                    {item.readAt && (
                      <p>
                        <span className="text-muted-foreground">Read:</span>{" "}
                        {new Date(item.readAt).toLocaleString()}
                      </p>
                    )}
                  </div>

                  {item.content && (
                    <div className="bg-secondary/50 rounded-md p-3">
                      <pre className="text-sm whitespace-pre-wrap font-mono">
                        {item.content}
                      </pre>
                    </div>
                  )}

                  {item.status !== "read" && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => markRead.mutate({ id: item.id })}
                      disabled={markRead.isPending}
                    >
                      Mark as read
                    </Button>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
