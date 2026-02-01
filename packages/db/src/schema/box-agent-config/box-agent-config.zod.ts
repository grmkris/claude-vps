import { BoxAgentConfigId, BoxId } from "@vps-claude/shared";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { z } from "zod";

import { boxAgentConfig, triggerTypeEnum } from "./box-agent-config.db";

export const TRIGGER_TYPES = triggerTypeEnum.enumValues;
export const TriggerType = z.enum(TRIGGER_TYPES);
export type TriggerType = z.infer<typeof TriggerType>;

export const McpServerConfigStdioSchema = z.object({
  type: z.literal("stdio").optional(),
  command: z.string(),
  args: z.array(z.string()).optional(),
  env: z.record(z.string(), z.string()).optional(),
});

export const McpServerConfigSseSchema = z.object({
  type: z.literal("sse"),
  url: z.string(),
  headers: z.record(z.string(), z.string()).optional(),
});

export const McpServerConfigSchema = z.union([
  McpServerConfigStdioSchema,
  McpServerConfigSseSchema,
]);
export type McpServerConfigSchema = z.infer<typeof McpServerConfigSchema>;

export const AgentDefinitionSchema = z.object({
  name: z.string(),
  description: z.string(),
  tools: z.array(z.string()).optional(),
});
export type AgentDefinitionSchema = z.infer<typeof AgentDefinitionSchema>;

export const SelectBoxAgentConfigSchema = createSelectSchema(boxAgentConfig, {
  id: BoxAgentConfigId,
  boxId: BoxId,
  triggerType: TriggerType,
  mcpServers: z.record(z.string(), McpServerConfigSchema).nullable(),
  agents: z.record(z.string(), AgentDefinitionSchema).nullable(),
});
export type SelectBoxAgentConfigSchema = z.infer<
  typeof SelectBoxAgentConfigSchema
>;

export const InsertBoxAgentConfigSchema = createInsertSchema(boxAgentConfig, {
  boxId: BoxId,
  triggerType: TriggerType,
  mcpServers: z.record(z.string(), McpServerConfigSchema).nullable().optional(),
  agents: z.record(z.string(), AgentDefinitionSchema).nullable().optional(),
}).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertBoxAgentConfigSchema = z.infer<
  typeof InsertBoxAgentConfigSchema
>;

export const UpdateBoxAgentConfigSchema =
  InsertBoxAgentConfigSchema.partial().omit({ boxId: true });
export type UpdateBoxAgentConfigSchema = z.infer<
  typeof UpdateBoxAgentConfigSchema
>;

// Schema for API response (what box-agent receives)
export const BoxAgentConfigResponseSchema = z.object({
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
  mcpServers: z.record(z.string(), McpServerConfigSchema).nullable(),
  agents: z.record(z.string(), AgentDefinitionSchema).nullable(),
});
export type BoxAgentConfigResponseSchema = z.infer<
  typeof BoxAgentConfigResponseSchema
>;
