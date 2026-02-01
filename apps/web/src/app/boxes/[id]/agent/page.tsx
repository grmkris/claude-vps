"use client";

import type { BoxId } from "@vps-claude/shared";

import { Bot, Send } from "lucide-react";
import { useParams } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useBox } from "@/hooks/use-boxes";
import { useBoxSessions, useSendMessage } from "@/hooks/use-sessions";

import { AgentConfigPanel } from "../components/agent-config-panel";

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

export default function AgentPage() {
  const { id } = useParams<{ id: BoxId }>();
  const { data: boxData } = useBox(id);
  const [subTab, setSubTab] = useState<"sessions" | "config">("sessions");

  if (boxData?.box?.status !== "running") {
    return (
      <div className="rounded-lg border border-dashed border-border p-8 text-center">
        <p className="text-muted-foreground">Box is not running</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        <Button
          variant={subTab === "sessions" ? "secondary" : "ghost"}
          size="sm"
          onClick={() => setSubTab("sessions")}
        >
          Sessions
        </Button>
        <Button
          variant={subTab === "config" ? "secondary" : "ghost"}
          size="sm"
          onClick={() => setSubTab("config")}
        >
          Configuration
        </Button>
      </div>

      {subTab === "sessions" && <SessionsPanel boxId={id} />}
      {subTab === "config" && <AgentConfigPanel boxId={id} />}
    </div>
  );
}

function SessionsPanel({ boxId }: { boxId: BoxId }) {
  const { data: sessionsData, isLoading } = useBoxSessions(boxId);
  const sendMessage = useSendMessage(boxId);
  const [message, setMessage] = useState("");

  const sessions = sessionsData?.sessions ?? [];

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!message.trim() || sendMessage.isPending) return;

    sendMessage.mutate({ message: message.trim() });
    setMessage("");
  };

  return (
    <div className="space-y-4">
      <form onSubmit={handleSubmit} className="flex gap-2">
        <input
          type="text"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder="Send a message to Claude..."
          className="flex-1 px-3 py-2 border border-border rounded-md bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary"
          disabled={sendMessage.isPending}
        />
        <Button
          type="submit"
          disabled={!message.trim() || sendMessage.isPending}
        >
          <Send className="h-4 w-4 mr-2" />
          Send
        </Button>
      </form>

      {isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-16 w-full" />
          ))}
        </div>
      ) : sessions.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border p-8 text-center">
          <Bot className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
          <p className="text-muted-foreground">No sessions yet</p>
          <p className="text-sm text-muted-foreground mt-1">
            Send a message above to start a new agent session
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {sessions.map((session) => (
            <div
              key={`${session.contextType}-${session.contextId}`}
              className="rounded-lg border border-border bg-card p-4"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-medium px-2 py-0.5 rounded bg-secondary text-secondary-foreground">
                    {session.contextType}
                  </span>
                  <span className="font-mono text-sm text-muted-foreground">
                    {session.contextId}
                  </span>
                </div>
                <span className="text-xs text-muted-foreground">
                  {formatRelativeTime(session.updatedAt)}
                </span>
              </div>
              <div className="mt-2 text-xs text-muted-foreground">
                Session: {session.sessionId.slice(0, 16)}...
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
