import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

interface ClaudeHook {
  matcher?: string;
  hooks: Array<{
    type: "command" | "prompt" | "agent";
    command?: string;
    prompt?: string;
    timeout?: number;
  }>;
}

interface ClaudeSettings {
  hooks?: {
    PostToolUse?: ClaudeHook[];
    SessionStart?: ClaudeHook[];
    [key: string]: ClaudeHook[] | undefined;
  };
  [key: string]: unknown;
}

export async function setupHooks(): Promise<void> {
  const home = homedir();
  const settingsPath = join(home, ".claude", "settings.json");

  let settings: ClaudeSettings = {};
  try {
    const content = await readFile(settingsPath, "utf-8");
    settings = JSON.parse(content);
  } catch {
    // File doesn't exist, start fresh
  }

  settings.hooks ??= {};

  const cmd = "/usr/local/bin/box-agent check-notifications";

  const postToolUseHook: ClaudeHook = {
    matcher: ".*",
    hooks: [{ type: "command", command: cmd }],
  };

  const sessionStartHook: ClaudeHook = {
    hooks: [{ type: "command", command: `${cmd} --on-start` }],
  };

  const hasPostToolUse = settings.hooks.PostToolUse?.some((h) =>
    h.hooks.some((hook) =>
      hook.command?.includes("box-agent check-notifications")
    )
  );

  const hasSessionStart = settings.hooks.SessionStart?.some((h) =>
    h.hooks.some((hook) =>
      hook.command?.includes("box-agent check-notifications")
    )
  );

  if (!hasPostToolUse) {
    settings.hooks.PostToolUse = [
      ...(settings.hooks.PostToolUse || []),
      postToolUseHook,
    ];
  }

  if (!hasSessionStart) {
    settings.hooks.SessionStart = [
      ...(settings.hooks.SessionStart || []),
      sessionStartHook,
    ];
  }

  await mkdir(dirname(settingsPath), { recursive: true });
  await writeFile(settingsPath, JSON.stringify(settings, null, 2));

  console.log(`Hooks configured in ${settingsPath}`);
  console.log("- PostToolUse: Check for notifications after each tool call");
  console.log("- SessionStart: Check for notifications when session starts");
}

if (import.meta.main) {
  await setupHooks();
}
