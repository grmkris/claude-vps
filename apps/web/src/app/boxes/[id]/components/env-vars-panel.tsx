"use client";

import type { BoxId } from "@vps-claude/shared";

import {
  Eye,
  EyeOff,
  KeyRound,
  Pencil,
  Plus,
  Trash2,
  Variable,
} from "lucide-react";
import { useState } from "react";

import { Badge } from "@/components/ui/badge";
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
  useBoxEnvVars,
  useDeleteBoxEnvVar,
  useSetBoxEnvVar,
} from "@/hooks/use-box-env-vars";
import { useCredentials } from "@/hooks/use-credentials";
import { cn } from "@/lib/utils";

function AddEditDialog({
  boxId,
  existingKey,
  existingType,
  existingValue,
  existingCredentialKey,
  onClose,
}: {
  boxId: BoxId;
  existingKey?: string;
  existingType?: "literal" | "credential_ref";
  existingValue?: string;
  existingCredentialKey?: string;
  onClose?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [key, setKey] = useState(existingKey ?? "");
  const [type, setType] = useState<"literal" | "credential_ref">(
    existingType ?? "literal"
  );
  const [value, setValue] = useState(existingValue ?? "");
  const [credentialKey, setCredentialKey] = useState(
    existingCredentialKey ?? ""
  );
  const [showValue, setShowValue] = useState(false);

  const { data: credentialsData } = useCredentials();
  const credentials = credentialsData?.credentials ?? [];
  const setMutation = useSetBoxEnvVar();
  const isEditing = !!existingKey;

  const handleSave = () => {
    setMutation.mutate(
      {
        boxId,
        key: key.toUpperCase(),
        type,
        value: type === "literal" ? value : undefined,
        credentialKey: type === "credential_ref" ? credentialKey : undefined,
      },
      {
        onSuccess: () => {
          setOpen(false);
          setKey("");
          setType("literal");
          setValue("");
          setCredentialKey("");
          setShowValue(false);
          onClose?.();
        },
      }
    );
  };

  const handleClose = () => {
    setOpen(false);
    setKey("");
    setType("literal");
    setValue("");
    setCredentialKey("");
    setShowValue(false);
    onClose?.();
  };

  const isValid =
    key &&
    /^[A-Z_][A-Z0-9_]*$/.test(key) &&
    (type === "literal" ? value : credentialKey);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger>
        {isEditing ? (
          <Button variant="ghost" size="sm">
            <Pencil className="h-4 w-4" />
          </Button>
        ) : (
          <Button type="button">
            <Plus className="h-4 w-4 mr-2" />
            Add Variable
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {isEditing ? "Edit Variable" : "Add Variable"}
          </DialogTitle>
          <DialogDescription>
            {isEditing
              ? "Update the value for this environment variable."
              : "Add a new environment variable to this box."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="key">Name</Label>
            <Input
              id="key"
              placeholder="API_KEY"
              value={key}
              onChange={(e) => setKey(e.target.value.toUpperCase())}
              disabled={isEditing}
              className="font-mono"
            />
            <p className="text-xs text-muted-foreground">
              Uppercase letters and underscores only
            </p>
          </div>

          <div className="space-y-2">
            <Label>Type</Label>
            <Select
              value={type}
              onValueChange={(v) =>
                v && setType(v as "literal" | "credential_ref")
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="literal">Custom Value</SelectItem>
                <SelectItem value="credential_ref">From Credential</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {type === "literal" ? (
            <div className="space-y-2">
              <Label htmlFor="value">Value</Label>
              <div className="relative">
                <Input
                  id="value"
                  type={showValue ? "text" : "password"}
                  placeholder="Enter value..."
                  value={value}
                  onChange={(e) => setValue(e.target.value)}
                  className="font-mono pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowValue(!showValue)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-1 hover:bg-secondary rounded"
                >
                  {showValue ? (
                    <EyeOff className="h-4 w-4 text-muted-foreground" />
                  ) : (
                    <Eye className="h-4 w-4 text-muted-foreground" />
                  )}
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-2">
              <Label>Credential</Label>
              <Select
                value={credentialKey}
                onValueChange={(v) => v && setCredentialKey(v)}
              >
                <SelectTrigger
                  className={cn(!credentialKey && "text-muted-foreground")}
                >
                  <SelectValue placeholder="Select credential" />
                </SelectTrigger>
                <SelectContent>
                  {credentials.length === 0 ? (
                    <div className="p-2 text-sm text-muted-foreground">
                      No credentials available
                    </div>
                  ) : (
                    credentials.map((cred) => (
                      <SelectItem key={cred.key} value={cred.key}>
                        {cred.key}
                      </SelectItem>
                    ))
                  )}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Value will be pulled from your saved credentials at deploy time
              </p>
            </div>
          )}

          <div className="flex gap-2">
            <Button variant="outline" onClick={handleClose} className="flex-1">
              Cancel
            </Button>
            <Button
              onClick={handleSave}
              disabled={!isValid || setMutation.isPending}
              className="flex-1"
            >
              {setMutation.isPending ? "Saving..." : "Save"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function EnvVarCard({
  boxId,
  envVar,
}: {
  boxId: BoxId;
  envVar: {
    key: string;
    type: "literal" | "credential_ref";
    value: string | null;
    credentialKey: string | null;
  };
}) {
  const [showValue, setShowValue] = useState(false);
  const deleteMutation = useDeleteBoxEnvVar();

  return (
    <div className="flex items-center justify-between p-4 border rounded-lg">
      <div className="flex items-center gap-3 flex-1 min-w-0">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-secondary shrink-0">
          {envVar.type === "credential_ref" ? (
            <KeyRound className="h-5 w-5 text-muted-foreground" />
          ) : (
            <Variable className="h-5 w-5 text-muted-foreground" />
          )}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-medium font-mono">{envVar.key}</span>
            <Badge
              variant={
                envVar.type === "credential_ref" ? "secondary" : "outline"
              }
            >
              {envVar.type === "credential_ref" ? "credential" : "custom"}
            </Badge>
          </div>
          <div className="flex items-center gap-2">
            {envVar.type === "credential_ref" ? (
              <span className="text-sm text-muted-foreground">
                From: <span className="font-mono">{envVar.credentialKey}</span>
              </span>
            ) : (
              <>
                <span className="text-sm text-muted-foreground font-mono truncate">
                  {showValue ? envVar.value : "••••••••••"}
                </span>
                <button
                  type="button"
                  onClick={() => setShowValue(!showValue)}
                  className="p-1 hover:bg-secondary rounded shrink-0"
                >
                  {showValue ? (
                    <EyeOff className="h-3 w-3 text-muted-foreground" />
                  ) : (
                    <Eye className="h-3 w-3 text-muted-foreground" />
                  )}
                </button>
              </>
            )}
          </div>
        </div>
      </div>
      <div className="flex items-center gap-1 shrink-0">
        <AddEditDialog
          boxId={boxId}
          existingKey={envVar.key}
          existingType={envVar.type}
          existingValue={envVar.value ?? undefined}
          existingCredentialKey={envVar.credentialKey ?? undefined}
        />
        <Button
          variant="ghost"
          size="sm"
          onClick={() => deleteMutation.mutate({ boxId, key: envVar.key })}
          disabled={deleteMutation.isPending}
        >
          <Trash2 className="h-4 w-4 text-destructive" />
        </Button>
      </div>
    </div>
  );
}

function EmptyState({ boxId }: { boxId: BoxId }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 px-4">
      <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-secondary mb-6">
        <Variable className="h-8 w-8 text-muted-foreground" />
      </div>
      <h3 className="text-xl font-semibold mb-2">No environment variables</h3>
      <p className="text-muted-foreground text-center mb-6 max-w-sm">
        Add environment variables to inject secrets or configuration into this
        box.
      </p>
      <AddEditDialog boxId={boxId} />
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

export function EnvVarsPanel({ boxId }: { boxId: BoxId }) {
  const { data, isLoading, error } = useBoxEnvVars(boxId);

  if (error) {
    return (
      <div className="rounded-xl border border-destructive/50 bg-destructive/10 p-8 text-center">
        <p className="text-destructive font-medium">
          Error loading environment variables
        </p>
        <p className="text-sm text-muted-foreground mt-1">{error.message}</p>
      </div>
    );
  }

  const envVars = data?.envVars ?? [];

  return (
    <div className="space-y-4">
      {isLoading ? (
        <LoadingSkeleton />
      ) : envVars.length === 0 ? (
        <EmptyState boxId={boxId} />
      ) : (
        <>
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground">
              {envVars.length} variable{envVars.length !== 1 && "s"}
            </p>
            <AddEditDialog boxId={boxId} />
          </div>
          <div className="space-y-2">
            {envVars.map((envVar) => (
              <EnvVarCard key={envVar.key} boxId={boxId} envVar={envVar} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
