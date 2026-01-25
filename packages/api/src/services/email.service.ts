import type { Database, SelectBoxSchema } from "@vps-claude/db";
import type { QueueClient } from "@vps-claude/queue";
import type { BoxEmailId, BoxId } from "@vps-claude/shared";

import {
  box,
  boxEmail,
  boxEmailSettings,
  type BoxEmail,
  type BoxEmailSettings,
} from "@vps-claude/db";
import { and, desc, eq } from "drizzle-orm";
import { type Result, err, ok } from "neverthrow";
import { randomBytes } from "node:crypto";

export type EmailServiceError =
  | { type: "NOT_FOUND"; message: string }
  | { type: "BOX_NOT_RUNNING"; message: string }
  | { type: "EMAIL_DISABLED"; message: string }
  | { type: "DELIVERY_FAILED"; message: string }
  | { type: "INTERNAL_ERROR"; message: string };

interface EmailServiceDeps {
  db: Database;
  queueClient: QueueClient;
}

export interface InboundEmailData {
  messageId: string;
  from: { email: string; name?: string };
  to: string;
  subject?: string;
  textBody?: string;
  htmlBody?: string;
  rawEmail?: string;
}

function generateAgentSecret(): string {
  return randomBytes(32).toString("hex");
}

export function createEmailService({ deps }: { deps: EmailServiceDeps }) {
  const { db, queueClient } = deps;

  const getSettings = async (
    boxId: BoxId
  ): Promise<Result<BoxEmailSettings | null, EmailServiceError>> => {
    const result = await db.query.boxEmailSettings.findFirst({
      where: eq(boxEmailSettings.boxId, boxId),
    });
    return ok(result ?? null);
  };

  const getOrCreateSettings = async (
    boxId: BoxId
  ): Promise<Result<BoxEmailSettings, EmailServiceError>> => {
    const existingResult = await getSettings(boxId);
    if (existingResult.isErr()) return err(existingResult.error);
    if (existingResult.value) return ok(existingResult.value);

    const result = await db
      .insert(boxEmailSettings)
      .values({
        boxId,
        agentSecret: generateAgentSecret(),
      })
      .returning();

    const created = result[0];

    if (!created) {
      return err({
        type: "INTERNAL_ERROR",
        message: "Failed to create email settings",
      });
    }

    return ok(created);
  };

  const queueSendEmail = async (
    boxId: BoxId,
    to: string,
    subject: string,
    body: string,
    inReplyTo?: { messageId: string; from: string; subject: string }
  ): Promise<Result<void, EmailServiceError>> => {
    await queueClient.sendEmailQueue.add("send", {
      boxId,
      to,
      subject,
      body,
      inReplyTo,
    });
    return ok(undefined);
  };

  const storeInbound = async (
    boxId: BoxId,
    email: InboundEmailData
  ): Promise<Result<BoxEmail, EmailServiceError>> => {
    const result = await db
      .insert(boxEmail)
      .values({
        boxId,
        emailMessageId: email.messageId,
        fromEmail: email.from.email,
        fromName: email.from.name,
        toEmail: email.to,
        subject: email.subject,
        textBody: email.textBody,
        htmlBody: email.htmlBody,
        rawEmail: email.rawEmail,
        status: "received",
      })
      .returning();

    return ok(result[0]!);
  };

  const queueDelivery = async (
    emailRecord: BoxEmail,
    spriteUrl: string,
    agentSecret: string
  ): Promise<Result<void, EmailServiceError>> => {
    await queueClient.deliverEmailQueue.add("deliver", {
      emailId: emailRecord.id,
      boxId: emailRecord.boxId,
      spriteUrl,
      agentSecret,
      email: {
        id: emailRecord.id,
        messageId: emailRecord.emailMessageId,
        from: {
          email: emailRecord.fromEmail,
          name: emailRecord.fromName ?? undefined,
        },
        to: emailRecord.toEmail,
        subject: emailRecord.subject ?? undefined,
        body: {
          text: emailRecord.textBody ?? undefined,
          html: emailRecord.htmlBody ?? undefined,
        },
        receivedAt: emailRecord.receivedAt.toISOString(),
      },
    });
    return ok(undefined);
  };

  return {
    getSettings,
    getOrCreateSettings,
    queueSendEmail,
    async getBoxByAgentSecret(
      agentSecret: string
    ): Promise<Result<SelectBoxSchema | null, EmailServiceError>> {
      const settings = await db.query.boxEmailSettings.findFirst({
        where: eq(boxEmailSettings.agentSecret, agentSecret),
      });

      if (!settings?.boxId) return ok(null);

      const boxResult = await db.query.box.findFirst({
        where: eq(box.id, settings.boxId),
      });

      return ok(boxResult ?? null);
    },

    async updateSettings(
      boxId: BoxId,
      updates: { enabled?: boolean }
    ): Promise<Result<BoxEmailSettings, EmailServiceError>> {
      const settingsResult = await getSettings(boxId);
      if (settingsResult.isErr()) return err(settingsResult.error);
      if (!settingsResult.value) {
        return err({ type: "NOT_FOUND", message: "Email settings not found" });
      }

      const result = await db
        .update(boxEmailSettings)
        .set(updates)
        .where(eq(boxEmailSettings.boxId, boxId))
        .returning();

      return ok(result[0]!);
    },
    async listByBox(
      boxId: BoxId,
      options?: { status?: BoxEmail["status"]; limit?: number }
    ): Promise<Result<BoxEmail[], EmailServiceError>> {
      const whereConditions = options?.status
        ? and(eq(boxEmail.boxId, boxId), eq(boxEmail.status, options.status))
        : eq(boxEmail.boxId, boxId);

      const emails = await db.query.boxEmail.findMany({
        where: whereConditions,
        orderBy: desc(boxEmail.receivedAt),
        limit: options?.limit ?? 50,
      });
      return ok(emails);
    },

    async getById(
      emailId: BoxEmailId
    ): Promise<Result<BoxEmail | null, EmailServiceError>> {
      const result = await db.query.boxEmail.findFirst({
        where: eq(boxEmail.id, emailId),
      });
      return ok(result ?? null);
    },

    async updateStatus(
      emailId: BoxEmailId,
      status: BoxEmail["status"],
      errorMessage?: string
    ): Promise<Result<void, EmailServiceError>> {
      const updates: Partial<BoxEmail> = { status };
      if (status === "delivered") {
        updates.deliveredAt = new Date();
      }
      if (errorMessage) {
        updates.errorMessage = errorMessage;
      }
      await db.update(boxEmail).set(updates).where(eq(boxEmail.id, emailId));
      return ok(undefined);
    },

    async processInbound(
      subdomain: string,
      email: InboundEmailData
    ): Promise<Result<BoxEmail, EmailServiceError>> {
      const boxResult = await db.query.box.findFirst({
        where: eq(box.subdomain, subdomain),
      });
      if (!boxResult)
        return err({ type: "NOT_FOUND", message: "Box not found" });

      if (boxResult.status !== "running") {
        return err({ type: "BOX_NOT_RUNNING", message: "Box is not running" });
      }

      if (!boxResult.spriteUrl) {
        return err({
          type: "BOX_NOT_RUNNING",
          message: "Box not ready (no sprite URL)",
        });
      }

      const settingsResult = await getOrCreateSettings(boxResult.id);
      if (settingsResult.isErr()) return err(settingsResult.error);

      const settings = settingsResult.value;
      if (!settings.enabled) {
        return err({
          type: "EMAIL_DISABLED",
          message: "Email is disabled for this box",
        });
      }

      const emailResult = await storeInbound(boxResult.id, email);
      if (emailResult.isErr()) return emailResult;

      const queueResult = await queueDelivery(
        emailResult.value,
        boxResult.spriteUrl,
        settings.agentSecret
      );
      if (queueResult.isErr()) return err(queueResult.error);

      return emailResult;
    },
  };
}
export type EmailService = ReturnType<typeof createEmailService>;
