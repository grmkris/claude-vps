import { ORPCError } from "@orpc/server";
import {
  McpServerConfigSchema,
  SelectBoxAgentConfigSchema,
} from "@vps-claude/db";
import { BoxId } from "@vps-claude/shared";
import { z } from "zod";

import { protectedProcedure } from "../index";

// Output schema for get (raw config, not merged with defaults)
const AgentConfigOutput = z.object({
  config: SelectBoxAgentConfigSchema,
});

const SuccessOutput = z.object({
  success: z.literal(true),
});

// Update input - all fields optional except boxId
const UpdateInput = z.object({
  boxId: BoxId,
  model: z.string().optional(),
  systemPrompt: z.string().nullable().optional(),
  appendSystemPrompt: z.string().nullable().optional(),
  tools: z.array(z.string()).nullable().optional(),
  allowedTools: z.array(z.string()).nullable().optional(),
  disallowedTools: z.array(z.string()).nullable().optional(),
  permissionMode: z.string().nullable().optional(),
  maxTurns: z.number().nullable().optional(),
  maxBudgetUsd: z.string().nullable().optional(),
  persistSession: z.boolean().nullable().optional(),
  mcpServers: z.record(z.string(), McpServerConfigSchema).nullable().optional(),
});

export const boxAgentConfigRouter = {
  get: protectedProcedure
    .input(z.object({ boxId: BoxId }))
    .output(AgentConfigOutput)
    .handler(async ({ context, input }) => {
      // Verify user owns the box
      const boxResult = await context.boxService.getById(input.boxId);
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

      // Get all configs for this box
      const configsResult = await context.boxService.listAgentConfigs(
        input.boxId
      );
      if (configsResult.isErr()) {
        throw new ORPCError("INTERNAL_SERVER_ERROR", {
          message: configsResult.error.message,
        });
      }

      // Find the default config
      const defaultConfig = configsResult.value.find(
        (c) => c.triggerType === "default"
      );

      if (!defaultConfig) {
        throw new ORPCError("NOT_FOUND", {
          message: "Default config not found",
        });
      }

      return { config: defaultConfig };
    }),

  update: protectedProcedure
    .input(UpdateInput)
    .output(SuccessOutput)
    .handler(async ({ context, input }) => {
      // Verify user owns the box
      const boxResult = await context.boxService.getById(input.boxId);
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

      // Get all configs for this box
      const configsResult = await context.boxService.listAgentConfigs(
        input.boxId
      );
      if (configsResult.isErr()) {
        throw new ORPCError("INTERNAL_SERVER_ERROR", {
          message: configsResult.error.message,
        });
      }

      // Find the default config
      const defaultConfig = configsResult.value.find(
        (c) => c.triggerType === "default"
      );

      if (!defaultConfig) {
        throw new ORPCError("NOT_FOUND", {
          message: "Default config not found",
        });
      }

      // Update the config (omit boxId from update payload)
      const { boxId: _, ...updateFields } = input;
      const updateResult = await context.boxService.updateAgentConfig(
        defaultConfig.id,
        updateFields
      );

      if (updateResult.isErr()) {
        throw new ORPCError("INTERNAL_SERVER_ERROR", {
          message: updateResult.error.message,
        });
      }

      return { success: true as const };
    }),
};
