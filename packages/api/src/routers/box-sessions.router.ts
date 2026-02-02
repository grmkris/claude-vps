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
      if (boxResult.value.status !== "running" || !boxResult.value.spriteUrl) {
        throw new ORPCError("BAD_REQUEST", { message: "Box not running" });
      }

      const response = await fetch(
        `${boxResult.value.spriteUrl}/rpc/sessions/list`,
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
      if (boxResult.value.status !== "running" || !boxResult.value.spriteUrl) {
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
        `${boxResult.value.spriteUrl}/rpc/sessions/send`,
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
      if (boxResult.value.status !== "running" || !boxResult.value.spriteUrl) {
        throw new ORPCError("BAD_REQUEST", { message: "Box not running" });
      }

      const response = await fetch(
        `${boxResult.value.spriteUrl}/rpc/sessions/${input.sessionId}/history`,
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
};
