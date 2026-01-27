import { box as boxTable, boxEmailSettings } from "@vps-claude/db";
import { createLogger } from "@vps-claude/logger";
import { createTestSetup, type TestSetup } from "@vps-claude/test-utils";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";

import { createApi } from "../create-api";
import { createBoxService, type BoxService } from "../services/box.service";
import { createDeployStepService } from "../services/deploy-step.service";
import {
  createEmailService,
  type EmailService,
} from "../services/email.service";

const logger = createLogger({ appName: "inbound-email-test" });
const AGENTS_DOMAIN = "yoda.fun";

describe("inbound-email webhook", () => {
  let testEnv: TestSetup;
  let boxService: BoxService;
  let emailService: EmailService;
  let app: ReturnType<typeof createApi>["app"];

  beforeAll(async () => {
    testEnv = await createTestSetup();
    boxService = createBoxService({
      deps: { db: testEnv.db, queueClient: testEnv.deps.queue },
    });
    emailService = createEmailService({
      deps: { db: testEnv.db, queueClient: testEnv.deps.queue },
    });
    const deployStepService = createDeployStepService({
      deps: { db: testEnv.db },
    });

    const { app: honoApp } = createApi({
      db: testEnv.db,
      logger,
      services: {
        boxService,
        cronjobService: {} as never,
        deployStepService,
        emailService,
        secretService: {} as never,
        apiKeyService: {} as never,
        aiService: {} as never,
        spritesClient: {} as never,
      },
      auth: {} as never,
      corsOrigin: "*",
      agentsDomain: AGENTS_DOMAIN,
    });
    app = honoApp;
  });

  afterAll(async () => {
    await testEnv.close();
  });

  async function createRunningBox(
    name: string
  ): Promise<{ boxId: string; subdomain: string }> {
    const createResult = await boxService.create(
      testEnv.users.authenticated.id,
      { name }
    );
    const createdBox = createResult._unsafeUnwrap();

    await boxService.updateStatus(createdBox.id, "running");
    await testEnv.db
      .update(boxTable)
      .set({ spriteUrl: `https://${createdBox.subdomain}.sprites.dev` })
      .where(eq(boxTable.id, createdBox.id));

    await testEnv.db.insert(boxEmailSettings).values({
      boxId: createdBox.id,
      agentSecret: "test-secret-" + createdBox.id,
    });

    return { boxId: createdBox.id, subdomain: createdBox.subdomain };
  }

  test("accepts email format: subdomain@agentsDomain", async () => {
    const { boxId, subdomain } = await createRunningBox("webhook-format-test");
    const toAddress = `${subdomain}@${AGENTS_DOMAIN}`;

    const response = await app.request("/webhooks/inbound-email", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        messageId: "test-message-id-1@example.com",
        from: {
          addresses: [{ address: "sender@example.com", name: "Sender" }],
        },
        to: { addresses: [{ address: toAddress }] },
        recipient: toAddress,
        subject: "Test Email",
        text: "Test body",
      }),
    });

    const json = await response.json();
    expect(response.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.emailId).toBeDefined();

    // Verify email stored in database
    const emails = await emailService.listByBox(boxId as never);
    const list = emails._unsafeUnwrap();
    expect(list.length).toBeGreaterThan(0);
    expect(list.some((e) => e.subject === "Test Email")).toBe(true);
  });

  test("rejects unknown recipient", async () => {
    const response = await app.request("/webhooks/inbound-email", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        messageId: "unknown-test@example.com",
        from: { addresses: [{ email: "sender@example.com" }] },
        recipient: "nonexistent@wrong-domain.com",
        subject: "Should Fail",
        text: "Body",
      }),
    });

    const json = await response.json();
    expect(response.status).toBe(200);
    expect(json.message).toBe("Unknown recipient");
  });

  test("rejects old subdomain format: *@subdomain.agentsDomain", async () => {
    const response = await app.request("/webhooks/inbound-email", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        messageId: "old-format-test@example.com",
        from: { addresses: [{ email: "sender@example.com" }] },
        recipient: `anything@some-box.${AGENTS_DOMAIN}`,
        subject: "Old Format",
        text: "Body",
      }),
    });

    const json = await response.json();
    expect(response.status).toBe(200);
    expect(json.message).toBe("Unknown recipient");
  });

  test("handles Resend inbound.new format with to.addresses", async () => {
    const { subdomain } = await createRunningBox("resend-format-test");
    const toAddress = `${subdomain}@${AGENTS_DOMAIN}`;

    const response = await app.request("/webhooks/inbound-email", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: {
          messageId: "resend-msg-id@example.com",
          from: {
            addresses: [{ name: "John Doe", address: "john@example.com" }],
          },
          to: { addresses: [{ address: toAddress }] },
          recipient: toAddress,
          subject: "Resend Format Test",
          parsedData: { textBody: "Hello from Resend" },
        },
      }),
    });

    const json = await response.json();
    expect(response.status).toBe(200);
    expect(json.success).toBe(true);
  });
});
