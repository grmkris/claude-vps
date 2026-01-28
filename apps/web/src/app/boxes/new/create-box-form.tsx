"use client";

import { slugify } from "@vps-claude/shared";
import { ArrowLeft, Box } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useMemo } from "react";

import { EnvVarsInput, type EnvVarInput } from "@/components/env-vars-input";
import { SkillSelector } from "@/components/skill-selector";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useBulkSetBoxEnvVars } from "@/hooks/use-box-env-vars";
import { useCreateBox } from "@/hooks/use-boxes";

function generateSubdomainPreview(name: string): string {
  const base = slugify(name);
  return base ? `${base}-xxxx` : "";
}

export default function CreateBoxForm() {
  const router = useRouter();
  const createMutation = useCreateBox();
  const bulkSetEnvVars = useBulkSetBoxEnvVars();
  const [name, setName] = useState("");
  const [skills, setSkills] = useState<string[]>([]);
  const [envVars, setEnvVars] = useState<EnvVarInput[]>([]);

  const subdomainPreview = useMemo(
    () => generateSubdomainPreview(name),
    [name]
  );

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    createMutation.mutate(
      {
        name,
        skills,
      },
      {
        onSuccess: (data) => {
          // Set env vars if any were added
          const validEnvVars = envVars.filter(
            (ev) =>
              ev.key && (ev.type === "literal" ? ev.value : ev.credentialKey)
          );
          if (validEnvVars.length > 0) {
            bulkSetEnvVars.mutate({
              boxId: data.box.id,
              envVars: validEnvVars,
            });
          }
          router.push("/");
        },
      }
    );
  };

  const isValid = name.length >= 1 && name.length <= 50;

  return (
    <div className="w-full max-w-md">
      {/* Back link */}
      <Link
        href="/"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors mb-8"
      >
        <ArrowLeft className="h-4 w-4" />
        Back
      </Link>

      {/* Header */}
      <div className="flex items-center gap-4 mb-8">
        <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10">
          <Box className="h-6 w-6 text-primary" />
        </div>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Create Box</h1>
          <p className="text-muted-foreground">
            Deploy a new Claude Code environment
          </p>
        </div>
      </div>

      {/* Form */}
      <form onSubmit={handleSubmit} className="space-y-6">
        <div className="space-y-2">
          <Label htmlFor="name" className="text-sm font-medium">
            Box Name
          </Label>
          <Input
            id="name"
            type="text"
            placeholder="my-project"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={50}
            required
            className="h-12"
          />
          {subdomainPreview && (
            <p className="text-sm text-muted-foreground">
              Your box will be available at{" "}
              <span className="font-mono text-primary">
                {subdomainPreview}.sprites.dev
              </span>
            </p>
          )}
        </div>

        {/* Skills.sh Skills */}
        <div className="pt-6 border-t">
          <SkillSelector value={skills} onChange={setSkills} />
        </div>

        {/* Environment Variables */}
        <div className="pt-6 border-t">
          <EnvVarsInput value={envVars} onChange={setEnvVars} />
        </div>

        <Button
          type="submit"
          size="lg"
          className="w-full h-12"
          disabled={!isValid || createMutation.isPending}
        >
          {createMutation.isPending ? "Creating..." : "Create Box"}
        </Button>
      </form>
    </div>
  );
}
