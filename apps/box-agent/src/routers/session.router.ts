import { z } from "zod";

import { logger } from "../logger";
import { protectedProcedure, publicProcedure } from "../procedures";
import { runWithSession } from "../utils/agent";
import { listSessions } from "../utils/sessions";

const SessionSchema = z.object({
  contextType: z.string(),
  contextId: z.string(),
  sessionId: z.string(),
  createdAt: z.date(),
  updatedAt: z.date(),
});

export const sessionRouter = {
  list: publicProcedure
    .route({ method: "GET", path: "/sessions/list" })
    .output(z.object({ sessions: z.array(SessionSchema) }))
    .handler(async () => {
      const sessions = listSessions();
      return { sessions };
    }),

  send: protectedProcedure
    .route({ method: "POST", path: "/sessions/send" })
    .input(
      z.object({
        message: z.string().min(1),
        contextType: z.string().default("chat"),
        contextId: z.string().optional(),
      })
    )
    .output(z.object({ success: z.boolean(), contextId: z.string() }))
    .handler(async ({ input }) => {
      const contextId = input.contextId ?? `chat-${Date.now()}`;

      runWithSession({
        prompt: input.message,
        contextType: input.contextType,
        contextId,
        triggerType: "manual",
      }).catch((err) => logger.error({ err }, "Session failed"));

      return { success: true, contextId };
    }),
};
