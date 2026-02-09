"use client";

import type { BoxId } from "@vps-claude/shared";

import { Bot, Plus, Server, Settings2, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  type McpServerConfig,
  useAgentConfig,
  useUpdateAgentConfig,
} from "@/hooks/use-agent-config";

const MODELS = [
  { value: "claude-sonnet-4-5-20250929", label: "Claude Sonnet 4.5" },
  { value: "claude-opus-4-5-20251101", label: "Claude Opus 4.5" },
  { value: "claude-3-5-sonnet-20241022", label: "Claude 3.5 Sonnet" },
];

const PERMISSION_MODES = [
  { value: "bypassPermissions", label: "Bypass (auto-approve all)" },
  { value: "default", label: "Default (prompt for permissions)" },
];

// Type guard for stdio config
function isStdioConfig(config: McpServerConfig): config is {
  command: string;
  args?: string[];
  env?: Record<string, string>;
} {
  return "command" in config;
}

function McpServerDialog({
  existingName,
  existingConfig,
  onSave,
  onClose,
}: {
  existingName?: string;
  existingConfig?: McpServerConfig;
  onSave: (name: string, config: McpServerConfig) => void;
  onClose: () => void;
}) {
  const [open, setOpen] = useState(!!existingName);
  const [name, setName] = useState(existingName ?? "");
  const existingStdio =
    existingConfig && isStdioConfig(existingConfig) ? existingConfig : null;
  const [command, setCommand] = useState(existingStdio?.command ?? "");
  const [args, setArgs] = useState(existingStdio?.args?.join(", ") ?? "");

  const handleSave = () => {
    onSave(name, {
      command,
      args: args ? args.split(",").map((a: string) => a.trim()) : undefined,
    });
    setOpen(false);
    onClose();
  };

  const isValid = name && command;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {!existingName && (
        <DialogTrigger>
          <Button variant="outline" size="sm">
            <Plus className="h-4 w-4 mr-1" />
            Add MCP Server
          </Button>
        </DialogTrigger>
      )}
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {existingName ? "Edit MCP Server" : "Add MCP Server"}
          </DialogTitle>
          <DialogDescription>
            Configure an MCP server that will be available to the agent.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="name">Server Name</Label>
            <Input
              id="name"
              placeholder="my-server"
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={!!existingName}
              className="font-mono"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="command">Command</Label>
            <Input
              id="command"
              placeholder="/usr/local/bin/my-mcp-server"
              value={command}
              onChange={(e) => setCommand(e.target.value)}
              className="font-mono"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="args">Arguments (comma-separated)</Label>
            <Input
              id="args"
              placeholder="--flag, value"
              value={args}
              onChange={(e) => setArgs(e.target.value)}
              className="font-mono"
            />
          </div>

          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={() => {
                setOpen(false);
                onClose();
              }}
              className="flex-1"
            >
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={!isValid} className="flex-1">
              Save
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function McpServerCard({
  name,
  config,
  onEdit,
  onDelete,
  isBuiltIn,
}: {
  name: string;
  config: McpServerConfig;
  onEdit: () => void;
  onDelete: () => void;
  isBuiltIn: boolean;
}) {
  return (
    <div className="flex items-center justify-between p-3 border rounded-lg">
      <div className="flex items-center gap-3">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-secondary">
          <Server className="h-4 w-4 text-muted-foreground" />
        </div>
        <div>
          <div className="flex items-center gap-2">
            <span className="font-medium font-mono text-sm">{name}</span>
            {isBuiltIn && (
              <span className="text-xs px-1.5 py-0.5 rounded bg-secondary text-muted-foreground">
                built-in
              </span>
            )}
          </div>
          <span className="text-xs text-muted-foreground font-mono">
            {isStdioConfig(config) ? config.command : config.url}
          </span>
        </div>
      </div>
      {!isBuiltIn && (
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="sm" onClick={onEdit}>
            Edit
          </Button>
          <Button variant="ghost" size="sm" onClick={onDelete}>
            <Trash2 className="h-4 w-4 text-destructive" />
          </Button>
        </div>
      )}
    </div>
  );
}

function LoadingSkeleton() {
  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <Skeleton className="h-4 w-20" />
        <Skeleton className="h-10 w-full" />
      </div>
      <div className="space-y-2">
        <Skeleton className="h-4 w-32" />
        <Skeleton className="h-10 w-full" />
      </div>
      <div className="space-y-2">
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-24 w-full" />
      </div>
    </div>
  );
}

