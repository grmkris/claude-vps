"use client";

import { API_KEY_PERMISSIONS } from "@vps-claude/auth";
import { Check, Copy, Key, Plus, Trash2 } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
import { Skeleton } from "@/components/ui/skeleton";
import {
  type ApiKeyPermissions,
  useApiKeys,
  useCreateApiKey,
  useRevokeApiKey,
} from "@/hooks/use-api-keys";

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
      className="p-1.5 hover:bg-secondary rounded transition-colors"
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

function CreateKeyDialog() {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [createdKey, setCreatedKey] = useState<string | null>(null);
  const [permissions, setPermissions] = useState<ApiKeyPermissions>({
    box: ["read"],
    secret: ["read"],
    skill: ["read"],
  });

  const createMutation = useCreateApiKey();

  const handleCreate = () => {
    createMutation.mutate(
      { name, permissions },
      {
        onSuccess: (data) => {
          if (data?.key) {
            setCreatedKey(data.key);
          }
        },
      }
    );
  };

  const handleClose = () => {
    setOpen(false);
    setName("");
    setCreatedKey(null);
    setPermissions({
      box: ["read"],
      secret: ["read"],
      skill: ["read"],
    });
  };

  const togglePermission = (
    resource: keyof ApiKeyPermissions,
    action: string
  ) => {
    setPermissions((prev) => {
      const current = prev[resource] || [];
      const hasAction = current.includes(action as never);
      return {
        ...prev,
        [resource]: hasAction
          ? current.filter((a) => a !== action)
          : [...current, action],
      };
    });
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger>
        <Button type="button">
          <Plus className="h-4 w-4 mr-2" />
          Create API Key
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {createdKey ? "API Key Created" : "Create API Key"}
          </DialogTitle>
          <DialogDescription>
            {createdKey
              ? "Copy your API key now. You won't be able to see it again."
              : "Create a new API key for programmatic access."}
          </DialogDescription>
        </DialogHeader>

        {createdKey ? (
          <div className="space-y-4">
            <div className="flex items-center gap-2 p-3 bg-secondary rounded-lg font-mono text-sm break-all">
              <span className="flex-1">{createdKey}</span>
              <CopyButton text={createdKey} />
            </div>
            <Button onClick={handleClose} className="w-full">
              Done
            </Button>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="name">Name</Label>
              <Input
                id="name"
                placeholder="My API Key"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>

            <div className="space-y-3">
              <Label>Permissions</Label>

              {(
                Object.entries(API_KEY_PERMISSIONS) as [
                  keyof typeof API_KEY_PERMISSIONS,
                  readonly string[],
                ][]
              ).map(([resource, actions]) => (
                <div key={resource} className="space-y-2">
                  <div className="text-sm font-medium capitalize">
                    {resource}
                  </div>
                  <div className="flex flex-wrap gap-3 pl-2">
                    {actions.map((action) => (
                      <label
                        key={`${resource}-${action}`}
                        className="flex items-center gap-2 text-sm"
                      >
                        <Checkbox
                          checked={(permissions[resource] || []).includes(
                            action as never
                          )}
                          onCheckedChange={() =>
                            togglePermission(resource, action)
                          }
                        />
                        {action}
                      </label>
                    ))}
                  </div>
                </div>
              ))}
            </div>

            <div className="flex gap-2">
              <Button
                variant="outline"
                onClick={handleClose}
                className="flex-1"
              >
                Cancel
              </Button>
              <Button
                onClick={handleCreate}
                disabled={!name || createMutation.isPending}
                className="flex-1"
              >
                {createMutation.isPending ? "Creating..." : "Create"}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function ApiKeyCard({
  apiKey,
}: {
  apiKey: {
    id: string;
    name: string | null;
    start: string | null;
    createdAt: Date;
    lastRequest: Date | null;
  };
}) {
  const revokeMutation = useRevokeApiKey();

  return (
    <div className="flex items-center justify-between p-4 border rounded-lg">
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-secondary">
          <Key className="h-5 w-5 text-muted-foreground" />
        </div>
        <div>
          <div className="font-medium">{apiKey.name || "Unnamed Key"}</div>
          <div className="text-sm text-muted-foreground font-mono">
            {apiKey.start || "****"}...
          </div>
          <div className="text-xs text-muted-foreground">
            Created {new Date(apiKey.createdAt).toLocaleDateString()}
            {apiKey.lastRequest &&
              ` · Last used ${new Date(apiKey.lastRequest).toLocaleDateString()}`}
          </div>
        </div>
      </div>
      <Button
        variant="ghost"
        size="sm"
        onClick={() => revokeMutation.mutate(apiKey.id as `apk_${string}`)}
        disabled={revokeMutation.isPending}
      >
        <Trash2 className="h-4 w-4 text-destructive" />
      </Button>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center py-16 px-4">
      <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-secondary mb-6">
        <Key className="h-8 w-8 text-muted-foreground" />
      </div>
      <h3 className="text-xl font-semibold mb-2">No API keys</h3>
      <p className="text-muted-foreground text-center mb-6 max-w-sm">
        Create an API key for programmatic access to your boxes
      </p>
      <CreateKeyDialog />
    </div>
  );
}

function LoadingSkeleton() {
  return (
    <div className="space-y-4">
      {[1, 2, 3].map((i) => (
        <div key={i} className="flex items-center gap-3 p-4 border rounded-lg">
          <Skeleton className="h-10 w-10 rounded-lg" />
          <div className="space-y-2 flex-1">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-3 w-48" />
          </div>
        </div>
      ))}
    </div>
  );
}

export default function ApiKeysList() {
  const { data, isLoading, error } = useApiKeys();

  if (error) {
    return (
      <div className="rounded-xl border border-destructive/50 bg-destructive/10 p-8 text-center">
        <p className="text-destructive font-medium">Error loading API keys</p>
        <p className="text-sm text-muted-foreground mt-1">{error.message}</p>
      </div>
    );
  }

  const apiKeys = data?.apiKeys || [];

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">API Keys</h1>
          <p className="text-muted-foreground mt-1">
            {isLoading
              ? "Loading..."
              : apiKeys.length === 0
                ? "Create keys for programmatic access"
                : `${apiKeys.length} key${apiKeys.length === 1 ? "" : "s"}`}
          </p>
        </div>
        {apiKeys.length > 0 && <CreateKeyDialog />}
      </div>

      {isLoading ? (
        <LoadingSkeleton />
      ) : apiKeys.length === 0 ? (
        <EmptyState />
      ) : (
        <div className="space-y-4">
          {apiKeys.map((key) => (
            <ApiKeyCard key={key.id} apiKey={key} />
          ))}
        </div>
      )}
    </div>
  );
}
