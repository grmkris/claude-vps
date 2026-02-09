import { readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

interface McpServerConfig {
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  type?: string;
  url?: string;
  headers?: Record<string, string>;
}

// Default ai-tools MCP server (always included)
const AI_TOOLS_MCP = {
  type: "http" as const,
  url: "http://localhost:33002/mcp",
};

/**
 * Sync MCP servers from agent config to ~/.claude.json mcpServers key.
 * This is the user-scope config that `claude mcp list` reads.
 *
 * Always includes ai-tools HTTP server.
 * Preserves existing .claude.json keys (auth, feature flags, etc.).
 * Rewrites `npx` → `bunx` for bun-based environments.
 */
export async function syncMcpSettings(
  mcpServers: Record<string, McpServerConfig>
): Promise<void> {
  const configPath = join(homedir(), ".claude.json");

  let config: Record<string, unknown> = {};
  try {
    config = JSON.parse(await readFile(configPath, "utf-8"));
  } catch {
    // File doesn't exist or invalid JSON, start fresh
  }

  // Always include ai-tools, then merge user MCPs
  const merged: Record<string, McpServerConfig> = {
    "ai-tools": AI_TOOLS_MCP,
    ...mcpServers,
  };

  // Rewrite npx → bunx for bun-based containers
  const rewritten = Object.fromEntries(
    Object.entries(merged).map(([name, cfg]) => {
      if ("command" in cfg && cfg.command === "npx") {
        return [name, { ...cfg, command: "bunx" }];
      }
      return [name, cfg];
    })
  );

  config.mcpServers = rewritten;

  await writeFile(configPath, JSON.stringify(config, null, 2));
}
