"use client";

import { slugify, type McpServerConfig } from "@vps-claude/shared";
import { ArrowLeft, Box, Network } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useMemo } from "react";

import { EnvVarsInput, type EnvVarInput } from "@/components/env-vars-input";
import { McpSelector } from "@/components/mcp-selector";
import { SkillSelector } from "@/components/skill-selector";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useBulkSetBoxEnvVars } from "@/hooks/use-box-env-vars";
import { useCreateBox } from "@/hooks/use-boxes";
import { useCredentials } from "@/hooks/use-credentials";

function generateSubdomainPreview(name: string): string {
  const base = slugify(name);
  return base ? `${base}-xxxx` : "";
}

export default function CreateBoxForm() {
  const router = useRouter();
  const createMutation = useCreateBox();
  const bulkSetEnvVars = useBulkSetBoxEnvVars();
  const { data: credentialsData } = useCredentials();
  const [name, setName] = useState("");
  const [skills, setSkills] = useState<string[]>([]);
  const [mcpServers, setMcpServers] = useState<Record<string, McpServerConfig>>(
    {}
  );
  const [envVars, setEnvVars] = useState<EnvVarInput[]>([]);

  // Tailscale state
  const [enableTailscale, setEnableTailscale] = useState(false);
  const [tailscaleAuthSource, setTailscaleAuthSource] = useState<
    "direct" | "credential"
  >("direct");
  const [tailscaleAuthKey, setTailscaleAuthKey] = useState("");
  const [tailscaleCredentialKey, setTailscaleCredentialKey] = useState("");

  // Filter credentials that might be Tailscale keys
  const tailscaleCredentials = useMemo(
    () =>
      credentialsData?.filter(
        (c: { key: string }) =>
          c.key.toUpperCase().includes("TAILSCALE") ||
          c.key.toUpperCase().includes("TS_")
      ) ?? [],
    [credentialsData]
  );

  const subdomainPreview = useMemo(
    () => generateSubdomainPreview(name),
    [name]
  );

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const hasMcpServers = Object.keys(mcpServers).length > 0;
    createMutation.mutate(
      {
        name,
        skills,
        ...(hasMcpServers && { mcpServers }),
      },
      {
        onSuccess: (data) => {
          // Build env vars list
          const allEnvVars: EnvVarInput[] = [...envVars];

          // Add Tailscale auth key if enabled
          if (enableTailscale) {
            if (tailscaleAuthSource === "direct" && tailscaleAuthKey.trim()) {
              allEnvVars.push({
                key: "TAILSCALE_AUTHKEY",
                type: "literal",
                value: tailscaleAuthKey.trim(),
              });
            } else if (
              tailscaleAuthSource === "credential" &&
              tailscaleCredentialKey
            ) {
              allEnvVars.push({
                key: "TAILSCALE_AUTHKEY",
                type: "credential_ref",
                credentialKey: tailscaleCredentialKey,
              });
            }
          }

          // Set env vars if any were added
          const validEnvVars = allEnvVars.filter(
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

        {/* MCP Servers */}
        <div className="pt-6 border-t">
          <McpSelector value={mcpServers} onChange={setMcpServers} />
        </div>

        {/* Environment Variables */}
        <div className="pt-6 border-t">
          <EnvVarsInput value={envVars} onChange={setEnvVars} />
        </div>

        {/* Tailscale SSH */}
        <div className="pt-6 border-t space-y-4">
          <div className="flex items-center gap-3">
            <Network className="h-4 w-4 text-primary" />
            <Label className="text-sm font-medium">
              Tailscale SSH (Optional)
            </Label>
          </div>

          <div className="flex items-center gap-3">
            <Checkbox
              checked={enableTailscale}
              onCheckedChange={(checked) =>
                setEnableTailscale(checked === true)
              }
            />
            <span className="text-sm text-muted-foreground">
              Enable Tailscale for SSH access via your private network
            </span>
          </div>

          {enableTailscale && (
            <div className="space-y-3 pl-6 border-l-2 border-primary/20">
              <p className="text-xs text-muted-foreground">
                Get an auth key from{" "}
                <a
                  href="https://login.tailscale.com/admin/settings/keys"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary underline"
                >
                  Tailscale Admin Console
                </a>
                . Use reusable + ephemeral + pre-authorized.
              </p>

              <div className="flex gap-2">
                <Button
                  type="button"
                  variant={
                    tailscaleAuthSource === "direct" ? "default" : "outline"
                  }
                  size="sm"
                  onClick={() => setTailscaleAuthSource("direct")}
                >
                  Enter Key
                </Button>
                <Button
                  type="button"
                  variant={
                    tailscaleAuthSource === "credential" ? "default" : "outline"
                  }
                  size="sm"
                  onClick={() => setTailscaleAuthSource("credential")}
                  disabled={tailscaleCredentials.length === 0}
                >
                  Use Credential
                </Button>
              </div>

              {tailscaleAuthSource === "direct" ? (
                <Input
                  type="password"
                  placeholder="tskey-auth-..."
                  value={tailscaleAuthKey}
                  onChange={(e) => setTailscaleAuthKey(e.target.value)}
                  className="font-mono text-sm"
                />
              ) : (
                <select
                  value={tailscaleCredentialKey}
                  onChange={(e) => setTailscaleCredentialKey(e.target.value)}
                  className="w-full h-10 px-3 rounded-md border border-input bg-background text-sm"
                >
                  <option value="">Select a credential...</option>
                  {tailscaleCredentials.map((cred: { key: string }) => (
                    <option key={cred.key} value={cred.key}>
                      {cred.key}
                    </option>
                  ))}
                </select>
              )}
            </div>
          )}
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
