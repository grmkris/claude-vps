import { mkdir, readdir, readFile, rename, writeFile } from "node:fs/promises";
import { z } from "zod";

import { env } from "../env";

export const InboundEmailSchema = z.object({
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
});

export type InboundEmail = z.infer<typeof InboundEmailSchema>;

export async function writeEmailToInbox(email: InboundEmail): Promise<string> {
  const filepath = `${env.BOX_INBOX_DIR}/${email.id}.json`;
  await mkdir(env.BOX_INBOX_DIR, { recursive: true });
  await writeFile(filepath, JSON.stringify(email, null, 2));
  return filepath;
}

export async function listEmails(): Promise<string[]> {
  try {
    const files = await readdir(env.BOX_INBOX_DIR);
    return files.filter((f) => f.endsWith(".json"));
  } catch {
    return [];
  }
}

export async function readEmail(id: string): Promise<InboundEmail | null> {
  try {
    const content = await readFile(`${env.BOX_INBOX_DIR}/${id}.json`, "utf-8");
    return JSON.parse(content);
  } catch {
    return null;
  }
}

export async function archiveEmail(id: string): Promise<boolean> {
  const archiveDir = `${env.BOX_INBOX_DIR}/.archive`;
  try {
    await mkdir(archiveDir, { recursive: true });
    await rename(`${env.BOX_INBOX_DIR}/${id}.json`, `${archiveDir}/${id}.json`);
    return true;
  } catch {
    return false;
  }
}

export function buildEmailPrompt(
  email: InboundEmail,
  filepath: string
): string {
  const sender = email.from.name
    ? `${email.from.name} <${email.from.email}>`
    : email.from.email;

  return `New email received.

From: ${sender}
Subject: ${email.subject || "(no subject)"}
Received: ${email.receivedAt}
File: ${filepath}

Read the email and handle it appropriately.

To reply: POST http://localhost:${env.BOX_AGENT_PORT}/rpc/email/send
{"to": "${email.from.email}", "subject": "Re: ${email.subject || ""}", "body": "..."}`;
}
