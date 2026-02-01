/**
 * ORPC client for box API (main server /box/* endpoints)
 *
 * Used by MCP tools to call:
 * - email.send - send email via Resend
 * - cronjob.* - manage scheduled tasks
 * - ai.* - generate images, TTS, STT
 */

import type { BoxApiClient } from "@vps-claude/api/routers/index";

import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";

import { env } from "./env";

// Base URL without /box suffix - routes include /box in path
const baseUrl = env.BOX_API_URL.replace(/\/box$/, "");

const link = new RPCLink({
  url: baseUrl,
  headers: () => ({
    "X-Box-Secret": env.BOX_API_TOKEN,
  }),
});

export const boxApi: BoxApiClient = createORPCClient(link);
