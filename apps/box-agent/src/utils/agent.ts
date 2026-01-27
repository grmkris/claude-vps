import {
  query,
  type Options,
  type SDKMessage,
} from "@anthropic-ai/claude-agent-sdk";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";

import { env } from "../env";
import { saveSession } from "./sessions";

interface AgentResult {
  result: string;
}

interface ContentBlock {
  type: string;
  text?: string;
}

type TriggerType = "default" | "email" | "cron" | "webhook";

interface AgentConfigResponse {
  model: string | null;
  systemPrompt: string | null;
  appendSystemPrompt: string | null;
  permissionMode: string | null;
  allowedTools: string[] | null;
  disallowedTools: string[] | null;
  tools: string[] | null;
  maxTurns: number | null;
  maxBudgetUsd: number | null;
  persistSession: boolean | null;
  mcpServers: Record<
    string,
    { command: string; args?: string[]; env?: Record<string, string> }
  > | null;
  agents: Record<
    string,
    { name: string; description: string; tools?: string[] }
  > | null;
  // Error response shape
  code?: string;
}

// Common locations for Claude Code executable
const CLAUDE_PATHS = [
  "/.sprite/bin/claude",
  "/usr/local/bin/claude",
  "/usr/bin/claude",
  "/home/sprite/.local/bin/claude",
  "/home/coder/.local/bin/claude",
  // macOS paths for local testing
  `${process.env.HOME}/.local/bin/claude`,
  `${process.env.HOME}/.npm-global/bin/claude`,
];

// MCP script path - configurable for local testing
const MCP_SCRIPT_PATH =
  process.env.BOX_MCP_SCRIPT_PATH || "/home/sprite/start-mcp.sh";

async function findClaudeExecutable(): Promise<string | null> {
  for (const path of CLAUDE_PATHS) {
    if (existsSync(path)) {
      return path;
    }
  }
  return null;
}

async function fetchAgentConfig(triggerType: TriggerType): Promise<Options> {
  const url = new URL(`${env.BOX_API_URL}/agent-config`);
  url.searchParams.set("triggerType", triggerType);

  console.log(`[fetchAgentConfig] Fetching from: ${url.toString()}`);
  console.log(
    `[fetchAgentConfig] Token (first 8 chars): ${env.BOX_API_TOKEN?.slice(0, 8)}...`
  );

  const claudePath =
    process.env.CLAUDE_CODE_PATH ||
    (await findClaudeExecutable()) ||
    "/.sprite/bin/claude";

  // Default MCP server for AI tools - use wrapper script that has env vars
  // The wrapper script sources env vars needed for API calls
  // Path is configurable via BOX_MCP_SCRIPT_PATH for local testing
  const defaultMcpServers = {
    "ai-tools": {
      command: MCP_SCRIPT_PATH,
      args: [] as string[],
    },
  };

  // Default options with MCP servers
  const defaultOptions: Options = {
    model: "claude-sonnet-4-5-20250929",
    pathToClaudeCodeExecutable: claudePath,
    settingSources: ["user"],
    mcpServers: defaultMcpServers,
    permissionMode: "default",
  };

  try {
    // Use curl as workaround for Bun fetch timeout issues with some networks
    const curlCmd = `curl -sS --max-time 30 -H "X-Box-Secret: ${env.BOX_API_TOKEN}" -H "ngrok-skip-browser-warning: true" "${url.toString()}"`;
    console.log(`[fetchAgentConfig] Using curl as workaround...`);

    const { execSync } = await import("node:child_process");
    const curlResult = execSync(curlCmd, { encoding: "utf-8" });
    console.log(
      `[fetchAgentConfig] Curl response: ${curlResult.slice(0, 200)}...`
    );

    // Check if curl returned an error response
    let config: AgentConfigResponse;
    try {
      config = JSON.parse(curlResult) as AgentConfigResponse;
    } catch {
      console.error(
        `[fetchAgentConfig] Failed to parse response: ${curlResult}`
      );
      return defaultOptions;
    }

    // Check for error response from API
    if ("code" in config && config.code === "UNAUTHORIZED") {
      console.error(
        `[fetchAgentConfig] Unauthorized: ${JSON.stringify(config)}`
      );
      return defaultOptions;
    }

    console.log(`[fetchAgentConfig] Got config, model: ${config.model}`);
    console.log(`[fetchAgentConfig] Using Claude at: ${claudePath}`);

    // Build Options with mcpServers
    // Always use the wrapper script for ai-tools to ensure env vars are set
    const mcpServers = {
      ...config.mcpServers,
      // Override ai-tools to use wrapper script with env vars
      "ai-tools": defaultMcpServers["ai-tools"],
    };

    const options: Options = {
      model: config.model ?? "claude-sonnet-4-5-20250929",
      pathToClaudeCodeExecutable: claudePath,
      settingSources: ["user"],
      mcpServers,
      permissionMode:
        (config.permissionMode as Options["permissionMode"]) ?? "default",
    };

    // Add optional configurations
    if (config.allowedTools) {
      options.allowedTools = config.allowedTools;
    }
    if (config.disallowedTools) {
      options.disallowedTools = config.disallowedTools;
    }

    return options;
  } catch (error) {
    console.error("Error fetching agent config:", error);
    return defaultOptions;
  }
}

function extractText(msg: SDKMessage): string {
  if (msg.type === "assistant") {
    const content = msg.message?.content;
    if (Array.isArray(content)) {
      return content
        .filter((block: ContentBlock) => block.type === "text")
        .map((block: ContentBlock) => block.text || "")
        .join("");
    }
  }
  return "";
}

export async function runWithSession(opts: {
  prompt: string;
  contextType: string;
  contextId: string;
}): Promise<AgentResult> {
  console.log(
    `[runWithSession] Starting session for ${opts.contextType}:${opts.contextId}`
  );

  // Generate a session ID for tracking (SDK doesn't expose resumable session IDs yet)
  const sessionId = randomUUID();

  // Save session record before starting (so it appears in UI immediately)
  saveSession(opts.contextType, opts.contextId, sessionId);
  console.log(`[runWithSession] Saved session: ${sessionId}`);

  try {
    const triggerType = (opts.contextType as TriggerType) || "default";
    console.log(
      `[runWithSession] Fetching agent config for trigger: ${triggerType}`
    );
    const agentConfig = await fetchAgentConfig(triggerType);
    console.log(`[runWithSession] Got config with model: ${agentConfig.model}`);
    console.log(
      `[runWithSession] MCP servers: ${JSON.stringify(Object.keys(agentConfig.mcpServers || {}))}`
    );

    // Use query() API which supports mcpServers
    // Query is an AsyncGenerator that yields SDKMessage
    console.log(`[runWithSession] Creating query...`);
    const q = query({
      prompt: opts.prompt,
      options: agentConfig,
    });

    console.log(`[runWithSession] Iterating query messages...`);
    let result = "";
    for await (const msg of q) {
      console.log(`[runWithSession] Received message type: ${msg.type}`);
      result += extractText(msg);
    }

    // Update session timestamp on completion
    saveSession(opts.contextType, opts.contextId, sessionId);

    console.log(`[runWithSession] Done. Result length: ${result.length}`);
    return { result };
  } catch (error) {
    console.error(`[runWithSession] Error:`, error);
    throw error;
  }
}
