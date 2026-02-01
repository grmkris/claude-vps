"use client";

import { Eye, EyeOff, Plus, Trash2, Variable } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useCredentials } from "@/hooks/use-credentials";
import { cn } from "@/lib/utils";

export interface EnvVarInput {
  key: string;
  type: "literal" | "credential_ref";
  value?: string;
  credentialKey?: string;
}

interface EnvVarsInputProps {
  value: EnvVarInput[];
  onChange: (envVars: EnvVarInput[]) => void;
}

/** Parse pasted text into env var entries */
function parseBulkEnvVars(text: string): EnvVarInput[] {
  const lines = text.split(/[\n\r]+/).filter(Boolean);
  const results: EnvVarInput[] = [];

  for (const line of lines) {
    // Skip comments
    if (line.trim().startsWith("#")) continue;

    // Parse KEY=value format
    const eqIndex = line.indexOf("=");
    if (eqIndex > 0) {
      const key = line.slice(0, eqIndex).trim().toUpperCase();
      const value = line.slice(eqIndex + 1).trim();
      // Remove surrounding quotes if present
      const cleanValue = value.replace(/^["']|["']$/g, "");
      if (/^[A-Z_][A-Z0-9_]*$/.test(key)) {
        results.push({ key, type: "literal", value: cleanValue });
      }
    }
  }

  return results;
}

function EnvVarRow({
  envVar,
  index,
  credentials,
  onUpdate,
  onRemove,
  onBulkAdd,
}: {
  envVar: EnvVarInput;
  index: number;
  credentials: Array<{ key: string }>;
  onUpdate: (index: number, updated: EnvVarInput) => void;
  onRemove: (index: number) => void;
  onBulkAdd: (newVars: EnvVarInput[]) => void;
}) {
  const [showValue, setShowValue] = useState(false);

  const handleKeyPaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
    const text = e.clipboardData.getData("text");
    const parsed = parseBulkEnvVars(text);

    if (parsed.length > 1) {
      e.preventDefault();
      // If current row is empty, replace it; otherwise add after
      if (!envVar.key && !envVar.value) {
        onUpdate(index, parsed[0]!);
        onBulkAdd(parsed.slice(1));
      } else {
        onBulkAdd(parsed);
      }
      toast.success(`Added ${parsed.length} environment variables`);
    }
  };

  const handleCredentialSelect = (credentialKey: string) => {
    if (credentialKey) {
      onUpdate(index, {
        ...envVar,
        credentialKey,
        // Auto-fill name from credential if empty
        key: envVar.key || credentialKey,
      });
    }
  };

  return (
    <div className="flex gap-2 items-start">
      <div className="w-[180px] shrink-0">
        <Input
          placeholder="KEY_NAME"
          value={envVar.key}
          onChange={(e) =>
            onUpdate(index, { ...envVar, key: e.target.value.toUpperCase() })
          }
          onPaste={handleKeyPaste}
          className="font-mono h-9"
        />
      </div>

      <Select
        value={envVar.type}
        onValueChange={(type) =>
          type &&
          onUpdate(index, {
            ...envVar,
            type: type as "literal" | "credential_ref",
            value: type === "literal" ? envVar.value : undefined,
            credentialKey:
              type === "credential_ref" ? envVar.credentialKey : undefined,
          })
        }
      >
        <SelectTrigger className="w-[120px] shrink-0 h-9">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="literal">Custom</SelectItem>
          <SelectItem value="credential_ref">Credential</SelectItem>
        </SelectContent>
      </Select>

      <div className="flex-1 min-w-0">
        {envVar.type === "literal" ? (
          <div className="relative">
            <Input
              type={showValue ? "text" : "password"}
              placeholder="value"
              value={envVar.value ?? ""}
              onChange={(e) =>
                onUpdate(index, { ...envVar, value: e.target.value })
              }
              className="font-mono h-9 pr-9"
            />
            <button
              type="button"
              onClick={() => setShowValue(!showValue)}
              className="absolute right-2 top-1/2 -translate-y-1/2 p-1 hover:bg-secondary rounded"
            >
              {showValue ? (
                <EyeOff className="h-3.5 w-3.5 text-muted-foreground" />
              ) : (
                <Eye className="h-3.5 w-3.5 text-muted-foreground" />
              )}
            </button>
          </div>
        ) : (
          <Select
            value={envVar.credentialKey ?? ""}
            onValueChange={(v) => v && handleCredentialSelect(v)}
          >
            <SelectTrigger
              className={cn(
                "h-9 font-mono",
                !envVar.credentialKey && "text-muted-foreground"
              )}
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
        )}
      </div>

      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={() => onRemove(index)}
        className="h-9 px-2 shrink-0"
      >
        <Trash2 className="h-4 w-4 text-muted-foreground" />
      </Button>
    </div>
  );
}

export function EnvVarsInput({ value, onChange }: EnvVarsInputProps) {
  const { data: credentials = [] } = useCredentials();

  const addEnvVar = () => {
    onChange([...value, { key: "", type: "literal", value: "" }]);
  };

  const updateEnvVar = (index: number, updated: EnvVarInput) => {
    const newEnvVars = [...value];
    newEnvVars[index] = updated;
    onChange(newEnvVars);
  };

  const removeEnvVar = (index: number) => {
    onChange(value.filter((_, i) => i !== index));
  };

  const bulkAddEnvVars = (newVars: EnvVarInput[]) => {
    onChange([...value, ...newVars]);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Variable className="h-4 w-4 text-primary" />
          <Label className="text-sm font-medium">
            Environment Variables (Optional)
          </Label>
        </div>
        {value.length > 0 && (
          <span className="text-xs text-muted-foreground">
            {value.length} variable{value.length !== 1 && "s"}
          </span>
        )}
      </div>

      {value.length > 0 && (
        <div className="space-y-2">
          {value.map((envVar, index) => (
            <EnvVarRow
              key={index}
              envVar={envVar}
              index={index}
              credentials={credentials}
              onUpdate={updateEnvVar}
              onRemove={removeEnvVar}
              onBulkAdd={bulkAddEnvVars}
            />
          ))}
        </div>
      )}

      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={addEnvVar}
        className="w-full"
      >
        <Plus className="h-4 w-4 mr-2" />
        Add Variable
      </Button>

      <p className="text-xs text-muted-foreground">
        Variables are injected into the box at deploy time.{" "}
        <span className="text-primary">Credential</span> type references your
        saved credentials. Paste multiple KEY=value lines to bulk add.
      </p>
    </div>
  );
}
