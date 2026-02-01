import {
  unstable_v2_createSession,
  unstable_v2_resumeSession,
  type SDKMessage,
} from "@anthropic-ai/claude-agent-sdk";
import { existsSync } from "node:fs";

import { env } from "../env";
import { logger } from "../logger";
import { getSession, saveSession } from "./sessions";

// MCP server config types
interface McpServerConfigStdio {
  type?: "stdio";
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

interface McpServerConfigSse {
  type: "sse";
  url: string;
  headers?: Record<string, string>;
}

type McpServerConfig = McpServerConfigStdio | McpServerConfigSse;

// Agent config from API
interface AgentConfig {
  model: string | null;
  systemPrompt: string | null;
  appendSystemPrompt: string | null;
  tools: string[] | null;
  allowedTools: string[] | null;
  disallowedTools: string[] | null;
  permissionMode: string | null;
  maxTurns: number | null;
  maxBudgetUsd: string | null;
  persistSession: boolean | null;
  mcpServers: Record<string, McpServerConfig> | null;
  agents: Record<string, unknown> | null;
}

const DEFAULT_CONFIG: AgentConfig = {
  model: "claude-sonnet-4-5-20250929",
  systemPrompt: null,
  appendSystemPrompt: null,
  tools: null,
  allowedTools: null,
  disallowedTools: null,
  permissionMode: "bypassPermissions",
  maxTurns: 50,
  maxBudgetUsd: "1.00",
  persistSession: true,
  mcpServers: null,
  agents: null,
};

async function fetchAgentConfig(triggerType: string): Promise<AgentConfig> {
  try {
    const url = `${env.BOX_API_URL}/agent-config?triggerType=${triggerType}`;
    logger.info(`[fetchAgentConfig] Fetching config from ${url}`);

    const response = await fetch(url, {
      headers: {
        "X-Box-Secret": env.BOX_API_TOKEN,
      },
    });

    if (!response.ok) {
      logger.warn(
        `[fetchAgentConfig] Failed to fetch config: ${response.status}`
      );
      return DEFAULT_CONFIG;
    }

    const config = (await response.json()) as AgentConfig;
    logger.info(`[fetchAgentConfig] Got config, model: ${config.model}`);
    return config;
  } catch (error) {
    logger.warn({ err: error }, "[fetchAgentConfig] Error fetching config");
    return DEFAULT_CONFIG;
  }
}

interface AgentResult {
  result: string;
  sessionId: string;
}

interface ContentBlock {
  type: string;
  text?: string;
}

// Common locations for Claude Code executable
const CLAUDE_PATHS = [
  // Bun global install location (sprites)
  "/home/sprite/.bun/bin/claude",
  "/.sprite/bin/claude",
  "/usr/local/bin/claude",
  "/usr/bin/claude",
  "/home/sprite/.local/bin/claude",
  "/home/coder/.local/bin/claude",
  // macOS paths for local testing
  `${process.env.HOME}/.bun/bin/claude`,
  `${process.env.HOME}/.local/bin/claude`,
  `${process.env.HOME}/.npm-global/bin/claude`,
];

function findClaudeExecutable(): string | null {
  for (const path of CLAUDE_PATHS) {
    if (existsSync(path)) {
      return path;
    }
  }
  return null;
}

function buildSessionOptions(config: AgentConfig) {
  const claudePath =
    process.env.CLAUDE_CODE_PATH ||
    findClaudeExecutable() ||
    "/.sprite/bin/claude";

  // Map config values to SDK options
  const model = (config.model ?? "claude-sonnet-4-5-20250929") as
    | "claude-sonnet-4-5-20250929"
    | "claude-opus-4-5-20251101"
    | "claude-3-5-sonnet-20241022";

  const permissionMode = (config.permissionMode ?? "bypassPermissions") as
    | "default"
    | "bypassPermissions";

  return {
    model,
    pathToClaudeCodeExecutable: claudePath,
    permissionMode,
    allowedTools: config.allowedTools ?? undefined,
    disallowedTools: config.disallowedTools ?? undefined,
    maxTurns: config.maxTurns ?? undefined,
    systemPrompt: config.appendSystemPrompt ?? undefined,
    mcpServers: config.mcpServers ?? undefined,
  };
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
  triggerType?: string;
}): Promise<AgentResult> {
  logger.info(
    `[runWithSession] Starting session for ${opts.contextType}:${opts.contextId}`
  );

  // Fetch config from API (falls back to defaults on error)
  const triggerType = opts.triggerType ?? "default";
  const config = await fetchAgentConfig(triggerType);

  const existingSessionId = getSession(opts.contextType, opts.contextId);
  const sessionOptions = buildSessionOptions(config);

  logger.info(
    `[runWithSession] Using Claude at: ${sessionOptions.pathToClaudeCodeExecutable}`
  );
  logger.info(`[runWithSession] Model: ${sessionOptions.model}`);
  logger.info(
    `[runWithSession] Permission mode: ${sessionOptions.permissionMode}`
  );
  logger.info(
    `[runWithSession] Existing session: ${existingSessionId || "none"}`
  );

  const session = existingSessionId
    ? unstable_v2_resumeSession(existingSessionId, sessionOptions)
    : unstable_v2_createSession(sessionOptions);

  try {
    await session.send(opts.prompt);

    let result = "";
    let sessionId = existingSessionId ?? "";

    for await (const msg of session.stream()) {
      // Capture session ID from first message
      if (!sessionId && msg.session_id) {
        sessionId = msg.session_id;
        saveSession(opts.contextType, opts.contextId, sessionId);
        logger.info(`[runWithSession] Saved new session: ${sessionId}`);
      }
      logger.info(`[runWithSession] Received message type: ${msg.type}`);
      result += extractText(msg);
    }

    logger.info(`[runWithSession] Done. Result length: ${result.length}`);
    return { result, sessionId };
  } catch (error) {
    logger.error({ err: error }, "[runWithSession] Error");
    throw error;
  } finally {
    session.close();
  }
}
