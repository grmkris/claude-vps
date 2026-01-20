import type { Logger } from "@vps-claude/logger";
import type { Redis } from "@vps-claude/redis";

import {
  type DeliverEmailJobData,
  type SendEmailJobData,
  Worker,
  type Job,
} from "@vps-claude/queue";
import { WORKER_CONFIG } from "@vps-claude/shared";

import type { EmailService } from "../services/email.service";

interface EmailDeliveryWorkerDeps {
  emailService: EmailService;
  redis: Redis;
  logger: Logger;
}

interface EmailSendWorkerDeps {
  emailService: EmailService;
  sendEmail: (params: {
    to: string;
    subject: string;
    body: string;
    inReplyTo?: { messageId: string; from: string };
  }) => Promise<void>;
  redis: Redis;
  logger: Logger;
}

export function createEmailDeliveryWorker({
  deps,
}: {
  deps: EmailDeliveryWorkerDeps;
}) {
  const { emailService, redis, logger } = deps;

  const worker = new Worker<DeliverEmailJobData>(
    WORKER_CONFIG.deliverEmail.name,
    async (job: Job<DeliverEmailJobData>) => {
      const { emailId, spriteUrl, agentSecret, email } = job.data;

      // Sprites: box-agent accessible via sprite's public URL
      const boxAgentUrl = `${spriteUrl}/email/receive`;

      logger.info({ emailId, spriteUrl }, "Delivering email to box");

      const response = await fetch(boxAgentUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Box-Secret": agentSecret,
        },
        body: JSON.stringify(email),
        signal: AbortSignal.timeout(WORKER_CONFIG.deliverEmail.timeout),
      });

      if (!response.ok) {
        const text = await response.text();
        const message = `Box agent returned ${response.status}: ${text}`;
        const updateResult = await emailService.updateStatus(
          emailId,
          "failed",
          message
        );
        if (updateResult.isErr()) {
          logger.error({
            msg: "Failed to update email status",
            emailId,
            error: updateResult.error.message,
          });
        }
        throw new Error(message);
      }

      const updateResult = await emailService.updateStatus(
        emailId,
        "delivered"
      );
      if (updateResult.isErr()) {
        logger.error({
          msg: "Failed to update email status",
          emailId,
          error: updateResult.error.message,
        });
      }
      return { success: true };
    },
    {
      connection: redis,
      concurrency: 10,
    }
  );

  worker.on("failed", (job, err) => {
    logger.error({
      msg: "Email delivery job failed",
      jobId: job?.id,
      error: err.message,
    });
  });

  return worker;
}

export function createEmailSendWorker({ deps }: { deps: EmailSendWorkerDeps }) {
  const { sendEmail, redis, logger } = deps;

  const worker = new Worker<SendEmailJobData>(
    WORKER_CONFIG.sendEmail.name,
    async (job: Job<SendEmailJobData>) => {
      const { to, subject, body, inReplyTo } = job.data;

      logger.info({ to, subject }, "Sending email");

      await sendEmail({
        to,
        subject,
        body,
        inReplyTo: inReplyTo
          ? { messageId: inReplyTo.messageId, from: inReplyTo.from }
          : undefined,
      });

      return { success: true };
    },
    {
      connection: redis,
      concurrency: 10,
    }
  );

  worker.on("failed", (job, err) => {
    logger.error({
      msg: "Email send job failed",
      jobId: job?.id,
      error: err.message,
    });
  });

  return worker;
}
