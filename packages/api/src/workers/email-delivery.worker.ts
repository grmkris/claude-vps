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
  dockerNetwork?: string;
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
  const { emailService, redis, logger, dockerNetwork } = deps;

  const worker = new Worker<DeliverEmailJobData>(
    WORKER_CONFIG.deliverEmail.name,
    async (job: Job<DeliverEmailJobData>) => {
      const { emailId, containerName, agentSecret, email } = job.data;

      const boxAgentUrl = dockerNetwork
        ? `http://${containerName}:9999/email/receive`
        : `http://localhost:9999/email/receive`;

      logger.info({ emailId, containerName }, "Delivering email to box");

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
        await emailService.updateStatus(emailId, "failed", message);
        throw new Error(message);
      }

      await emailService.updateStatus(emailId, "delivered");
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
