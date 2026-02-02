"use client";

import type { BoxId } from "@vps-claude/shared";

import { SERVICE_URLS } from "@vps-claude/shared/services.schema";
import {
  ArrowLeft,
  Bot,
  CalendarClock,
  ExternalLink,
  Mail,
  Terminal,
  Variable,
} from "lucide-react";
import Link from "next/link";
import { useParams, usePathname } from "next/navigation";
import { createContext, useContext } from "react";

import { StatusDot } from "@/components/status-dot";
import { Button } from "@/components/ui/button";
import { CopyButton } from "@/components/ui/copy-button";
import { Skeleton } from "@/components/ui/skeleton";
import { env } from "@/env";
import { useBox } from "@/hooks/use-boxes";

interface BoxContextValue {
  box: NonNullable<ReturnType<typeof useBox>["data"]>["box"] | undefined;
  isLoading: boolean;
}

const BoxContext = createContext<BoxContextValue | null>(null);

export function useBoxContext() {
  const ctx = useContext(BoxContext);
  if (!ctx) throw new Error("useBoxContext must be used within BoxLayout");
  return ctx;
}

const TABS = [
  { key: "inbox", label: "Inbox", icon: Mail, requiresRunning: false },
  { key: "console", label: "Console", icon: Terminal, requiresRunning: true },
  { key: "files", label: "Files", icon: null, requiresRunning: true },
  { key: "agent", label: "Agent", icon: Bot, requiresRunning: true },
  {
    key: "cronjobs",
    label: "Schedules",
    icon: CalendarClock,
    requiresRunning: true,
  },
  { key: "env", label: "Environment", icon: Variable, requiresRunning: true },
] as const;

export default function BoxLayout({ children }: { children: React.ReactNode }) {
  const { id } = useParams<{ id: BoxId }>();
  const pathname = usePathname();

  const { data: boxData, isLoading } = useBox(id);
  const box = boxData?.box;

  const agentsDomain = SERVICE_URLS[env.NEXT_PUBLIC_ENV].agentsDomain;
  const emailAddress = box ? `${box.subdomain}@${agentsDomain}` : null;

  // Determine active tab from pathname
  const activeTab = pathname.split("/").pop() || "inbox";

  if (isLoading) {
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

  const isRunning = box.status === "running";

  return (
    <BoxContext.Provider value={{ box, isLoading }}>
      <div className="mx-auto max-w-4xl px-6 lg:px-8 py-12 space-y-8">
        {/* Header */}
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

              {box.instanceUrl && (
                <div className="flex items-center gap-2">
                  <span className="text-sm font-mono text-muted-foreground">
                    {box.instanceUrl.replace("https://", "")}
                  </span>
                  <CopyButton text={box.instanceUrl} />
                </div>
              )}
              {box.tailscaleIp && (
                <div className="flex items-center gap-2">
                  <span className="text-sm font-mono text-muted-foreground">
                    Tailscale: {box.tailscaleIp}
                  </span>
                  <CopyButton text={`ssh sprite@${box.tailscaleIp}`} />
                </div>
              )}
            </div>

            {isRunning && box.instanceUrl && (
              <Button
                variant="secondary"
                onClick={() => window.open(box.instanceUrl!, "_blank")}
              >
                <ExternalLink className="h-4 w-4 mr-2" />
                Open
              </Button>
            )}
          </div>
        </div>

        {/* Email Card */}
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

        {/* Tabs */}
        <div className="space-y-4">
          <div className="flex gap-1 border-b border-border">
            {TABS.map((tab) => {
              if (tab.requiresRunning && !isRunning) return null;

              const isActive = activeTab === tab.key;
              const Icon = tab.icon;

              return (
                <Link
                  key={tab.key}
                  href={`/boxes/${id}/${tab.key}`}
                  className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                    isActive
                      ? "border-primary text-foreground"
                      : "border-transparent text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {Icon && <Icon className="h-4 w-4 inline-block mr-2" />}
                  {tab.label}
                </Link>
              );
            })}
          </div>

          {/* Tab content */}
          {children}
        </div>
      </div>
    </BoxContext.Provider>
  );
}
