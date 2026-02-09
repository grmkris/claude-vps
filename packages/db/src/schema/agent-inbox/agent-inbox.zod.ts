import {
  AgentInboxId,
  AgentInboxNotificationId,
  BoxCronjobId,
  BoxId,
} from "@vps-claude/shared";
import { z } from "zod";

import {
  agentInboxSourceTypeEnum,
  agentInboxStatusEnum,
  agentInboxTypeEnum,
} from "./agent-inbox.db";
import { agentInboxNotificationStatusEnum } from "./agent-inbox-notification.db";

// Enums
export const AGENT_INBOX_TYPES = agentInboxTypeEnum.enumValues;
export const AgentInboxType = z.enum(AGENT_INBOX_TYPES);
export type AgentInboxType = z.infer<typeof AgentInboxType>;

export const AGENT_INBOX_STATUSES = agentInboxStatusEnum.enumValues;
export const AgentInboxStatus = z.enum(AGENT_INBOX_STATUSES);
export type AgentInboxStatus = z.infer<typeof AgentInboxStatus>;

export const AGENT_INBOX_SOURCE_TYPES = agentInboxSourceTypeEnum.enumValues;
export const AgentInboxSourceType = z.enum(AGENT_INBOX_SOURCE_TYPES);
export type AgentInboxSourceType = z.infer<typeof AgentInboxSourceType>;

export const AGENT_INBOX_NOTIFICATION_STATUSES =
  agentInboxNotificationStatusEnum.enumValues;
export const AgentInboxNotificationStatus = z.enum(
  AGENT_INBOX_NOTIFICATION_STATUSES
);
export type AgentInboxNotificationStatus = z.infer<
  typeof AgentInboxNotificationStatus
>;

// Metadata schema
export const AgentInboxMetadataSchema = z.object({
  // Email
  emailMessageId: z.string().optional(),
  from: z
    .object({ email: z.string(), name: z.string().optional() })
    .optional(),
  to: z.string().optional(),
  subject: z.string().optional(),
  htmlBody: z.string().optional(),
  inReplyTo: z.string().optional(),
  // Cron
  cronJobId: BoxCronjobId.optional(),
  cronSchedule: z.string().optional(),
  // Webhook
  webhookId: z.string().optional(),
  webhookPayload: z.record(z.string(), z.unknown()).optional(),
  callbackUrl: z.string().optional(),
  // Message
  title: z.string().optional(),
  // Override delivery behavior
  spawnSession: z.boolean().optional(),
});
export type AgentInboxMetadataSchema = z.infer<
  typeof AgentInboxMetadataSchema
>;

export const AgentInboxSourceExternalSchema = z
  .object({
    email: z.string().optional(),
    name: z.string().optional(),
    webhookUrl: z.string().optional(),
  })
  .nullable();

// Select schemas (hand-written to avoid drizzle-zod's complex generic types)
export const SelectAgentInboxSchema = z.object({
  id: AgentInboxId,
  boxId: BoxId,
  type: AgentInboxType,
  status: AgentInboxStatus,
  content: z.string(),
  parentId: AgentInboxId.nullable(),
  sourceType: AgentInboxSourceType,
  sourceBoxId: BoxId.nullable(),
  sourceExternal: AgentInboxSourceExternalSchema,
  metadata: AgentInboxMetadataSchema.nullable(),
  createdAt: z.date(),
  deliveredAt: z.date().nullable(),
  readAt: z.date().nullable(),
  updatedAt: z.date(),
});
export type SelectAgentInboxSchema = z.infer<typeof SelectAgentInboxSchema>;

export const SelectAgentInboxNotificationSchema = z.object({
  id: AgentInboxNotificationId,
  inboxId: AgentInboxId,
  targetBoxId: BoxId,
  targetSessionKey: z.string().nullable(),
  status: AgentInboxNotificationStatus,
  readAt: z.date().nullable(),
  createdAt: z.date(),
});
export type SelectAgentInboxNotificationSchema = z.infer<
  typeof SelectAgentInboxNotificationSchema
>;
