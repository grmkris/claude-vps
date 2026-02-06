import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";

import { env } from "../env";

const AGENT_INBOX_DIR = env.BOX_INBOX_DIR.replace("/.inbox", "/.agent-inbox");

export type InboxType = "email" | "cron" | "webhook" | "message";

export const InboxItemSchema = z.object({
  id: z.string(),
  type: z.enum(["email", "cron", "webhook", "message"]),
  status: z.enum(["pending", "delivered", "read"]),
  createdAt: z.string(),
  from: z
    .object({
      type: z.enum(["external", "box", "system"]),
      email: z.string().optional(),
      name: z.string().optional(),
      boxSubdomain: z.string().optional(),
    })
    .optional(),
  content: z.string(),
  metadata: z
    .object({
      emailMessageId: z.string().optional(),
      subject: z.string().optional(),
      htmlBody: z.string().optional(),
      inReplyTo: z.string().optional(),
      cronJobId: z.string().optional(),
      cronSchedule: z.string().optional(),
      webhookId: z.string().optional(),
      webhookPayload: z.record(z.string(), z.unknown()).optional(),
      callbackUrl: z.string().optional(),
      title: z.string().optional(),
    })
    .optional(),
});

export type InboxItem = z.infer<typeof InboxItemSchema>;

function getTypeDir(type: InboxType): string {
  return join(AGENT_INBOX_DIR, type);
}

function getFilePath(type: InboxType, id: string): string {
  return join(getTypeDir(type), `${id}.json`);
}

export async function ensureInboxDirs(): Promise<void> {
  const types: InboxType[] = ["email", "cron", "webhook", "message"];
  for (const type of types) {
    await mkdir(getTypeDir(type), { recursive: true });
  }
}

export async function writeInboxItem(item: InboxItem): Promise<string> {
  const dir = getTypeDir(item.type);
  await mkdir(dir, { recursive: true });
  const filepath = getFilePath(item.type, item.id);
  await writeFile(filepath, JSON.stringify(item, null, 2));
  return filepath;
}

export async function readInboxItem(
  type: InboxType,
  id: string
): Promise<InboxItem | null> {
  try {
    const filepath = getFilePath(type, id);
    const content = await readFile(filepath, "utf-8");
    return InboxItemSchema.parse(JSON.parse(content));
  } catch {
    return null;
  }
}

export async function listInboxItems(type: InboxType): Promise<string[]> {
  try {
    const dir = getTypeDir(type);
    const files = await readdir(dir);
    return files
      .filter((f) => f.endsWith(".json"))
      .map((f) => f.replace(".json", ""));
  } catch {
    return [];
  }
}

export async function listAllInboxItems(): Promise<
  { type: InboxType; id: string }[]
> {
  const types: InboxType[] = ["email", "cron", "webhook", "message"];
  const results: { type: InboxType; id: string }[] = [];

  for (const type of types) {
    const ids = await listInboxItems(type);
    for (const id of ids) {
      results.push({ type, id });
    }
  }

  return results;
}

export async function countUnreadByType(): Promise<Record<InboxType, number>> {
  const counts: Record<InboxType, number> = {
    email: 0,
    cron: 0,
    webhook: 0,
    message: 0,
  };

  const types: InboxType[] = ["email", "cron", "webhook", "message"];

  for (const type of types) {
    const ids = await listInboxItems(type);
    for (const id of ids) {
      const item = await readInboxItem(type, id);
      if (item && item.status !== "read") {
        counts[type]++;
      }
    }
  }

  return counts;
}

export function buildInboxPrompt(item: InboxItem, filepath: string): string {
  const lines: string[] = [];

  switch (item.type) {
    case "email": {
      const sender = item.from?.name
        ? `${item.from.name} <${item.from.email}>`
        : (item.from?.email ?? "Unknown");
      lines.push("New email received.");
      lines.push("");
      lines.push(`From: ${sender}`);
      lines.push(`Subject: ${item.metadata?.subject || "(no subject)"}`);
      lines.push(`Received: ${item.createdAt}`);
      lines.push(`File: ${filepath}`);
      lines.push("");
      lines.push("Read the email and handle it appropriately.");
      lines.push("");
      lines.push("To reply, use email_send with:");
      lines.push(`- to: "${item.from?.email}"`);
      lines.push(`- subject: "Re: ${item.metadata?.subject || ""}"`);
      lines.push("- body: your reply message");
      if (item.metadata?.emailMessageId) {
        lines.push(
          `- inReplyTo: { messageId: "${item.metadata.emailMessageId}" }`
        );
      }
      break;
    }

    case "cron": {
      lines.push("Cronjob triggered.");
      lines.push("");
      lines.push(`Job ID: ${item.metadata?.cronJobId || "unknown"}`);
      lines.push(`Schedule: ${item.metadata?.cronSchedule || "unknown"}`);
      lines.push(`Triggered: ${item.createdAt}`);
      lines.push(`File: ${filepath}`);
      lines.push("");
      lines.push("Execute the scheduled task:");
      lines.push("");
      lines.push(item.content);
      break;
    }

    case "webhook": {
      lines.push("Webhook received.");
      lines.push("");
      lines.push(`Webhook ID: ${item.metadata?.webhookId || "unknown"}`);
      lines.push(`Received: ${item.createdAt}`);
      lines.push(`File: ${filepath}`);
      if (item.metadata?.callbackUrl) {
        lines.push(`Callback URL: ${item.metadata.callbackUrl}`);
      }
      lines.push("");
      lines.push("Payload:");
      lines.push(item.content);
      break;
    }

    case "message": {
      const sender = item.from?.boxSubdomain || "Unknown box";
      lines.push("New message from another agent.");
      lines.push("");
      lines.push(`From: ${sender}`);
      if (item.metadata?.title) {
        lines.push(`Title: ${item.metadata.title}`);
      }
      lines.push(`Received: ${item.createdAt}`);
      lines.push(`File: ${filepath}`);
      lines.push("");
      lines.push("Message:");
      lines.push(item.content);
      lines.push("");
      lines.push("To reply, use send() or reply() tools.");
      break;
    }
  }

  return lines.join("\n");
}

export function formatNotificationSummary(
  counts: Record<InboxType, number>
): string {
  const lines: string[] = [];
  const total = Object.values(counts).reduce((a, b) => a + b, 0);

  if (total === 0) {
    return "";
  }

  lines.push(`You have new items in ~/.agent-inbox/:`);

  if (counts.email > 0) {
    lines.push(
      `  - ${counts.email} email${counts.email > 1 ? "s" : ""} in email/`
    );
  }
  if (counts.cron > 0) {
    lines.push(
      `  - ${counts.cron} cron trigger${counts.cron > 1 ? "s" : ""} in cron/`
    );
  }
  if (counts.webhook > 0) {
    lines.push(
      `  - ${counts.webhook} webhook${counts.webhook > 1 ? "s" : ""} in webhook/`
    );
  }
  if (counts.message > 0) {
    lines.push(
      `  - ${counts.message} message${counts.message > 1 ? "s" : ""} in message/`
    );
  }

  lines.push("");
  lines.push("Browse with: ls ~/.agent-inbox/");
  lines.push("Read with: cat ~/.agent-inbox/{type}/{id}.json");
  lines.push("Or use list() for filtered view.");

  return lines.join("\n");
}

export { AGENT_INBOX_DIR };
