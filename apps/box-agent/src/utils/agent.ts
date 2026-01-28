import {
  unstable_v2_createSession,
  unstable_v2_resumeSession,
  type SDKMessage,
} from "@anthropic-ai/claude-agent-sdk";
import { existsSync } from "node:fs";

import { logger } from "../logger";
import { getSession, saveSession } from "./sessions";

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
  "/.sprite/bin/claude",
  "/usr/local/bin/claude",
  "/usr/bin/claude",
  "/home/sprite/.local/bin/claude",
  "/home/coder/.local/bin/claude",
  // macOS paths for local testing
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

function buildSessionOptions() {
  const claudePath =
    process.env.CLAUDE_CODE_PATH ||
    findClaudeExecutable() ||
    "/.sprite/bin/claude";

  return {
    model: "claude-sonnet-4-5-20250929" as const,
    pathToClaudeCodeExecutable: claudePath,
    permissionMode: "default" as const,
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
}): Promise<AgentResult> {
  logger.info(
    `[runWithSession] Starting session for ${opts.contextType}:${opts.contextId}`
  );

  const existingSessionId = getSession(opts.contextType, opts.contextId);
  const sessionOptions = buildSessionOptions();

  logger.info(
    `[runWithSession] Using Claude at: ${sessionOptions.pathToClaudeCodeExecutable}`
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
