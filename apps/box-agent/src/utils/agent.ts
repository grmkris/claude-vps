import {
  unstable_v2_createSession,
  unstable_v2_resumeSession,
  type SDKMessage,
} from "@anthropic-ai/claude-agent-sdk";

import { getSession, saveSession } from "./sessions";

interface AgentResult {
  result: string;
  sessionId: string;
}

interface ContentBlock {
  type: string;
  text?: string;
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
  const existingSessionId = getSession(opts.contextType, opts.contextId);

  // V2 API: create or resume session
  const session = existingSessionId
    ? unstable_v2_resumeSession(existingSessionId, {
        model: "claude-sonnet-4-5-20250929",
      })
    : unstable_v2_createSession({
        model: "claude-sonnet-4-5-20250929",
      });

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
