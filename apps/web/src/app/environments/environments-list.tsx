"use client";

import { ExternalLink, Plus, Trash2, Rocket, TerminalIcon } from "lucide-react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  useEnvironments,
  useDeployEnvironment,
  useDeleteEnvironment,
} from "@/hooks/use-environments";

const Terminal = dynamic(() => import("@/components/terminal").then((m) => ({ default: m.Terminal })), {
  ssr: false,
  loading: () => <div className="h-[400px] bg-[#1a1b26] rounded-lg animate-pulse" />,
});

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

function EnvironmentRow({
  environment,
  onOpenTerminal,
}: {
  environment: {
    id: string;
    name: string;
    subdomain: string;
    status: string;
    errorMessage: string | null;
  };
  onOpenTerminal: (envId: string) => void;
}) {
  const [password, setPassword] = useState("");
  const [showPasswordInput, setShowPasswordInput] = useState(false);
  const deployMutation = useDeployEnvironment();
  const deleteMutation = useDeleteEnvironment();

  const canDeploy = environment.status === "pending" || environment.status === "error";
  const canOpen = environment.status === "running";
  const canTerminal = environment.status === "running";

  const handleDeploy = () => {
    if (!password) {
      setShowPasswordInput(true);
      return;
    }
    deployMutation.mutate(
      { id: environment.id, password },
      {
        onSuccess: () => {
          setShowPasswordInput(false);
          setPassword("");
        },
      },
    );
  };

  return (
    <tr className="border-b">
      <td className="py-4 px-4">{environment.name}</td>
      <td className="py-4 px-4 font-mono text-sm">{environment.subdomain}</td>
      <td className="py-4 px-4">
        <StatusBadge status={environment.status} />
        {environment.errorMessage && (
          <p className="text-xs text-red-600 mt-1">{environment.errorMessage}</p>
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

          {canTerminal && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => onOpenTerminal(environment.id)}
            >
              <TerminalIcon className="h-4 w-4 mr-1" />
              Terminal
            </Button>
          )}

          {canOpen && (
            <a
              href={`https://${environment.subdomain}.agents.grm.wtf`}
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
            onClick={() => deleteMutation.mutate(environment.id)}
            disabled={deleteMutation.isPending}
          >
            <Trash2 className="h-4 w-4 text-red-500" />
          </Button>
        </div>
      </td>
    </tr>
  );
}

export default function EnvironmentsList() {
  const { data, isLoading, error } = useEnvironments();
  const [activeTerminal, setActiveTerminal] = useState<string | null>(null);

  const wsUrl = typeof window !== "undefined"
    ? `${window.location.protocol === "https:" ? "wss:" : "ws:"}//${process.env.NEXT_PUBLIC_SERVER_URL?.replace(/^https?:\/\//, "") || "localhost:3000"}/ws/terminal`
    : "";

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
          Error loading environments: {error.message}
        </CardContent>
      </Card>
    );
  }

  const environments = data?.environments || [];

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>Environments</CardTitle>
        <Link href="/environments/new">
          <Button>
            <Plus className="h-4 w-4 mr-2" />
            New Environment
          </Button>
        </Link>
      </CardHeader>
      <CardContent>
        {environments.length === 0 ? (
          <div className="text-center py-8 text-gray-500">
            No environments yet. Create your first one!
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
              {environments.map((env) => (
                <EnvironmentRow
                  key={env.id}
                  environment={env}
                  onOpenTerminal={setActiveTerminal}
                />
              ))}
            </tbody>
          </table>
        )}

        {activeTerminal && (
          <div className="mt-6">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-sm font-medium">
                Terminal - {environments.find((e) => e.id === activeTerminal)?.name}
              </h3>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setActiveTerminal(null)}
              >
                Close
              </Button>
            </div>
            <Terminal
              environmentId={activeTerminal}
              wsUrl={wsUrl}
              onClose={() => setActiveTerminal(null)}
            />
          </div>
        )}
      </CardContent>
    </Card>
  );
}
