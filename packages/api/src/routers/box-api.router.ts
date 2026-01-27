import { ORPCError } from "@orpc/server";
import { SelectBoxCronjobSchema, TriggerType } from "@vps-claude/db";
import { BoxCronjobId, CredentialService } from "@vps-claude/shared";
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

  cronjob: {
    list: boxProcedure
      .route({ method: "GET", path: "/box/cronjobs" })
      .output(z.object({ cronjobs: z.array(SelectBoxCronjobSchema) }))
      .handler(async ({ context }) => {
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

        const result = await context.cronjobService.listByBox(boxRecord.id);
        return result.match(
          (cronjobs) => ({ cronjobs }),
          (error) => {
            throw new ORPCError("INTERNAL_SERVER_ERROR", {
              message: error.message,
            });
          }
        );
      }),

    create: boxProcedure
      .route({ method: "POST", path: "/box/cronjobs" })
      .input(
        z.object({
          name: z.string().min(1).max(100),
          description: z.string().max(500).optional(),
          schedule: z.string().min(1).max(100),
          prompt: z.string().min(1).max(10000),
          timezone: z.string().max(50).optional(),
        })
      )
      .output(z.object({ cronjob: SelectBoxCronjobSchema }))
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

        const result = await context.cronjobService.create(boxRecord.id, {
          name: input.name,
          description: input.description,
          schedule: input.schedule,
          prompt: input.prompt,
          timezone: input.timezone,
        });

        return result.match(
          (cronjob) => ({ cronjob }),
          (error) => {
            if (error.type === "VALIDATION_FAILED") {
              throw new ORPCError("BAD_REQUEST", { message: error.message });
            }
            throw new ORPCError("INTERNAL_SERVER_ERROR", {
              message: error.message,
            });
          }
        );
      }),

    update: boxProcedure
      .route({ method: "PUT", path: "/box/cronjobs/{id}" })
      .input(
        z.object({
          id: BoxCronjobId,
          name: z.string().min(1).max(100).optional(),
          description: z.string().max(500).optional(),
          schedule: z.string().min(1).max(100).optional(),
          prompt: z.string().min(1).max(10000).optional(),
          timezone: z.string().max(50).optional(),
          enabled: z.boolean().optional(),
        })
      )
      .output(z.object({ cronjob: SelectBoxCronjobSchema }))
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

        // Verify cronjob belongs to this box
        const cronjobResult = await context.cronjobService.getById(input.id);
        if (cronjobResult.isErr() || !cronjobResult.value) {
          throw new ORPCError("NOT_FOUND", { message: "Cronjob not found" });
        }
        if (cronjobResult.value.boxId !== boxRecord.id) {
          throw new ORPCError("FORBIDDEN", { message: "Not authorized" });
        }

        const result = await context.cronjobService.update(input.id, {
          name: input.name,
          description: input.description,
          schedule: input.schedule,
          prompt: input.prompt,
          timezone: input.timezone,
          enabled: input.enabled,
        });

        return result.match(
          (cronjob) => ({ cronjob }),
          (error) => {
            if (error.type === "VALIDATION_FAILED") {
              throw new ORPCError("BAD_REQUEST", { message: error.message });
            }
            throw new ORPCError("INTERNAL_SERVER_ERROR", {
              message: error.message,
            });
          }
        );
      }),

    delete: boxProcedure
      .route({ method: "DELETE", path: "/box/cronjobs/{id}" })
      .input(z.object({ id: BoxCronjobId }))
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

        // Verify cronjob belongs to this box
        const cronjobResult = await context.cronjobService.getById(input.id);
        if (cronjobResult.isErr() || !cronjobResult.value) {
          throw new ORPCError("NOT_FOUND", { message: "Cronjob not found" });
        }
        if (cronjobResult.value.boxId !== boxRecord.id) {
          throw new ORPCError("FORBIDDEN", { message: "Not authorized" });
        }

        const result = await context.cronjobService.delete(input.id);
        return result.match(
          () => ({ success: true as const }),
          (error) => {
            throw new ORPCError("INTERNAL_SERVER_ERROR", {
              message: error.message,
            });
          }
        );
      }),
  },

  credential: {
    get: boxProcedure
      .route({ method: "GET", path: "/box/credential/{service}" })
      .input(z.object({ service: CredentialService }))
      .output(
        z.object({
          apiKey: z.string(),
          source: z.enum(["user", "system"]),
          metadata: z.record(z.string(), z.unknown()).nullish(),
        })
      )
      .handler(async ({ context, input }) => {
        const result = await context.credentialService.getByBoxToken(
          context.boxToken!,
          input.service
        );

        return result.match(
          (credential) => ({
            apiKey: credential.apiKey,
            source: credential.source,
            metadata: credential.metadata,
          }),
          (error) => {
            if (error.type === "BOX_NOT_FOUND") {
              throw new ORPCError("UNAUTHORIZED", {
                message: "Invalid box token",
              });
            }
            if (error.type === "NOT_FOUND") {
              throw new ORPCError("NOT_FOUND", {
                message: error.message,
              });
            }
            throw new ORPCError("INTERNAL_SERVER_ERROR", {
              message: error.message,
            });
          }
        );
      }),
  },
};
