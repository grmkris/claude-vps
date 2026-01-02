"use client";

import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useMemo } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useCreateEnvironment } from "@/hooks/use-environments";
import { slugify } from "@vps-claude/shared";

function generateSubdomainPreview(name: string): string {
  const base = slugify(name);
  return base ? `${base}-xxxx` : "";
}

export default function CreateEnvironmentForm() {
  const router = useRouter();
  const createMutation = useCreateEnvironment();
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");

  const subdomainPreview = useMemo(() => generateSubdomainPreview(name), [name]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    createMutation.mutate(
      { name, password },
      {
        onSuccess: () => {
          router.push("/environments");
        },
      },
    );
  };

  const isValid = name.length >= 1 && name.length <= 50 && password.length >= 8;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2 mb-4">
          <Link href="/environments">
            <Button variant="ghost" size="sm">
              <ArrowLeft className="h-4 w-4 mr-1" />
              Back
            </Button>
          </Link>
        </div>
        <CardTitle>Create Environment</CardTitle>
        <CardDescription>Deploy a new Claude Code environment</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="space-y-2">
            <Label htmlFor="name">Environment Name</Label>
            <Input
              id="name"
              type="text"
              placeholder="My Workspace"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={50}
              required
            />
            {subdomainPreview && (
              <p className="text-sm text-gray-500">
                Subdomain preview:{" "}
                <span className="font-mono">{subdomainPreview}.agents.grm.wtf</span>
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              type="password"
              placeholder="Minimum 8 characters"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              minLength={8}
              maxLength={100}
              required
            />
            <p className="text-sm text-gray-500">
              This password will be used to access your Claude Code environment
            </p>
          </div>

          <Button type="submit" className="w-full" disabled={!isValid || createMutation.isPending}>
            {createMutation.isPending ? "Creating..." : "Create Environment"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
