"use client";

import type { BoxId } from "@vps-claude/shared";

import { Bot, Loader2, Send, Square, Wrench } from "lucide-react";
import { useParams } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useBox } from "@/hooks/use-boxes";
import {
  useBoxSessions,
  useSessionHistory,
  useStreamingSession,
} from "@/hooks/use-sessions";

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
  const {
    isStreaming,
    streamingText,
    currentTool,
    error: streamError,
    sendStreamingMessage,
    cancelStream,
  } = useStreamingSession(boxId);
  const [message, setMessage] = useState("");
  const [expandedSession, setExpandedSession] = useState<string | null>(null);

  const sessions = sessionsData?.sessions ?? [];

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!message.trim() || isStreaming) return;

    void sendStreamingMessage({ message: message.trim() });
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
          disabled={isStreaming}
        />
        {isStreaming ? (
          <Button type="button" variant="destructive" onClick={cancelStream}>
            <Square className="h-4 w-4 mr-2" />
            Stop
          </Button>
        ) : (
          <Button type="submit" disabled={!message.trim()}>
            <Send className="h-4 w-4 mr-2" />
            Send
          </Button>
        )}
      </form>

      {/* Streaming response display */}
      {(isStreaming || streamingText) && (
        <div className="rounded-lg border border-primary/30 bg-primary/5 p-4">
          <div className="flex items-center gap-2 mb-2">
            {isStreaming && (
              <Loader2 className="h-4 w-4 animate-spin text-primary" />
            )}
            <span className="text-sm font-medium text-primary">
              {isStreaming ? "Claude is responding..." : "Response"}
            </span>
            {currentTool && (
              <span className="flex items-center gap-1 text-xs bg-secondary px-2 py-0.5 rounded">
                <Wrench className="h-3 w-3" />
                Using {currentTool}
              </span>
            )}
          </div>
          {streamingText && (
            <p className="text-sm whitespace-pre-wrap">
              {streamingText}
              {isStreaming && (
                <span className="inline-block w-2 h-4 ml-0.5 bg-primary animate-pulse" />
              )}
            </p>
          )}
          {streamError && (
            <p className="text-sm text-destructive mt-2">
              Error: {streamError}
            </p>
          )}
        </div>
      )}

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
          {sessions.map((session) => {
            const isExpanded = expandedSession === session.sessionId;
            return (
              <div
                key={`${session.contextType}-${session.contextId}`}
                className="rounded-lg border border-border bg-card overflow-hidden"
              >
                <button
                  type="button"
                  className="w-full p-4 text-left hover:bg-secondary/50 transition-colors"
                  onClick={() =>
                    setExpandedSession(isExpanded ? null : session.sessionId)
                  }
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-medium px-2 py-0.5 rounded bg-secondary text-secondary-foreground">
                        {session.contextType}
                      </span>
                      <span className="font-mono text-sm text-muted-foreground truncate max-w-[200px]">
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
                </button>

                {isExpanded && (
                  <SessionHistory boxId={boxId} sessionId={session.sessionId} />
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function SessionHistory({
  boxId,
  sessionId,
}: {
  boxId: BoxId;
  sessionId: string;
}) {
  const { data, isLoading } = useSessionHistory(boxId, sessionId);

  if (isLoading) {
    return (
      <div className="px-4 pb-4 border-t border-border pt-3">
        <Skeleton className="h-20 w-full" />
      </div>
    );
  }

  const messages = data?.messages ?? [];

  if (messages.length === 0) {
    return (
      <div className="px-4 pb-4 border-t border-border pt-3">
        <p className="text-sm text-muted-foreground">No messages found</p>
      </div>
    );
  }

  return (
    <div className="px-4 pb-4 border-t border-border pt-3 space-y-3 max-h-96 overflow-y-auto">
      {messages.map((msg, i) => (
        <div
          key={`${msg.timestamp}-${i}`}
          className={`rounded-lg p-3 ${
            msg.type === "user"
              ? "bg-primary/10 border border-primary/20"
              : "bg-secondary/50"
          }`}
        >
          <div className="flex items-center gap-2 mb-1">
            <span
              className={`text-xs font-medium ${
                msg.type === "user" ? "text-primary" : "text-muted-foreground"
              }`}
            >
              {msg.type === "user" ? "User" : "Claude"}
            </span>
            {msg.timestamp && (
              <span className="text-xs text-muted-foreground">
                {new Date(msg.timestamp).toLocaleTimeString()}
              </span>
            )}
          </div>
          <p className="text-sm whitespace-pre-wrap">{msg.content}</p>
        </div>
      ))}
    </div>
  );
}
