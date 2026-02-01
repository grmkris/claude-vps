"use client";

import type { BoxId } from "@vps-claude/shared";

import { SERVICE_URLS } from "@vps-claude/shared/services.schema";
import { MailOpen } from "lucide-react";
import { useParams } from "next/navigation";
import { useState } from "react";

import { Skeleton } from "@/components/ui/skeleton";
import { env } from "@/env";
import { useBox } from "@/hooks/use-boxes";
import { useBoxEmails } from "@/hooks/use-emails";

function EmailStatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    received: "bg-blue-500/20 text-blue-600",
    delivered: "bg-green-500/20 text-green-600",
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

export default function InboxPage() {
  const { id } = useParams<{ id: BoxId }>();
  const { data: boxData } = useBox(id);
  const { data: emailsData, isLoading: emailsLoading } = useBoxEmails(id);
  const [expandedEmail, setExpandedEmail] = useState<string | null>(null);

  const box = boxData?.box;
  const emails = emailsData?.emails ?? [];

  const agentsDomain = SERVICE_URLS[env.NEXT_PUBLIC_ENV].agentsDomain;
  const emailAddress = box ? `${box.subdomain}@${agentsDomain}` : null;

  if (emailsLoading) {
    return (
      <div className="space-y-3">
        {[1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-16 w-full" />
        ))}
      </div>
    );
  }

  if (emails.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border p-8 text-center">
        <MailOpen className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
        <p className="text-muted-foreground">No emails yet</p>
        <p className="text-sm text-muted-foreground mt-1">
          Send an email to <span className="font-mono">{emailAddress}</span> to
          get started
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {emails.map((email) => (
        <div
          key={email.id}
          className="rounded-lg border border-border bg-card overflow-hidden"
        >
          <button
            type="button"
            className="w-full px-4 py-3 flex items-center gap-4 hover:bg-secondary/50 transition-colors text-left"
            onClick={() =>
              setExpandedEmail(expandedEmail === email.id ? null : email.id)
            }
          >
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <span className="font-medium truncate">
                  {email.fromName ?? email.fromEmail}
                </span>
                <EmailStatusBadge status={email.status} />
              </div>
              <p className="text-sm text-muted-foreground truncate">
                {email.subject ?? "(no subject)"}
              </p>
            </div>
            <span className="text-xs text-muted-foreground whitespace-nowrap">
              {formatRelativeTime(email.receivedAt)}
            </span>
          </button>

          {expandedEmail === email.id && (
            <div className="px-4 pb-4 border-t border-border pt-3 space-y-3">
              <div className="text-sm space-y-1">
                <p>
                  <span className="text-muted-foreground">From:</span>{" "}
                  {email.fromName && <>{email.fromName} </>}
                  <span className="font-mono text-xs">
                    &lt;{email.fromEmail}&gt;
                  </span>
                </p>
                <p>
                  <span className="text-muted-foreground">Subject:</span>{" "}
                  {email.subject ?? "(no subject)"}
                </p>
                <p>
                  <span className="text-muted-foreground">Received:</span>{" "}
                  {new Date(email.receivedAt).toLocaleString()}
                </p>
                {email.deliveredAt && (
                  <p>
                    <span className="text-muted-foreground">Delivered:</span>{" "}
                    {new Date(email.deliveredAt).toLocaleString()}
                  </p>
                )}
                {email.errorMessage && (
                  <p className="text-destructive">
                    <span className="text-muted-foreground">Error:</span>{" "}
                    {email.errorMessage}
                  </p>
                )}
              </div>

              {email.textBody && (
                <div className="bg-secondary/50 rounded-md p-3">
                  <pre className="text-sm whitespace-pre-wrap font-mono">
                    {email.textBody}
                  </pre>
                </div>
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
