import {
  unstable_v2_createSession,
  unstable_v2_resumeSession,
  type SDKMessage,
  type SDKSessionOptions,
} from "@anthropic-ai/claude-agent-sdk";

import { env } from "../env";
import { getSession, saveSession } from "./sessions";

interface AgentResult {
  result: string;
  sessionId: string;
}

interface ContentBlock {
  type: string;
  text?: string;
}

type TriggerType = "email" | "cron" | "webhook" | "manual" | "default";

interface AgentConfigResponse {
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
  mcpServers: Record<
    string,
    { command: string; args?: string[]; env?: Record<string, string> }
  > | null;
  agents: Record<
    string,
    { name: string; description: string; tools?: string[] }
  > | null;
}

async function fetchAgentConfig(
  triggerType: TriggerType
): Promise<SDKSessionOptions> {
  const url = new URL(`${env.BOX_API_URL}/agent-config`);
  url.searchParams.set("triggerType", triggerType);

  try {
    const response = await fetch(url.toString(), {
      headers: { "X-Box-Secret": env.BOX_API_TOKEN },
    });

    if (!response.ok) {
      console.error("Failed to fetch agent config, using defaults");
      return { model: "claude-sonnet-4-5-20250929" };
    }

    const config = (await response.json()) as AgentConfigResponse;

    // Build SDK options - only include properties supported by the SDK
    const sessionOptions: SDKSessionOptions = {
      model: config.model ?? "claude-sonnet-4-5-20250929",
    };

    // Tools configuration (supported by SDK)
    if (config.allowedTools) {
      sessionOptions.allowedTools = config.allowedTools;
    }
    if (config.disallowedTools) {
      sessionOptions.disallowedTools = config.disallowedTools;
    }

    // Permission mode (supported by SDK)
    if (
      config.permissionMode === "default" ||
      config.permissionMode === "acceptEdits" ||
      config.permissionMode === "plan" ||
      config.permissionMode === "dontAsk"
    ) {
      sessionOptions.permissionMode = config.permissionMode;
    }

    // Note: The following are stored in config but not directly supported by SDK:
    // - systemPrompt, appendSystemPrompt (could be passed via env or hooks)
    // - tools (use allowedTools/disallowedTools instead)
    // - maxTurns, maxBudgetUsd (session limits - not SDK options)
    // - mcpServers, agents (could be configured via MCP or hooks)
    // - persistSession (handled by our session management)

    return sessionOptions;
  } catch (error) {
    console.error("Error fetching agent config:", error);
    return { model: "claude-sonnet-4-5-20250929" };
  }
}

function extractText(msg: SDKMessage): string {
  if (msg.type !== "assistant") return "";
  const content = (msg as { message: { content: ContentBlock[] } }).message
    .content;
  return content
    .filter((b) => b.type === "text")
    .map((b) => b.text ?? "")
    .join("");
}

export async function runWithSession(opts: {
  prompt: string;
  contextType: string;
  contextId: string;
}): Promise<AgentResult> {
  const triggerType = (opts.contextType as TriggerType) || "default";
  const agentConfig = await fetchAgentConfig(triggerType);

  const existingSessionId = getSession(opts.contextType, opts.contextId);

  // V2 API: create or resume session with fetched config
  const session = existingSessionId
    ? unstable_v2_resumeSession(existingSessionId, agentConfig)
    : unstable_v2_createSession(agentConfig);

  await session.send(opts.prompt);

  let result = "";
  let sessionId = "";

  // https://platform.claude.com/docs/en/agent-sdk/typescript-v2-preview#unstable-v2-create-session:~:text=await-,session.send(%27Multiply%20that%20by%202%27),%7D,-See%20the%20same
  // @ts-expect-error - receive is not a property of SDKSession
  for await (const msg of session.receive()) {
    sessionId = msg.session_id;
    result += extractText(msg);
  }

  session.close();

  // Save session for future resumption
  if (sessionId) {
    saveSession(opts.contextType, opts.contextId, sessionId);
  }

  return { result, sessionId };
}
