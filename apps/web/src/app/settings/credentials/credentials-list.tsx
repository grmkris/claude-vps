"use client";

import { Eye, EyeOff, KeyRound, Pencil, Plus, Trash2 } from "lucide-react";
import { useState } from "react";

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
import { Skeleton } from "@/components/ui/skeleton";
import {
  useCredentials,
  useDeleteCredential,
  useSetCredential,
} from "@/hooks/use-credentials";

function AddEditDialog({
  existingKey,
  existingValue,
  onClose,
}: {
  existingKey?: string;
  existingValue?: string;
  onClose?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [key, setKey] = useState(existingKey ?? "");
  const [value, setValue] = useState(existingValue ?? "");
  const [showValue, setShowValue] = useState(false);

  const setMutation = useSetCredential();
  const isEditing = !!existingKey;

  const handleSave = () => {
    setMutation.mutate(
      { key: key.toUpperCase(), value },
      {
        onSuccess: () => {
          setOpen(false);
          setKey("");
          setValue("");
          setShowValue(false);
          onClose?.();
        },
      }
    );
  };

  const handleClose = () => {
    setOpen(false);
    setKey("");
    setValue("");
    setShowValue(false);
    onClose?.();
  };

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
            Add Credential
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {isEditing ? "Edit Credential" : "Add Credential"}
          </DialogTitle>
          <DialogDescription>
            {isEditing
              ? "Update the value for this credential."
              : "Add a new credential. You can reference it in box environment variables."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="key">Name</Label>
            <Input
              id="key"
              placeholder="OPENAI_API_KEY"
              value={key}
              onChange={(e) => setKey(e.target.value.toUpperCase())}
              disabled={isEditing}
              className="font-mono"
            />
            <p className="text-xs text-muted-foreground">
              Uppercase letters and underscores only (e.g., MY_API_KEY)
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="value">Value</Label>
            <div className="relative">
              <Input
                id="value"
                type={showValue ? "text" : "password"}
                placeholder="Enter secret value..."
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

          <div className="flex gap-2">
            <Button variant="outline" onClick={handleClose} className="flex-1">
              Cancel
            </Button>
            <Button
              onClick={handleSave}
              disabled={
                !key ||
                !value ||
                setMutation.isPending ||
                !/^[A-Z_][A-Z0-9_]*$/.test(key)
              }
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

function CredentialCard({
  credential,
}: {
  credential: {
    key: string;
    value: string;
    createdAt: Date;
    updatedAt: Date;
  };
}) {
  const [showValue, setShowValue] = useState(false);
  const deleteMutation = useDeleteCredential();

  return (
    <div className="flex items-center justify-between p-4 border rounded-lg">
      <div className="flex items-center gap-3 flex-1 min-w-0">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-secondary shrink-0">
          <KeyRound className="h-5 w-5 text-muted-foreground" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="font-medium font-mono">{credential.key}</div>
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground font-mono truncate">
              {showValue ? credential.value : "••••••••••"}
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
          </div>
        </div>
      </div>
      <div className="flex items-center gap-1 shrink-0">
        <AddEditDialog
          existingKey={credential.key}
          existingValue={credential.value}
        />
        <Button
          variant="ghost"
          size="sm"
          onClick={() => deleteMutation.mutate(credential.key)}
          disabled={deleteMutation.isPending}
        >
          <Trash2 className="h-4 w-4 text-destructive" />
        </Button>
      </div>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center py-16 px-4">
      <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-secondary mb-6">
        <KeyRound className="h-8 w-8 text-muted-foreground" />
      </div>
      <h3 className="text-xl font-semibold mb-2">No credentials</h3>
      <p className="text-muted-foreground text-center mb-6 max-w-sm">
        Store API keys and secrets here. Reference them in box environment
        variables.
      </p>
      <AddEditDialog />
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

export default function CredentialsList() {
  const { data, isLoading, error } = useCredentials();

  if (error) {
    return (
      <div className="rounded-xl border border-destructive/50 bg-destructive/10 p-8 text-center">
        <p className="text-destructive font-medium">
          Error loading credentials
        </p>
        <p className="text-sm text-muted-foreground mt-1">{error.message}</p>
      </div>
    );
  }

  const credentials = data?.credentials ?? [];

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Credentials</h1>
          <p className="text-muted-foreground mt-1">
            {isLoading
              ? "Loading..."
              : credentials.length === 0
                ? "Store secrets and reference them in box environment variables"
                : `${credentials.length} credential${credentials.length === 1 ? "" : "s"}`}
          </p>
        </div>
        {credentials.length > 0 && <AddEditDialog />}
      </div>

      {isLoading ? (
        <LoadingSkeleton />
      ) : credentials.length === 0 ? (
        <EmptyState />
      ) : (
        <div className="space-y-4">
          {credentials.map((credential) => (
            <CredentialCard key={credential.key} credential={credential} />
          ))}
        </div>
      )}
    </div>
  );
}
