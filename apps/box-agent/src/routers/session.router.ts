import { eq } from "drizzle-orm";
import { homedir } from "node:os";
import { z } from "zod";

import { db } from "../db";
import { executionState } from "../db/schema";
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

const MessageSchema = z.object({
  type: z.enum(["user", "assistant"]),
  content: z.string(),
  timestamp: z.string(),
});

export const sessionRouter = {
  list: publicProcedure
    .route({ method: "GET", path: "/sessions/list" })
    .output(z.object({ sessions: z.array(SessionSchema) }))
    .handler(async ({ context }) => {
      context.wideEvent?.set({ op: "session.list" });
      const sessions = listSessions();
      return { sessions };
    }),

  history: publicProcedure
    .route({ method: "GET", path: "/sessions/{sessionId}/history" })
    .input(z.object({ sessionId: z.string() }))
    .output(z.object({ messages: z.array(MessageSchema) }))
    .handler(async ({ input }) => {
      const home = homedir();
      // Claude stores sessions in ~/.claude/projects/-{path} where path has / replaced with -
      // e.g., /home/box -> -home-box, /home/sprite -> -home-sprite
      const homeSuffix = home.replace(/\//g, "-");
      const projectDir = `${home}/.claude/projects/${homeSuffix}`;
      const filePath = `${projectDir}/${input.sessionId}.jsonl`;

      const file = Bun.file(filePath);
      if (!(await file.exists())) {
        logger.debug({ filePath }, "Session file not found");
        return { messages: [] };
      }

      const content = await file.text();
      const lines = content.trim().split("\n").filter(Boolean);

      const messages = lines
        .map((line) => {
          try {
            return JSON.parse(line);
          } catch {
            return null;
          }
        })
        .filter(
          (entry): entry is Record<string, unknown> =>
            entry !== null &&
            (entry.type === "user" || entry.type === "assistant")
        )
        .map((entry) => {
          const message = entry.message as
            | { content?: Array<{ type: string; text?: string }> }
            | undefined;
          const textContent = message?.content?.find((c) => c.type === "text");
          return {
            type: entry.type as "user" | "assistant",
            content: textContent?.text ?? "",
            timestamp: (entry.timestamp as string) ?? "",
          };
        });

      return { messages };
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
    .handler(async ({ context, input }) => {
      const contextId = input.contextId ?? `chat-${Date.now()}`;
      context.wideEvent?.set({
        op: "session.send",
        contextType: input.contextType,
        contextId,
      });

      runWithSession({
        prompt: input.message,
        contextType: input.contextType,
        contextId,
        triggerType: "manual",
      }).catch((err) => logger.error({ err }, "Session failed"));

      return { success: true, contextId };
    }),

  executionStatus: publicProcedure
    .route({ method: "GET", path: "/sessions/execution-status" })
    .output(
      z.object({
        isExecuting: z.boolean(),
        activeSessions: z.array(
          z.object({
            sessionId: z.string().nullable(),
            startedAt: z.number(),
            lastActivityAt: z.number(),
            messageCount: z.number(),
          })
        ),
      })
    )
    .handler(async ({ context }) => {
      context.wideEvent?.set({ op: "session.executionStatus" });

      const running = db
        .select()
        .from(executionState)
        .where(eq(executionState.status, "running"))
        .all();

      return {
        isExecuting: running.length > 0,
        activeSessions: running.map((s) => ({
          sessionId: s.sessionId,
          startedAt: s.startedAt,
          lastActivityAt: s.lastActivityAt,
          messageCount: s.messageCount,
        })),
      };
    }),
};
