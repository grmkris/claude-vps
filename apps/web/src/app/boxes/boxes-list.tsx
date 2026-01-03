"use client";

import { ExternalLink, Plus, Trash2, Rocket } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useBoxes, useDeployBox, useDeleteBox } from "@/hooks/use-boxes";

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    pending: "bg-yellow-100 text-yellow-800",
    deploying: "bg-blue-100 text-blue-800",
    running: "bg-green-100 text-green-800",
    error: "bg-red-100 text-red-800",
    deleted: "bg-gray-100 text-gray-800",
  };

  return (
    <span
      className={`px-2 py-1 rounded-full text-xs font-medium ${colors[status] || colors.pending}`}
    >
      {status}
    </span>
  );
}

function BoxRow({
  box,
}: {
  box: {
    id: string;
    name: string;
    subdomain: string;
    status: string;
    errorMessage: string | null;
  };
}) {
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
    <tr className="border-b">
      <td className="py-4 px-4">{box.name}</td>
      <td className="py-4 px-4 font-mono text-sm">{box.subdomain}</td>
      <td className="py-4 px-4">
        <StatusBadge status={box.status} />
        {box.errorMessage && (
          <p className="text-xs text-red-600 mt-1">{box.errorMessage}</p>
        )}
      </td>
      <td className="py-4 px-4">
        <div className="flex items-center gap-2">
          {showPasswordInput && canDeploy && (
            <div className="flex items-center gap-2">
              <Input
                type="password"
                placeholder="Password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-32"
              />
              <Button
                size="sm"
                onClick={handleDeploy}
                disabled={deployMutation.isPending || !password}
              >
                Go
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
          )}

          {!showPasswordInput && canDeploy && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => setShowPasswordInput(true)}
              disabled={deployMutation.isPending}
            >
              <Rocket className="h-4 w-4 mr-1" />
              Deploy
            </Button>
          )}

          {canOpen && (
            <a
              href={`https://${box.subdomain}.agents.grm.wtf`}
              target="_blank"
              rel="noopener noreferrer"
            >
              <Button size="sm" variant="outline">
                <ExternalLink className="h-4 w-4 mr-1" />
                Open
              </Button>
            </a>
          )}

          <Button
            size="sm"
            variant="ghost"
            onClick={() => deleteMutation.mutate(box.id)}
            disabled={deleteMutation.isPending}
          >
            <Trash2 className="h-4 w-4 text-red-500" />
          </Button>
        </div>
      </td>
    </tr>
  );
}

export default function BoxesList() {
  const { data, isLoading, error } = useBoxes();

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <Skeleton className="h-8 w-48" />
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
          </div>
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-red-600">
          Error loading boxes: {error.message}
        </CardContent>
      </Card>
    );
  }

  const boxes = data?.boxes || [];

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>Boxes</CardTitle>
        <Link href="/boxes/new">
          <Button>
            <Plus className="h-4 w-4 mr-2" />
            New Box
          </Button>
        </Link>
      </CardHeader>
      <CardContent>
        {boxes.length === 0 ? (
          <div className="text-center py-8 text-gray-500">
            No boxes yet. Create your first one!
          </div>
        ) : (
          <table className="w-full">
            <thead>
              <tr className="text-left border-b">
                <th className="py-3 px-4 font-medium">Name</th>
                <th className="py-3 px-4 font-medium">Subdomain</th>
                <th className="py-3 px-4 font-medium">Status</th>
                <th className="py-3 px-4 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {boxes.map((b) => (
                <BoxRow key={b.id} box={b} />
              ))}
            </tbody>
          </table>
        )}
      </CardContent>
    </Card>
  );
}
