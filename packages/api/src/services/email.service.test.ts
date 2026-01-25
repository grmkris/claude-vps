import { createTestSetup, type TestSetup } from "@vps-claude/test-utils";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { box, boxEmail, boxEmailSettings } from "@vps-claude/db";
import { typeIdGenerator, type BoxId, type BoxEmailId } from "@vps-claude/shared";
import { eq } from "drizzle-orm";

import { createBoxService, type BoxService } from "./box.service";
import { createEmailService, type EmailService } from "./email.service";

describe("EmailService", () => {
  let testEnv: TestSetup;
  let emailService: EmailService;
  let boxService: BoxService;

  beforeAll(async () => {
    testEnv = await createTestSetup();
    emailService = createEmailService({
      deps: { db: testEnv.db, queueClient: testEnv.deps.queue },
    });
    boxService = createBoxService({
      deps: { db: testEnv.db, queueClient: testEnv.deps.queue },
    });
  });

  afterAll(async () => {
    await testEnv.close();
  });

  // Helper to create a running box with email settings enabled
  async function createRunningBox(name: string): Promise<{
    boxId: BoxId;
    subdomain: string;
  }> {
    const createResult = await boxService.create(
      testEnv.users.authenticated.id,
      { name }
    );
    const createdBox = createResult._unsafeUnwrap();

    // Set box to running with spriteUrl
    await boxService.updateStatus(createdBox.id, "running");
    await testEnv.db
      .update(box)
      .set({ spriteUrl: `https://${createdBox.subdomain}.sprites.dev` })
      .where(eq(box.id, createdBox.id));

    // Create email settings (enabled by default)
    await testEnv.db.insert(boxEmailSettings).values({
      boxId: createdBox.id,
      agentSecret: "test-secret-" + createdBox.id,
    });

    return { boxId: createdBox.id, subdomain: createdBox.subdomain };
  }

  // Helper to insert test email
  async function insertTestEmail(
    boxId: BoxId,
    overrides: Partial<{
      subject: string;
      status: "received" | "delivered" | "failed";
      receivedAt: Date;
    }> = {}
  ): Promise<BoxEmailId> {
    const emailId = typeIdGenerator("boxEmail");
    await testEnv.db.insert(boxEmail).values({
      id: emailId,
      boxId,
      emailMessageId: `msg-${emailId}@test.com`,
      fromEmail: "sender@test.com",
      fromName: "Test Sender",
      toEmail: "recipient@test.com",
      subject: overrides.subject ?? "Test Subject",
      textBody: "Test body content",
      status: overrides.status ?? "received",
      receivedAt: overrides.receivedAt ?? new Date(),
    });
    return emailId;
  }

  test("listByBox returns all emails for box", async () => {
    const { boxId } = await createRunningBox("list-all-test");
    await insertTestEmail(boxId, { subject: "Email 1" });
    await insertTestEmail(boxId, { subject: "Email 2" });
    await insertTestEmail(boxId, { subject: "Email 3" });

    const result = await emailService.listByBox(boxId);
    const emails = result._unsafeUnwrap();

    expect(emails.length).toBe(3);
    for (const email of emails) {
      expect(email.boxId).toBe(boxId);
    }
  });

  test("listByBox filters by status", async () => {
    const { boxId } = await createRunningBox("list-status-test");
    await insertTestEmail(boxId, { status: "received" });
    await insertTestEmail(boxId, { status: "received" });
    await insertTestEmail(boxId, { status: "delivered" });

    const result = await emailService.listByBox(boxId, { status: "received" });
    const emails = result._unsafeUnwrap();

    expect(emails.length).toBe(2);
    for (const email of emails) {
      expect(email.status).toBe("received");
    }
  });

  test("listByBox respects limit", async () => {
    const { boxId } = await createRunningBox("list-limit-test");
    await insertTestEmail(boxId, { subject: "Email 1" });
    await insertTestEmail(boxId, { subject: "Email 2" });
    await insertTestEmail(boxId, { subject: "Email 3" });

    const result = await emailService.listByBox(boxId, { limit: 2 });
    const emails = result._unsafeUnwrap();

    expect(emails.length).toBe(2);
  });

  test("listByBox returns empty for box with no emails", async () => {
    const { boxId } = await createRunningBox("list-empty-test");

    const result = await emailService.listByBox(boxId);
    const emails = result._unsafeUnwrap();

    expect(emails.length).toBe(0);
  });

  test("getById returns email", async () => {
    const { boxId } = await createRunningBox("getbyid-test");
    const emailId = await insertTestEmail(boxId, { subject: "Find Me" });

    const result = await emailService.getById(emailId);
    const email = result._unsafeUnwrap();

    expect(email).not.toBeNull();
    expect(email?.id).toBe(emailId);
    expect(email?.subject).toBe("Find Me");
  });

  test("getById returns null for non-existent", async () => {
    const fakeId = typeIdGenerator("boxEmail");

    const result = await emailService.getById(fakeId);
    const email = result._unsafeUnwrap();

    expect(email).toBeNull();
  });

  test("updateStatus changes status and sets deliveredAt", async () => {
    const { boxId } = await createRunningBox("update-status-test");
    const emailId = await insertTestEmail(boxId, { status: "received" });

    await emailService.updateStatus(emailId, "delivered");

    const result = await emailService.getById(emailId);
    const email = result._unsafeUnwrap();

    expect(email?.status).toBe("delivered");
    expect(email?.deliveredAt).not.toBeNull();
  });

  test("processInbound rejects non-running box", async () => {
    // Create box but leave it in deploying status
    const createResult = await boxService.create(
      testEnv.users.authenticated.id,
      { name: "non-running-test" }
    );
    const deployingBox = createResult._unsafeUnwrap();

    const result = await emailService.processInbound(deployingBox.subdomain, {
      messageId: "test-msg-id@example.com",
      from: { email: "sender@example.com", name: "Sender" },
      to: `${deployingBox.subdomain}@inbox.example.com`,
      subject: "Test",
      textBody: "Test body",
    });

    expect(result.isErr()).toBe(true);
    const error = result._unsafeUnwrapErr();
    expect(error.type).toBe("BOX_NOT_RUNNING");
  });
});
