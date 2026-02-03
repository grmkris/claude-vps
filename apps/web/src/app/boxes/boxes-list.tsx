"use client";

import type { Route } from "next";

import {
  Cloud,
  Container,
  ExternalLink,
  Plus,
  Trash2,
  Rocket,
  Box,
  MoreHorizontal,
  Copy,
  Check,
} from "lucide-react";
import Link from "next/link";
import { useState, useEffect } from "react";

import type { Box as BoxType } from "@/lib/orpc-types";

import { DeployProgress } from "@/components/deploy-progress";
import { StatusDot } from "@/components/status-dot";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { env } from "@/env";
import {
  useBoxes,
  useDeployBox,
  useDeleteBox,
  useCreateDevBox,
} from "@/hooks/use-boxes";

function isDevBox(box: BoxType): boolean {
  return box.instanceUrl?.startsWith("http://localhost") ?? false;
}

function BoxCard({ box }: { box: BoxType }) {
  const deployMutation = useDeployBox();
  const deleteMutation = useDeleteBox();

  const canRetry = box.status === "error"; // Only show retry for failed boxes
  const canOpen = box.status === "running" && box.instanceUrl;

  const handleDeploy = () => {
    deployMutation.mutate({ id: box.id });
  };

  return (
    <div className="group relative rounded-xl border border-border bg-card p-6 transition-all hover:border-border/80 hover:bg-card/80">
      <div className="flex items-start justify-between mb-4">
        <Link
          href={`/boxes/${box.id}` as Route}
          className="flex items-center gap-3"
        >
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-secondary">
            <Box className="h-5 w-5 text-muted-foreground" />
          </div>
          <div>
            <h3 className="font-semibold text-foreground hover:text-primary transition-colors">
              {box.name}
            </h3>
            {box.instanceUrl ? (
              <p className="text-sm font-mono text-muted-foreground">
                {box.instanceUrl.replace("https://", "")}
              </p>
            ) : (
              <p className="text-sm font-mono text-muted-foreground">
                {box.subdomain}
              </p>
            )}
          </div>
        </Link>

        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button variant="ghost" size="sm" className="h-8 w-8 p-0" />
            }
          >
            <MoreHorizontal className="h-4 w-4" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {canOpen && box.instanceUrl && (
              <DropdownMenuItem
                onClick={() => window.open(box.instanceUrl!, "_blank")}
              >
                <ExternalLink className="mr-2 h-4 w-4" />
                Open
              </DropdownMenuItem>
            )}
            <DropdownMenuItem
              variant="destructive"
              onClick={() => deleteMutation.mutate(box.id)}
              disabled={deleteMutation.isPending}
            >
              <Trash2 className="mr-2 h-4 w-4" />
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <div className="flex items-center gap-2 mb-4">
        <StatusDot status={box.status} showLabel />
        {box.provider === "docker" && (
          <span className="flex items-center gap-1 text-xs font-medium bg-blue-500/20 text-blue-600 px-1.5 py-0.5 rounded">
            <Container className="h-3 w-3" />
            Docker
          </span>
        )}
        {box.provider === "sprites" && (
          <span className="flex items-center gap-1 text-xs font-medium bg-purple-500/20 text-purple-600 px-1.5 py-0.5 rounded">
            <Cloud className="h-3 w-3" />
            Sprites
          </span>
        )}
        {isDevBox(box) && (
          <span className="text-xs font-medium bg-amber-500/20 text-amber-600 px-1.5 py-0.5 rounded">
            DEV
          </span>
        )}
        {box.errorMessage && (
          <span className="text-xs text-destructive truncate max-w-[200px]">
            {box.errorMessage}
          </span>
        )}
      </div>

      <div className="flex items-center gap-2">
        {canRetry && (
          <Button
            onClick={handleDeploy}
            disabled={deployMutation.isPending}
            className="flex-1"
            variant="secondary"
          >
            <Rocket className="h-4 w-4 mr-2" />
            {deployMutation.isPending ? "Retrying..." : "Retry"}
          </Button>
        )}
        {canOpen && box.instanceUrl && (
          <Button
            variant="secondary"
            className="flex-1"
            onClick={() => window.open(box.instanceUrl!, "_blank")}
          >
            <ExternalLink className="h-4 w-4 mr-2" />
            Open
          </Button>
        )}
        {box.status === "deploying" && (
          <div className="flex-1">
            <DeployProgress boxId={box.id} />
          </div>
        )}
      </div>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center py-16 px-4">
      <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-secondary mb-6">
        <Box className="h-8 w-8 text-muted-foreground" />
      </div>
      <h3 className="text-xl font-semibold mb-2">No boxes yet</h3>
      <p className="text-muted-foreground text-center mb-6 max-w-sm">
        Create your first Claude Code environment to get started
      </p>
      <Link href="/boxes/new">
        <Button size="lg">
          <Plus className="h-5 w-5 mr-2" />
          Create Box
        </Button>
      </Link>
    </div>
  );
}

