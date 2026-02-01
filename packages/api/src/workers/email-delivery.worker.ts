import type { Redis } from "@vps-claude/redis";

import { createWideEvent, type Logger } from "@vps-claude/logger";
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
    from: string;
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
      const event = createWideEvent(logger, {
        worker: "EMAIL_DELIVERY",
        jobId: job.id,
        emailId,
        spriteUrl,
      });

      try {
        // Sprites: box-agent accessible via sprite's public URL
        const boxAgentUrl = `${spriteUrl}/rpc/email/receive`;

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
          await emailService.updateStatus(emailId, "failed", message);
          throw new Error(message);
        }

        await emailService.updateStatus(emailId, "delivered");
        event.set({ status: "delivered" });
        return { success: true };
      } catch (err) {
        event.error(err instanceof Error ? err : new Error(String(err)), {
          status: "failed",
        });
        throw err;
      } finally {
        event.emit();
      }
    },
    {
      connection: redis,
      concurrency: 10,
    }
  );

  return worker;
}

export function createEmailSendWorker({ deps }: { deps: EmailSendWorkerDeps }) {
  const { sendEmail, redis, logger } = deps;

  const worker = new Worker<SendEmailJobData>(
    WORKER_CONFIG.sendEmail.name,
    async (job: Job<SendEmailJobData>) => {
      const { fromEmail, to, subject, body, inReplyTo } = job.data;
      const event = createWideEvent(logger, {
        worker: "EMAIL_SEND",
        jobId: job.id,
        to,
        subject,
      });

      try {
        await sendEmail({
          from: fromEmail,
          to,
          subject,
          body,
          inReplyTo: inReplyTo
            ? { messageId: inReplyTo.messageId, from: inReplyTo.from }
            : undefined,
        });

        event.set({ status: "sent" });
        return { success: true };
      } catch (err) {
        event.error(err instanceof Error ? err : new Error(String(err)), {
          status: "failed",
        });
        throw err;
      } finally {
        event.emit();
      }
    },
    {
      connection: redis,
      concurrency: 10,
    }
  );

  return worker;
}
