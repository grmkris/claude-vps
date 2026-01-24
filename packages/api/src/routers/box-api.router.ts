import { ORPCError } from "@orpc/server";
import { TriggerType } from "@vps-claude/db";
import { z } from "zod";

import { boxProcedure } from "../index";
import { SuccessOutput } from "./schemas";

// Inline schema to avoid type explosion from nested z.record types
const AgentConfigOutput = z.object({
  model: z.string().nullable(),
  systemPrompt: z.string().nullable(),
  appendSystemPrompt: z.string().nullable(),
  tools: z.array(z.string()).nullable(),
  allowedTools: z.array(z.string()).nullable(),
  disallowedTools: z.array(z.string()).nullable(),
  permissionMode: z.string().nullable(),
  maxTurns: z.number().nullable(),
  maxBudgetUsd: z.string().nullable(),
  persistSession: z.boolean().nullable(),
  mcpServers: z.record(z.string(), z.unknown()).nullable(),
  agents: z.record(z.string(), z.unknown()).nullable(),
});

export const boxApiRouter = {
  getAgentConfig: boxProcedure
    .route({ method: "GET", path: "/box/agent-config" })
    .input(
      z.object({
        triggerType: TriggerType.optional(),
      })
    )
    .output(AgentConfigOutput)
    .handler(async ({ context, input }) => {
      const boxResult = await context.emailService.getBoxByAgentSecret(
        context.boxToken!
      );

      if (boxResult.isErr()) {
        throw new ORPCError("INTERNAL_SERVER_ERROR", {
          message: boxResult.error.message,
        });
      }

      const boxRecord = boxResult.value;
      if (!boxRecord) {
        throw new ORPCError("UNAUTHORIZED", {
          message: "Invalid box token",
        });
      }

      const configResult = await context.boxService.getAgentConfig(
        boxRecord.id,
        input.triggerType ?? "default"
      );

      if (configResult.isErr()) {
        throw new ORPCError("INTERNAL_SERVER_ERROR", {
          message: configResult.error.message,
        });
      }

      return configResult.value;
    }),

  email: {
    send: boxProcedure
      .route({ method: "POST", path: "/box/email/send" })
      .input(
        z.object({
          to: z.string(),
          subject: z.string(),
          body: z.string(),
          inReplyTo: z
            .object({
              messageId: z.string(),
              from: z.string(),
              subject: z.string(),
            })
            .optional(),
        })
      )
      .output(SuccessOutput)
      .handler(async ({ context, input }) => {
        const boxResult = await context.emailService.getBoxByAgentSecret(
          context.boxToken!
        );

        if (boxResult.isErr()) {
          throw new ORPCError("INTERNAL_SERVER_ERROR", {
            message: boxResult.error.message,
          });
        }

        const boxRecord = boxResult.value;
        if (!boxRecord) {
          throw new ORPCError("UNAUTHORIZED", {
            message: "Invalid box token",
          });
        }

        // Queue email send - await to surface queue errors
        await context.emailService.queueSendEmail(
          boxRecord.id,
          input.to,
          input.subject,
          input.body,
          input.inReplyTo
        );

        return { success: true as const };
      }),
  },
};
