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
import { OpenAPILink } from "@orpc/openapi-client/fetch";
import { boxAiRouter, boxApiRouter } from "@vps-claude/api/routers/index";

import { env } from "./env";

// Combined router defined locally to avoid TS7056 type explosion
const combinedBoxRouter = {
  ...boxApiRouter,
  ai: boxAiRouter,
};

// Base URL without /box suffix - routes include /box in path
const baseUrl = env.BOX_API_URL.replace(/\/box$/, "");

const link = new OpenAPILink(combinedBoxRouter, {
  url: baseUrl,
  headers: () => ({
    "X-Box-Secret": env.BOX_API_TOKEN,
  }),
});

export const boxApi: BoxApiClient = createORPCClient(link);
