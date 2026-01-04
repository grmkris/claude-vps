"use client";

import {
  ExternalLink,
  Plus,
  Trash2,
  Rocket,
  Box,
  MoreHorizontal,
} from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import type { Box as BoxType } from "@/lib/orpc-types";

import { StatusDot } from "@/components/status-dot";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useBoxes, useDeployBox, useDeleteBox } from "@/hooks/use-boxes";

function BoxCard({ box }: { box: BoxType }) {
  const [password, setPassword] = useState("");
  const [showPasswordInput, setShowPasswordInput] = useState(false);
  const deployMutation = useDeployBox();
  const deleteMutation = useDeleteBox();

  const canDeploy = box.status === "pending" || box.status === "error";
  const canOpen = box.status === "running";

  const handleDeploy = () => {
    if (!password) {
      setShowPasswordInput(true);
      return;
    }
    deployMutation.mutate(
      { id: box.id, password },
      {
        onSuccess: () => {
          setShowPasswordInput(false);
          setPassword("");
        },
      }
    );
  };

  return (
    <div className="group relative rounded-xl border border-border bg-card p-6 transition-all hover:border-border/80 hover:bg-card/80">
      {/* Header */}
      <div className="flex items-start justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-secondary">
            <Box className="h-5 w-5 text-muted-foreground" />
          </div>
          <div>
            <h3 className="font-semibold text-foreground">{box.name}</h3>
            <p className="text-sm font-mono text-muted-foreground">
              {box.subdomain}.agents.grm.wtf
            </p>
          </div>
        </div>

        {/* Dropdown Menu */}
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button variant="ghost" size="sm" className="h-8 w-8 p-0" />
            }
          >
            <MoreHorizontal className="h-4 w-4" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {canOpen && (
              <DropdownMenuItem
                onClick={() =>
                  window.open(
                    `https://${box.subdomain}.agents.grm.wtf`,
                    "_blank"
                  )
                }
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

      {/* Status */}
      <div className="flex items-center gap-2 mb-4">
        <StatusDot status={box.status} showLabel />
        {box.errorMessage && (
          <span className="text-xs text-destructive truncate max-w-[200px]">
            {box.errorMessage}
          </span>
        )}
      </div>

      {/* Actions */}
      <div className="flex items-center gap-2">
        {showPasswordInput && canDeploy ? (
          <div className="flex items-center gap-2 w-full">
            <Input
              type="password"
              placeholder="Enter password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="flex-1"
              autoFocus
            />
            <Button
              size="sm"
              onClick={handleDeploy}
              disabled={deployMutation.isPending || !password}
            >
              {deployMutation.isPending ? "..." : "Go"}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setShowPasswordInput(false);
                setPassword("");
              }}
            >
              Cancel
            </Button>
          </div>
        ) : (
          <>
            {canDeploy && (
              <Button
                onClick={() => setShowPasswordInput(true)}
                disabled={deployMutation.isPending}
                className="flex-1"
              >
                <Rocket className="h-4 w-4 mr-2" />
                Deploy
              </Button>
            )}
            {canOpen && (
              <Button
                variant="secondary"
                className="flex-1"
                onClick={() =>
                  window.open(
                    `https://${box.subdomain}.agents.grm.wtf`,
                    "_blank"
                  )
                }
              >
                <ExternalLink className="h-4 w-4 mr-2" />
                Open
              </Button>
            )}
            {box.status === "deploying" && (
              <div className="flex-1 text-center text-sm text-muted-foreground">
                Deployment in progress...
              </div>
            )}
          </>
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

export default function BoxesList() {
  const { data, isLoading, error } = useBoxes();

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
      {/* Header */}
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
          <Link href="/boxes/new">
            <Button>
              <Plus className="h-4 w-4 mr-2" />
              New Box
            </Button>
          </Link>
        )}
      </div>

      {/* Content */}
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