function LoadingSkeleton() {
  return (
    <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
      {[1, 2, 3].map((i) => (
        <div key={i} className="rounded-xl border border-border bg-card p-6">
          <div className="flex items-center gap-3 mb-4">
            <Skeleton className="h-10 w-10 rounded-lg" />
            <div className="space-y-2">
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-3 w-48" />
            </div>
          </div>
          <Skeleton className="h-4 w-20 mb-4" />
          <Skeleton className="h-10 w-full" />
        </div>
      ))}
    </div>
  );
}

function DevBoxCredentialsDialog({
  credentials,
  onClose,
}: {
  credentials: { agentSecret: string; subdomain: string } | null;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);

  if (!credentials) return null;

  const envContent = `BOX_AGENT_SECRET=${credentials.agentSecret}
BOX_API_TOKEN=${credentials.agentSecret}
BOX_API_URL=http://localhost:33000/box
BOX_SUBDOMAIN=${credentials.subdomain}
BOX_AGENT_PORT=33002
BOX_INBOX_DIR=./.inbox
BOX_DB_PATH=./.box-agent/sessions.db`;

  const handleCopy = async () => {
    await navigator.clipboard.writeText(envContent);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <Dialog open={!!credentials} onOpenChange={() => onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Dev Box Created</DialogTitle>
          <DialogDescription>
            Copy these credentials to <code>apps/box-agent/.env</code> then run{" "}
            <code>bun run dev</code> in the box-agent directory.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="relative">
            <pre className="bg-secondary p-4 rounded-lg text-sm font-mono overflow-x-auto">
              {envContent}
            </pre>
            <Button
              size="sm"
              variant="secondary"
              className="absolute top-2 right-2"
              onClick={handleCopy}
            >
              {copied ? (
                <Check className="h-4 w-4" />
              ) : (
                <Copy className="h-4 w-4" />
              )}
            </Button>
          </div>
          <div className="text-sm text-muted-foreground">
            <p className="font-medium mb-1">Quick start:</p>
            <pre className="bg-secondary p-2 rounded text-xs">
              cd apps/box-agent && bun run dev
            </pre>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default function BoxesList() {
  const { data, isLoading, error } = useBoxes();
  const createDevBox = useCreateDevBox();
  const [devBoxCredentials, setDevBoxCredentials] = useState<{
    agentSecret: string;
    subdomain: string;
  } | null>(null);

  // Show credentials dialog when dev box is created
  useEffect(() => {
    if (createDevBox.isSuccess && createDevBox.data) {
      setDevBoxCredentials({
        agentSecret: createDevBox.data.agentSecret,
        subdomain: createDevBox.data.box.subdomain,
      });
    }
  }, [createDevBox.isSuccess, createDevBox.data]);

  const handleCreateDevBox = () => {
    const name = `dev-${Date.now().toString(36)}`;
    createDevBox.mutate({ name });
  };

  if (error) {
    return (
      <div className="rounded-xl border border-destructive/50 bg-destructive/10 p-8 text-center">
        <p className="text-destructive font-medium">Error loading boxes</p>
        <p className="text-sm text-muted-foreground mt-1">{error.message}</p>
      </div>
    );
  }

  const boxes = data?.boxes || [];

  return (
    <div className="space-y-8">
      <DevBoxCredentialsDialog
        credentials={devBoxCredentials}
        onClose={() => setDevBoxCredentials(null)}
      />

      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Your Boxes</h1>
          <p className="text-muted-foreground mt-1">
            {isLoading
              ? "Loading..."
              : boxes.length === 0
                ? "Get started by creating a box"
                : `${boxes.length} box${boxes.length === 1 ? "" : "es"}`}
          </p>
        </div>
        {boxes.length > 0 && (
          <div className="flex items-center gap-2">
            {env.NEXT_PUBLIC_ENV === "dev" && (
              <Button
                variant="outline"
                onClick={handleCreateDevBox}
                disabled={createDevBox.isPending}
              >
                {createDevBox.isPending ? "Creating..." : "Dev Box"}
              </Button>
            )}
            <Link href="/boxes/new">
              <Button>
                <Plus className="h-4 w-4 mr-2" />
                New Box
              </Button>
            </Link>
          </div>
        )}
      </div>

      {isLoading ? (
        <LoadingSkeleton />
      ) : boxes.length === 0 ? (
        <EmptyState />
      ) : (
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {boxes.map((box) => (
            <BoxCard key={box.id} box={box} />
          ))}
        </div>
      )}
    </div>
  );
}
