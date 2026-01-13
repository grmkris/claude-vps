"use client";

import { slugify } from "@vps-claude/shared";
import { ArrowLeft, Box } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useMemo } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useCreateBox } from "@/hooks/use-boxes";

function generateSubdomainPreview(name: string): string {
  const base = slugify(name);
  return base ? `${base}-xxxx` : "";
}

export default function CreateBoxForm() {
  const router = useRouter();
  const createMutation = useCreateBox();
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [telegramBotToken, setTelegramBotToken] = useState("");
  const [telegramChatId, setTelegramChatId] = useState("");

  const subdomainPreview = useMemo(
    () => generateSubdomainPreview(name),
    [name]
  );

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    createMutation.mutate(
      {
        name,
        password,
        ...(telegramBotToken && { telegramBotToken }),
        ...(telegramChatId && { telegramChatId }),
      },
      {
        onSuccess: () => {
          router.push("/");
        },
      }
    );
  };

  const isValid = name.length >= 1 && name.length <= 50 && password.length >= 8;

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
                {subdomainPreview}.agents.claude-vps.grm.wtf
              </span>
            </p>
          )}
        </div>

        <div className="space-y-2">
          <Label htmlFor="password" className="text-sm font-medium">
            Password
          </Label>
          <Input
            id="password"
            type="password"
            placeholder="Minimum 8 characters"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            minLength={8}
            maxLength={100}
            required
            className="h-12"
          />
          <p className="text-sm text-muted-foreground">
            Used to access your Claude Code box via browser
          </p>
        </div>

        {/* Telegram Configuration (Optional) */}
        <div className="space-y-4 pt-6 border-t">
          <div className="space-y-2">
            <h3 className="text-sm font-medium">
              Telegram Integration (Optional)
            </h3>
            <p className="text-sm text-muted-foreground">
              Connect your box to Telegram for chat-based Claude Code
              interaction
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="telegramBotToken" className="text-sm font-medium">
              Bot Token
            </Label>
            <Input
              id="telegramBotToken"
              type="text"
              placeholder="123456:ABCdefGHIjklmnoPQRstuVWXyz"
              value={telegramBotToken}
              onChange={(e) => setTelegramBotToken(e.target.value)}
              className="h-12"
            />
            <p className="text-xs text-muted-foreground">
              Create a bot via{" "}
              <code className="text-xs bg-muted px-1 py-0.5 rounded">
                @BotFather
              </code>{" "}
              on Telegram
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="telegramChatId" className="text-sm font-medium">
              Chat ID
            </Label>
            <Input
              id="telegramChatId"
              type="text"
              placeholder="123456789"
              value={telegramChatId}
              onChange={(e) => setTelegramChatId(e.target.value)}
              className="h-12"
            />
            <p className="text-xs text-muted-foreground">
              Message your bot, then use{" "}
              <code className="text-xs bg-muted px-1 py-0.5 rounded">
                @userinfobot
              </code>{" "}
              to get your chat ID
            </p>
          </div>
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