export function AgentConfigPanel({ boxId }: { boxId: BoxId }) {
  const { data: configData, isLoading, error } = useAgentConfig(boxId);
  const config = configData?.config;
  const updateMutation = useUpdateAgentConfig();

  // Local form state
  const [model, setModel] = useState("");
  const [permissionMode, setPermissionMode] = useState("");
  const [maxTurns, setMaxTurns] = useState("");
  const [maxBudgetUsd, setMaxBudgetUsd] = useState("");
  const [appendSystemPrompt, setAppendSystemPrompt] = useState("");
  const [mcpServers, setMcpServers] = useState<Record<string, McpServerConfig>>(
    {}
  );
  const [editingServer, setEditingServer] = useState<string | null>(null);
  const [hasChanges, setHasChanges] = useState(false);

  // Initialize form when config loads
  useEffect(() => {
    if (config) {
      setModel(config.model ?? "claude-sonnet-4-5-20250929");
      setPermissionMode(config.permissionMode ?? "bypassPermissions");
      setMaxTurns(config.maxTurns?.toString() ?? "50");
      setMaxBudgetUsd(config.maxBudgetUsd ?? "1.00");
      setAppendSystemPrompt(config.appendSystemPrompt ?? "");
      // Only user-configured servers (not ai-tools which is always added by backend)
      const userServers = { ...config.mcpServers };
      delete userServers["ai-tools"];
      setMcpServers(userServers);
      setHasChanges(false);
    }
  }, [config]);

  const handleSave = () => {
    updateMutation.mutate(
      {
        boxId,
        model,
        permissionMode,
        maxTurns: maxTurns ? Number.parseInt(maxTurns, 10) : null,
        maxBudgetUsd: maxBudgetUsd || null,
        appendSystemPrompt: appendSystemPrompt || null,
        mcpServers: Object.keys(mcpServers).length > 0 ? mcpServers : null,
      },
      {
        onSuccess: () => {
          setHasChanges(false);
        },
      }
    );
  };

  const handleChange = () => {
    setHasChanges(true);
  };

  const handleAddServer = (name: string, serverConfig: McpServerConfig) => {
    setMcpServers((prev) => ({ ...prev, [name]: serverConfig }));
    handleChange();
  };

  const handleDeleteServer = (name: string) => {
    setMcpServers((prev) => {
      const next = { ...prev };
      delete next[name];
      return next;
    });
    handleChange();
  };

  if (error) {
    return (
      <div className="rounded-xl border border-destructive/50 bg-destructive/10 p-8 text-center">
        <p className="text-destructive font-medium">
          Error loading agent configuration
        </p>
        <p className="text-sm text-muted-foreground mt-1">{error.message}</p>
      </div>
    );
  }

  if (isLoading) {
    return <LoadingSkeleton />;
  }

  // Merge user servers with built-in for display
  const allServers: Record<string, McpServerConfig> = {
    "ai-tools": {
      command: "/usr/local/bin/box-agent",
      args: ["mcp"],
    },
    ...mcpServers,
  };

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-secondary">
          <Bot className="h-5 w-5 text-muted-foreground" />
        </div>
        <div>
          <h3 className="font-semibold">Agent Configuration</h3>
          <p className="text-sm text-muted-foreground">
            Configure how Claude runs in this box
          </p>
        </div>
      </div>

      {/* Model & Permission Mode */}
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label>Model</Label>
          <Select
            value={model}
            onValueChange={(v) => {
              if (v) setModel(v);
              handleChange();
            }}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {MODELS.map((m) => (
                <SelectItem key={m.value} value={m.value}>
                  {m.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label>Permission Mode</Label>
          <Select
            value={permissionMode}
            onValueChange={(v) => {
              if (v) setPermissionMode(v);
              handleChange();
            }}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PERMISSION_MODES.map((m) => (
                <SelectItem key={m.value} value={m.value}>
                  {m.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Max Turns & Budget */}
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="maxTurns">Max Turns</Label>
          <Input
            id="maxTurns"
            type="number"
            value={maxTurns}
            onChange={(e) => {
              setMaxTurns(e.target.value);
              handleChange();
            }}
            placeholder="50"
          />
          <p className="text-xs text-muted-foreground">
            Maximum API calls per session
          </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="maxBudget">Max Budget (USD)</Label>
          <Input
            id="maxBudget"
            type="text"
            value={maxBudgetUsd}
            onChange={(e) => {
              setMaxBudgetUsd(e.target.value);
              handleChange();
            }}
            placeholder="1.00"
          />
          <p className="text-xs text-muted-foreground">
            Cost limit per session
          </p>
        </div>
      </div>

      {/* System Prompt */}
      <div className="space-y-2">
        <Label htmlFor="appendPrompt">Append System Prompt</Label>
        <textarea
          id="appendPrompt"
          value={appendSystemPrompt}
          onChange={(e) => {
            setAppendSystemPrompt(e.target.value);
            handleChange();
          }}
          placeholder="Additional instructions appended to the default system prompt..."
          className="w-full min-h-[120px] px-3 py-2 border rounded-md bg-background text-sm resize-y"
        />
        <p className="text-xs text-muted-foreground">
          Extra context added after the default system prompt
        </p>
      </div>

      {/* MCP Servers */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Settings2 className="h-4 w-4 text-muted-foreground" />
            <Label>MCP Servers</Label>
          </div>
          <McpServerDialog
            onSave={handleAddServer}
            onClose={() => setEditingServer(null)}
          />
        </div>

        <div className="space-y-2">
          {Object.entries(allServers).map(([name, serverConfig]) => (
            <McpServerCard
              key={name}
              name={name}
              config={serverConfig}
              isBuiltIn={name === "ai-tools"}
              onEdit={() => setEditingServer(name)}
              onDelete={() => handleDeleteServer(name)}
            />
          ))}
        </div>

        {editingServer && editingServer !== "ai-tools" && (
          <McpServerDialog
            existingName={editingServer}
            existingConfig={mcpServers[editingServer]}
            onSave={handleAddServer}
            onClose={() => setEditingServer(null)}
          />
        )}
      </div>

      {/* Save Button */}
      <div className="flex justify-end pt-4 border-t">
        <Button
          onClick={handleSave}
          disabled={!hasChanges || updateMutation.isPending}
        >
          {updateMutation.isPending ? "Saving..." : "Save Changes"}
        </Button>
      </div>
    </div>
  );
}
