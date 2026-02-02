import { BoxCronjobId, BoxEmailId, BoxId, UserId } from "@vps-claude/shared";
import { z } from "zod";

export const DeployBoxJobData = z.object({
  boxId: BoxId,
  userId: UserId,
  subdomain: z.string(),
  /** Skills.sh skill IDs (e.g. "vercel-react-best-practices") */
  skills: z.array(z.string()).default([]),
  /** Deployment attempt number (for retry tracking) */
  deploymentAttempt: z.number().int().min(1).default(1),
});

export type DeployBoxJobData = z.infer<typeof DeployBoxJobData>;

export const DeleteBoxJobData = z.object({
  boxId: BoxId,
  userId: UserId,
});

export type DeleteBoxJobData = z.infer<typeof DeleteBoxJobData>;

export const DeliverEmailJobData = z.object({
  emailId: BoxEmailId,
  boxId: BoxId,
  instanceUrl: z.string(),
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
  fromEmail: z.string(),
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

export const TriggerCronjobJobData = z.object({
  cronjobId: BoxCronjobId,
  boxId: BoxId,
});

export type TriggerCronjobJobData = z.infer<typeof TriggerCronjobJobData>;
