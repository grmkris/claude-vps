"use client";

import type { BoxId } from "@vps-claude/shared";

import { SERVICE_URLS } from "@vps-claude/shared/services.schema";
import {
  ArrowLeft,
  Check,
  Copy,
  ExternalLink,
  Mail,
  MailOpen,
} from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";

import { StatusDot } from "@/components/status-dot";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { env } from "@/env";
import { useBox } from "@/hooks/use-boxes";
import { useBoxEmails } from "@/hooks/use-emails";

import { FileBrowser } from "./components/file-browser";

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <button
      type="button"
      onClick={handleCopy}
      className="p-1 hover:bg-secondary rounded transition-colors"
      title="Copy to clipboard"
    >
      {copied ? (
        <Check className="h-4 w-4 text-green-500" />
      ) : (
        <Copy className="h-4 w-4 text-muted-foreground" />
      )}
    </button>
  );
}

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

export default function BoxDetailPage() {
  const { id } = useParams<{ id: BoxId }>();

  const { data: boxData, isLoading: boxLoading } = useBox(id);
  const { data: emailsData, isLoading: emailsLoading } = useBoxEmails(id);

  const [expandedEmail, setExpandedEmail] = useState<string | null>(null);

  const box = boxData?.box;
  const emails = emailsData?.emails ?? [];

  const agentsDomain = SERVICE_URLS[env.NEXT_PUBLIC_ENV].agentsDomain;
  const emailAddress = box ? `${box.subdomain}@${agentsDomain}` : null;

  if (boxLoading) {
    return (
      <div className="mx-auto max-w-4xl px-6 lg:px-8 py-12 space-y-8">
        <Skeleton className="h-8 w-48" />
        <div className="space-y-4">
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
        </div>
      </div>
    );
  }

  if (!box) {
    return (
      <div className="mx-auto max-w-4xl px-6 lg:px-8 py-12">
        <div className="text-center py-16">
          <h2 className="text-xl font-semibold">Box not found</h2>
          <Link href="/" className="text-primary hover:underline mt-2 block">
            Back to boxes
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl px-6 lg:px-8 py-12 space-y-8">
      <div className="space-y-4">
        <Link
          href="/"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to boxes
        </Link>

        <div className="flex items-start justify-between">
          <div className="space-y-2">
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold">{box.name}</h1>
              <StatusDot status={box.status} showLabel />
            </div>

            {box.spriteUrl && (
              <div className="flex items-center gap-2">
                <span className="text-sm font-mono text-muted-foreground">
                  {box.spriteUrl.replace("https://", "")}
                </span>
                <CopyButton text={box.spriteUrl} />
              </div>
            )}
          </div>

          {box.status === "running" && box.spriteUrl && (
            <Button
              variant="secondary"
              onClick={() => window.open(box.spriteUrl!, "_blank")}
            >
              <ExternalLink className="h-4 w-4 mr-2" />
              Open
            </Button>
          )}
        </div>
      </div>

      {emailAddress && (
        <div className="rounded-lg border border-border bg-card p-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-secondary">
              <Mail className="h-5 w-5 text-muted-foreground" />
            </div>
            <div className="flex-1">
              <p className="text-sm text-muted-foreground">Agent Email</p>
              <div className="flex items-center gap-2">
                <span className="font-mono text-foreground">
                  {emailAddress}
                </span>
                <CopyButton text={emailAddress} />
              </div>
            </div>
          </div>
        </div>
      )}

      {box.status === "running" && (
        <div className="space-y-4">
          <h2 className="text-lg font-semibold">Files</h2>
          <FileBrowser boxId={id} />
        </div>
      )}

      <div className="space-y-4">
        <h2 className="text-lg font-semibold">Inbox</h2>

        {emailsLoading ? (
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-16 w-full" />
            ))}
          </div>
        ) : emails.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border p-8 text-center">
            <MailOpen className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
            <p className="text-muted-foreground">No emails yet</p>
            <p className="text-sm text-muted-foreground mt-1">
              Send an email to <span className="font-mono">{emailAddress}</span>{" "}
              to get started
            </p>
          </div>
        ) : (
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
                    setExpandedEmail(
                      expandedEmail === email.id ? null : email.id
                    )
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
                          <span className="text-muted-foreground">
                            Delivered:
                          </span>{" "}
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
        )}
      </div>
    </div>
  );
}
