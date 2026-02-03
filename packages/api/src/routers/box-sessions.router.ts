import { ORPCError } from "@orpc/server";
import { BoxId } from "@vps-claude/shared";
import { z } from "zod";

import { protectedProcedure } from "../index";
import {
  BoxSessionHistoryOutput,
  BoxSessionListOutput,
  BoxSessionSendOutput,
} from "./schemas";

export const boxSessionsRouter = {
  list: protectedProcedure
    .route({ method: "GET", path: "/box/:id/sessions" })
    .input(z.object({ id: BoxId }))
    .output(BoxSessionListOutput)
    .handler(async ({ context, input }) => {
      context.wideEvent?.set({ op: "box.sessions.list", boxId: input.id });
      const boxResult = await context.boxService.getById(input.id);
      if (boxResult.isErr()) {
        throw new ORPCError("INTERNAL_SERVER_ERROR", {
          message: boxResult.error.message,
        });
      }
      if (
        !boxResult.value ||
        boxResult.value.userId !== context.session.user.id
      ) {
        throw new ORPCError("NOT_FOUND", { message: "Box not found" });
      }
      if (
        boxResult.value.status !== "running" ||
        !boxResult.value.instanceUrl
      ) {
        throw new ORPCError("BAD_REQUEST", { message: "Box not running" });
      }

      const response = await fetch(
        `${boxResult.value.instanceUrl}/box/rpc/sessions/list`,
        {
          method: "GET",
          headers: { "Content-Type": "application/json" },
          signal: AbortSignal.timeout(30000),
        }
      );

      if (!response.ok) {
        throw new ORPCError("INTERNAL_SERVER_ERROR", {
          message: `Box agent returned ${response.status}`,
        });
      }

      const data = (await response.json()) as {
        sessions: Array<{
          contextType: string;
          contextId: string;
          sessionId: string;
          createdAt: string;
          updatedAt: string;
        }>;
      };
      return { sessions: data.sessions };
    }),

  send: protectedProcedure
    .route({ method: "POST", path: "/box/:id/sessions" })
    .input(
      z.object({
        id: BoxId,
        message: z.string().min(1),
        contextType: z.string().default("chat"),
        contextId: z.string().optional(),
      })
    )
    .output(BoxSessionSendOutput)
    .handler(async ({ context, input }) => {
      context.wideEvent?.set({
        op: "box.sessions.send",
        boxId: input.id,
        contextType: input.contextType,
      });
      const boxResult = await context.boxService.getById(input.id);
      if (boxResult.isErr()) {
        throw new ORPCError("INTERNAL_SERVER_ERROR", {
          message: boxResult.error.message,
        });
      }
      if (
        !boxResult.value ||
        boxResult.value.userId !== context.session.user.id
      ) {
        throw new ORPCError("NOT_FOUND", { message: "Box not found" });
      }
      if (
        boxResult.value.status !== "running" ||
        !boxResult.value.instanceUrl
      ) {
        throw new ORPCError("BAD_REQUEST", { message: "Box not running" });
      }

      const settingsResult = await context.emailService.getOrCreateSettings(
        input.id
      );
      if (settingsResult.isErr()) {
        throw new ORPCError("INTERNAL_SERVER_ERROR", {
          message: "Failed to get box settings",
        });
      }

      const response = await fetch(
        `${boxResult.value.instanceUrl}/box/rpc/sessions/send`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Box-Secret": settingsResult.value.agentSecret,
          },
          body: JSON.stringify({
            message: input.message,
            contextType: input.contextType,
            contextId: input.contextId,
          }),
          signal: AbortSignal.timeout(30000),
        }
      );

      if (!response.ok) {
        throw new ORPCError("INTERNAL_SERVER_ERROR", {
          message: `Box agent returned ${response.status}`,
        });
      }

      const data = (await response.json()) as {
        success: boolean;
        contextId: string;
      };
      return data;
    }),

  history: protectedProcedure
    .route({ method: "GET", path: "/box/:id/sessions/:sessionId/history" })
    .input(z.object({ id: BoxId, sessionId: z.string() }))
    .output(BoxSessionHistoryOutput)
    .handler(async ({ context, input }) => {
      const boxResult = await context.boxService.getById(input.id);
      if (boxResult.isErr()) {
        throw new ORPCError("INTERNAL_SERVER_ERROR", {
          message: boxResult.error.message,
        });
      }
      if (
        !boxResult.value ||
        boxResult.value.userId !== context.session.user.id
      ) {
        throw new ORPCError("NOT_FOUND", { message: "Box not found" });
      }
      if (
        boxResult.value.status !== "running" ||
        !boxResult.value.instanceUrl
      ) {
        throw new ORPCError("BAD_REQUEST", { message: "Box not running" });
      }

      const response = await fetch(
        `${boxResult.value.instanceUrl}/box/rpc/sessions/${input.sessionId}/history`,
        {
          method: "GET",
          headers: { "Content-Type": "application/json" },
          signal: AbortSignal.timeout(30000),
        }
      );

      if (!response.ok) {
        throw new ORPCError("INTERNAL_SERVER_ERROR", {
          message: `Box agent returned ${response.status}`,
        });
      }

      const data = (await response.json()) as {
        messages: Array<{
          type: "user" | "assistant";
          content: string;
          timestamp: string;
        }>;
      };
      return data;
    }),

  stream: protectedProcedure
    .route({ method: "POST", path: "/box/:id/sessions/stream" })
    .input(
      z.object({
        id: BoxId,
        message: z.string().min(1),
        contextType: z.string().default("chat"),
        contextId: z.string().optional(),
      })
    )
    .handler(async function* ({ context, input }) {
      context.wideEvent?.set({
        op: "box.sessions.stream",
        boxId: input.id,
        contextType: input.contextType,
      });

      const boxResult = await context.boxService.getById(input.id);
      if (boxResult.isErr()) {
        throw new ORPCError("INTERNAL_SERVER_ERROR", {
          message: boxResult.error.message,
        });
      }
      if (
        !boxResult.value ||
        boxResult.value.userId !== context.session.user.id
      ) {
        throw new ORPCError("NOT_FOUND", { message: "Box not found" });
      }
      if (
        boxResult.value.status !== "running" ||
        !boxResult.value.instanceUrl
      ) {
        throw new ORPCError("BAD_REQUEST", { message: "Box not running" });
      }

      const settingsResult = await context.emailService.getOrCreateSettings(
        input.id
      );
      if (settingsResult.isErr()) {
        throw new ORPCError("INTERNAL_SERVER_ERROR", {
          message: "Failed to get box settings",
        });
      }

      const response = await fetch(
        `${boxResult.value.instanceUrl}/box/rpc/sessions/stream`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Box-Secret": settingsResult.value.agentSecret,
          },
          body: JSON.stringify({
            message: input.message,
            contextType: input.contextType,
            contextId: input.contextId,
          }),
        }
      );

      if (!response.ok) {
        throw new ORPCError("INTERNAL_SERVER_ERROR", {
          message: `Box agent returned ${response.status}`,
        });
      }

      const reader = response.body?.getReader();
      if (!reader) {
        throw new ORPCError("INTERNAL_SERVER_ERROR", {
          message: "No response body",
        });
      }

      const decoder = new TextDecoder();
      let buffer = "";

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });

          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";

          let currentEvent = "";
          let currentData = "";

          for (const line of lines) {
            if (line.startsWith("event: ")) {
              currentEvent = line.slice(7);
            } else if (line.startsWith("data: ")) {
              currentData = line.slice(6);
            } else if (line === "" && currentData) {
              try {
                yield {
                  event: currentEvent || "message",
                  data: JSON.parse(currentData),
                };
              } catch {
                yield {
                  event: currentEvent || "message",
                  data: currentData,
                };
              }
              currentEvent = "";
              currentData = "";
            }
          }
        }
      } finally {
        reader.releaseLock();
      }
    }),
};
