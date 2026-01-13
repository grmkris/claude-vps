import { BoxEmailId, BoxId, SkillId, UserId } from "@vps-claude/shared";
import { z } from "zod";

export const DeployBoxJobData = z.object({
  boxId: BoxId,
  userId: UserId,
  subdomain: z.string(),
  password: z.string(),
  skills: z.array(SkillId).default([]),
});

export type DeployBoxJobData = z.infer<typeof DeployBoxJobData>;

export const DeleteBoxJobData = z.object({
  boxId: BoxId,
  userId: UserId,
  dockerContainerId: z.string(),
});

export type DeleteBoxJobData = z.infer<typeof DeleteBoxJobData>;

export const DeliverEmailJobData = z.object({
  emailId: BoxEmailId,
  boxId: BoxId,
  containerName: z.string(),
  agentSecret: z.string(),
  email: z.object({
    id: z.string(),
    messageId: z.string(),
    from: z.object({
      email: z.string(),
      name: z.string().optional(),
    }),
    to: z.string(),
    subject: z.string().optional(),
    body: z.object({
      text: z.string().optional(),
      html: z.string().optional(),
    }),
    receivedAt: z.string(),
  }),
});

export type DeliverEmailJobData = z.infer<typeof DeliverEmailJobData>;

export const SendEmailJobData = z.object({
  boxId: BoxId,
  to: z.string().email(),
  subject: z.string(),
  body: z.string(),
  inReplyTo: z
    .object({
      messageId: z.string(),
      from: z.string(),
      subject: z.string(),
    })
    .optional(),
});

export type SendEmailJobData = z.infer<typeof SendEmailJobData>;
