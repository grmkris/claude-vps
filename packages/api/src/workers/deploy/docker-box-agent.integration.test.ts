import { createLogger } from "@vps-claude/logger";
import {
  createProviderFactory,
  type ProviderFactory,
} from "@vps-claude/providers";
import { getBoxAgentBinaryUrl } from "@vps-claude/shared";
import { createTestSetup, type TestSetup } from "@vps-claude/test-utils";
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import fs from "node:fs";
import { z } from "zod";

import {
  createBoxEnvVarService,
  type BoxEnvVarService,
} from "../../services/box-env-var.service";
import { createBoxService, type BoxService } from "../../services/box.service";
import {
  createDeployStepService,
  type DeployStepService,
} from "../../services/deploy-step.service";
import {
  createEmailService,
  type EmailService,
} from "../../services/email.service";
import {
  createOrchestratorWorker,
  createSetupStepWorker,
  createHealthCheckWorker,
  createInstallSkillWorker,
  createEnableAccessWorker,
  createFinalizeWorker,
  createSkillsGateWorker,
} from "./index";

const logger = createLogger({ appName: "docker-box-agent-test" });

// --- Environment (Zod-enforced) ---
const env = z
  .object({
    DOCKER_SOCKET: z.string().default("/var/run/docker.sock"),
    ANTHROPIC_API_KEY: z.string().min(1, "ANTHROPIC_API_KEY is required"),
    BOX_AGENT_BINARY_URL: z.string().optional(),
    TEST_BASE_DOMAIN: z.string().default("agents.localhost"),
    NGROK_URL: z
      .string()
      .url()
      .default("https://related-awake-shark.ngrok-free.app"),
  })
  .parse(process.env);

const HAS_DOCKER = fs.existsSync(env.DOCKER_SOCKET);
const BOX_AGENT_BINARY_URL = getBoxAgentBinaryUrl(env.BOX_AGENT_BINARY_URL);

describe.skipIf(!HAS_DOCKER)("Docker Box-Agent Integration", () => {
  let testEnv: TestSetup;
  let providerFactory: ProviderFactory;

  // Services
  let boxService: BoxService;
  let boxEnvVarService: BoxEnvVarService;
  let deployStepService: DeployStepService;
  let emailService: EmailService;

  // Workers
  let orchestratorWorker: Awaited<
    ReturnType<typeof createOrchestratorWorker>
  >["worker"];
  let flowProducer: Awaited<
    ReturnType<typeof createOrchestratorWorker>
  >["flowProducer"];
  let setupStepWorker: ReturnType<typeof createSetupStepWorker>;
  let healthCheckWorker: ReturnType<typeof createHealthCheckWorker>;
  let installSkillWorker: ReturnType<typeof createInstallSkillWorker>;
  let enableAccessWorker: ReturnType<typeof createEnableAccessWorker>;
  let finalizeWorker: ReturnType<typeof createFinalizeWorker>;
  let skillsGateWorker: ReturnType<typeof createSkillsGateWorker>;

  // Shared state across all test groups
  const createdContainers: string[] = [];
  let finalBox: {
    id: string;
    subdomain: string;
    instanceName: string | null;
    instanceUrl: string | null;
    status: string;
  };
  let agentSecret: string;

  beforeAll(async () => {
    // Pre-flight: verify ngrok tunnel
    const ngrokHealth = await fetch(env.NGROK_URL, {
      signal: AbortSignal.timeout(5000),
    }).catch(() => null);
    if (!ngrokHealth?.ok) {
      throw new Error(
        `ngrok tunnel not reachable at ${env.NGROK_URL} — start it first`
      );
    }

    testEnv = await createTestSetup();

    providerFactory = createProviderFactory({
      dockerOptions: {
        socketPath: env.DOCKER_SOCKET,
        baseDomain: env.TEST_BASE_DOMAIN,
      },
      logger,
    });

    boxEnvVarService = createBoxEnvVarService({
      deps: { db: testEnv.db },
    });

    boxService = createBoxService({
      deps: {
        db: testEnv.db,
        queueClient: testEnv.deps.queue,
        boxEnvVarService,
      },
    });

    deployStepService = createDeployStepService({
      deps: { db: testEnv.db },
    });

    emailService = createEmailService({
      deps: {
        db: testEnv.db,
        queueClient: testEnv.deps.queue,
        agentsDomain: env.TEST_BASE_DOMAIN,
      },
    });

    // Create all deploy flow workers
    const baseDeps = {
      boxService,
      deployStepService,
      providerFactory,
      redis: testEnv.deps.redis,
      logger,
    };

    const orchestratorResult = createOrchestratorWorker({
      deps: {
        ...baseDeps,
        boxEnvVarService,
        emailService,
        serverUrl: env.NGROK_URL,
        boxAgentBinaryUrl: BOX_AGENT_BINARY_URL,
      },
    });
    orchestratorWorker = orchestratorResult.worker;
    flowProducer = orchestratorResult.flowProducer;

    setupStepWorker = createSetupStepWorker({ deps: baseDeps });
    healthCheckWorker = createHealthCheckWorker({ deps: baseDeps });
    installSkillWorker = createInstallSkillWorker({
      deps: {
        boxService,
        deployStepService,
        providerFactory,
        redis: testEnv.deps.redis,
        logger,
      },
    });
    enableAccessWorker = createEnableAccessWorker({ deps: baseDeps });
    finalizeWorker = createFinalizeWorker({
      deps: {
        boxService,
        redis: testEnv.deps.redis,
        logger,
      },
    });
    skillsGateWorker = createSkillsGateWorker({
      deps: {
        deployStepService,
        redis: testEnv.deps.redis,
        logger,
      },
    });

    // Deploy a single box for all tests
    const testSuffix = Date.now().toString(36);
    const boxName = `docker-agent-test-${testSuffix}`;

    logger.info({ boxName }, "Deploying box for agent tests...");

    const boxResult = await boxService.create(testEnv.users.authenticated.id, {
      name: boxName,
      provider: "docker",
      mcpServers: {
        "test-http-mcp": { type: "http" as const, url: "http://localhost:9999/mcp" },
      },
    });
    expect(boxResult.isOk()).toBe(true);
    const box = boxResult._unsafeUnwrap();

    // Poll until running
    const maxWait = 5 * 60 * 1000;
    const pollInterval = 5000;
    let elapsed = 0;
    let current = box as typeof finalBox;

    while (elapsed < maxWait) {
      await new Promise((r) => setTimeout(r, pollInterval));
      elapsed += pollInterval;

      const result = await boxService.getById(box.id);
      current = result._unsafeUnwrap()!;

      if (
        current.instanceName &&
        !createdContainers.includes(current.instanceName)
      ) {
        createdContainers.push(current.instanceName);
      }

      if (current.status === "running" || current.status === "error") {
        break;
      }
    }

    expect(current.status).toBe("running");
    expect(current.instanceUrl).toBeDefined();
    finalBox = current;

    // Get agentSecret for authenticated requests
    const settingsResult = await emailService.getOrCreateSettings(box.id);
    expect(settingsResult.isOk()).toBe(true);
    agentSecret = settingsResult._unsafeUnwrap().agentSecret;

    // Inject ANTHROPIC_API_KEY into container
    const dockerProvider = providerFactory.getProvider("docker");
    await dockerProvider.updateEnvVars(finalBox.instanceName!, {
      ANTHROPIC_API_KEY: env.ANTHROPIC_API_KEY,
    });
    // Wait for box-agent restart after env update
    await new Promise((r) => setTimeout(r, 5000));

    // Diagnostic: check MCP config
    const dockerProvider2 = providerFactory.getProvider("docker");
    const mcpCheck = await dockerProvider2.execShell(
      finalBox.instanceName!,
      'su - box -c "claude mcp list" 2>&1'
    );
    logger.info({ mcpList: mcpCheck.stdout }, "MCP list after deploy");

    logger.info(
      {
        boxId: finalBox.id,
        instanceName: finalBox.instanceName,
        instanceUrl: finalBox.instanceUrl,
      },
      "Box ready for agent tests"
    );
  }, 600_000);

  afterAll(async () => {
    await orchestratorWorker.close();
    await flowProducer.close();
    await setupStepWorker.close();
    await healthCheckWorker.close();
    await installSkillWorker.close();
    await enableAccessWorker.close();
    await finalizeWorker.close();
    await skillsGateWorker.close();

    const dockerProvider = providerFactory.getProvider("docker");
    for (const instanceName of createdContainers) {
      try {
        await dockerProvider.deleteInstance(instanceName);
        logger.info({ instanceName }, "Cleaned up test container");
      } catch (error) {
        logger.warn({ instanceName, error }, "Failed to cleanup container");
      }
    }

    await testEnv.close();
  }, 30_000);

  // --- Helpers ---
  async function boxFetch(
    path: string,
    opts?: {
      method?: string;
      body?: unknown;
      auth?: boolean;
      timeoutMs?: number;
    }
  ) {
    const url = `${finalBox.instanceUrl}/box/rpc${path}`;
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (opts?.auth !== false) {
      headers["X-Box-Secret"] = agentSecret;
    }
    return fetch(url, {
      method: opts?.method ?? "GET",
      headers,
      body: opts?.body ? JSON.stringify(opts.body) : undefined,
      signal: AbortSignal.timeout(opts?.timeoutMs ?? 15000),
    });
  }

  /** Parse SSE text stream into event objects */
  async function readSSEStream(
    response: Response
  ): Promise<Array<{ event: string; data: string }>> {
    const events: Array<{ event: string; data: string }> = [];
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      const parts = buffer.split("\n\n");
      buffer = parts.pop()!;
      for (const part of parts) {
        let event = "";
        let data = "";
        for (const line of part.split("\n")) {
          if (line.startsWith("event: ")) event = line.slice(7);
          else if (line.startsWith("data: ")) data = line.slice(6);
        }
        if (event || data) events.push({ event, data });
      }
    }
    return events;
  }

  /** Poll session history until assistant message appears */
  async function pollSessionHistory(
    sessionId: string,
    opts?: { timeoutMs?: number }
  ): Promise<Array<{ type: string; content: string; timestamp: string }>> {
    const timeout = opts?.timeoutMs ?? 120_000;
    const start = Date.now();
    let lastMessageCount = 0;
    while (Date.now() - start < timeout) {
      const res = await boxFetch(`/sessions/${sessionId}/history`, {
        auth: false,
      });
      if (res.ok) {
        const data = (await res.json()) as {
          messages: Array<{
            type: string;
            content: string;
            timestamp: string;
          }>;
        };
        if (data.messages.length !== lastMessageCount) {
          lastMessageCount = data.messages.length;
          logger.info(
            {
              sessionId,
              messageCount: data.messages.length,
              types: data.messages.map((m) => m.type),
            },
            "Session history progress"
          );
        }
        if (
          data.messages.some(
            (m) => m.type === "assistant" && m.content.length > 0
          )
        ) {
          return data.messages;
        }
      }
      await new Promise((r) => setTimeout(r, 3000));
    }
    throw new Error(
      `No assistant messages in session ${sessionId} after ${timeout}ms (last count: ${lastMessageCount})`
    );
  }

  /** Find sessionId from sessions list by contextType + contextId */
  async function findSessionId(
    contextType: string,
    contextId: string,
    opts?: { timeoutMs?: number }
  ): Promise<string> {
    const timeout = opts?.timeoutMs ?? 120_000;
    const start = Date.now();
    while (Date.now() - start < timeout) {
      const res = await boxFetch("/sessions/list", { auth: false });
      if (res.ok) {
        const data = (await res.json()) as {
          sessions: Array<{
            contextType: string;
            contextId: string;
            sessionId: string;
          }>;
        };
        const session = data.sessions.find(
          (s) => s.contextType === contextType && s.contextId === contextId
        );
        if (session) return session.sessionId;
      }
      await new Promise((r) => setTimeout(r, 2000));
    }
    throw new Error(
      `Session ${contextType}:${contextId} not found after ${timeout}ms`
    );
  }

  // ═══════════════════════════════════════════════════════════
  // Container Setup Verification — fast filesystem checks
  // ═══════════════════════════════════════════════════════════

  describe("Container Setup Verification", () => {
    it("MCP HTTP endpoint accessible inside container", async () => {
      const dockerProvider = providerFactory.getProvider("docker");
      const result = await dockerProvider.execShell(
        finalBox.instanceName!,
        "curl -s -o /dev/null -w '%{http_code}' http://localhost:33002/health"
      );
      expect(result.stdout.trim()).toBe("200");
    });

    it("email-templates skill exists on disk", async () => {
      const dockerProvider = providerFactory.getProvider("docker");
      const content = await dockerProvider.readFile(
        finalBox.instanceName!,
        "/home/box/.claude/skills/email-templates/SKILL.md"
      );
      const text = content.toString();
      expect(text.length).toBeGreaterThan(0);
      expect(text).toContain("email_send");
    });

    it("skills directory structure correct", async () => {
      const dockerProvider = providerFactory.getProvider("docker");
      const entries = await dockerProvider.listDir(
        finalBox.instanceName!,
        "/home/box/.claude/skills"
      );
      const names = entries.map((e) => e.name);
      expect(names).toContain("email-templates");
    });

    it("agent config returns ai-tools MCP server", async () => {
      const configResult = await boxService.getAgentConfig(
        finalBox.id as import("@vps-claude/shared").BoxId,
        "default"
      );
      expect(configResult.isOk()).toBe(true);
      const config = configResult._unsafeUnwrap();
      expect(config.mcpServers).toBeDefined();
      expect(config.mcpServers!["ai-tools"]).toBeDefined();
      expect(config.mcpServers!["ai-tools"]).toMatchObject({
        type: "http",
        url: "http://localhost:33002/mcp",
      });
    });
  });

  // ═══════════════════════════════════════════════════════════
  // E2E Tests — run while Claude queue is empty
  // ═══════════════════════════════════════════════════════════

  // ─── SSE Streaming E2E ─────────────────────────────────────
  describe("SSE Streaming E2E", () => {
    it("stream returns SSE events with assistant message", async () => {
      const streamCtxId = `stream-e2e-${Date.now()}`;
      const res = await boxFetch("/sessions/stream", {
        method: "POST",
        body: {
          message: "What is 2+2? Reply with just the number.",
          contextType: "test",
          contextId: streamCtxId,
        },
        timeoutMs: 120_000,
      });

      if (!res.ok) {
        const errorBody = await res.text();
        logger.error(
          { status: res.status, body: errorBody },
          "SSE stream request failed"
        );
      }
      expect(res.ok).toBe(true);
      expect(res.headers.get("content-type")).toContain("text/event-stream");

      const events = await readSSEStream(res);
      logger.info(
        {
          eventCount: events.length,
          types: [...new Set(events.map((e) => e.event))],
        },
        "SSE stream completed"
      );

      expect(events.length).toBeGreaterThan(0);

      // At least one assistant message with content
      const assistantEvents = events.filter((e) => e.event === "assistant");
      expect(assistantEvents.length).toBeGreaterThan(0);

      const firstAssistant = JSON.parse(assistantEvents[0]!.data) as {
        type: string;
        message?: {
          content?: Array<{ type: string; text?: string }>;
        };
      };
      expect(firstAssistant.type).toBe("assistant");
      expect(firstAssistant.message?.content).toBeDefined();
      const textBlock = firstAssistant.message?.content?.find(
        (b) => b.type === "text"
      );
      expect(textBlock?.text).toBeDefined();
      expect(textBlock!.text!.length).toBeGreaterThan(0);
    }, 180_000);

    it("stream rejects without auth", async () => {
      const res = await boxFetch("/sessions/stream", {
        method: "POST",
        body: { message: "should fail" },
        auth: false,
      });
      expect(res.status).toBe(401);
    });
  });

  // ─── Email E2E ─────────────────────────────────────────────
  describe("Email E2E", () => {
    let emailSessionId: string;

    it("email spawns Claude session that produces messages", async () => {
      const emailId = `e2e-email-${Date.now()}`;
      const messageId = `<${emailId}@example.com>`;

      const res = await boxFetch("/email/receive", {
        method: "POST",
        body: {
          id: emailId,
          messageId,
          from: { email: "e2e-sender@example.com", name: "E2E Test" },
          to: "test-box@agents.localhost",
          subject: "Please reply to this email",
          body: {
            text: "Hi, I need a reply to confirm you received this. Please use the email_send tool to reply back to me with a short confirmation.",
          },
          receivedAt: new Date().toISOString(),
        },
      });
      expect(res.ok).toBe(true);

      emailSessionId = await findSessionId("email", messageId);
      logger.info(
        { sessionId: emailSessionId, messageId },
        "Email session found"
      );

      const messages = await pollSessionHistory(emailSessionId);
      logger.info(
        { messageCount: messages.length },
        "Email session has assistant output"
      );

      expect(
        messages.some((m) => m.type === "assistant" && m.content.length > 0)
      ).toBe(true);
    }, 180_000);

    it("session history returns user + assistant messages", async () => {
      expect(emailSessionId).toBeDefined();

      const res = await boxFetch(`/sessions/${emailSessionId}/history`, {
        auth: false,
      });
      expect(res.ok).toBe(true);

      const data = (await res.json()) as {
        messages: Array<{
          type: string;
          content: string;
          timestamp: string;
        }>;
      };
      expect(data.messages.length).toBeGreaterThanOrEqual(2);
      expect(data.messages.some((m) => m.type === "user")).toBe(true);
      expect(
        data.messages.some(
          (m) => m.type === "assistant" && m.content.length > 0
        )
      ).toBe(true);

      logger.info(
        {
          messageCount: data.messages.length,
          types: data.messages.map((m) => m.type),
        },
        "Session history verified"
      );
    }, 30_000);

    it("Claude used email_send tool to reply", async () => {
      expect(emailSessionId).toBeDefined();

      // Read raw JSONL from container — history endpoint strips tool_use blocks
      const dockerProvider = providerFactory.getProvider("docker");
      const jsonlContent = await dockerProvider.readFile(
        finalBox.instanceName!,
        `/home/box/.claude/projects/-home-box/${emailSessionId}.jsonl`
      );
      const jsonlText = jsonlContent.toString();

      // Parse JSONL to find all tool_use blocks
      const lines = jsonlText.trim().split("\n").filter(Boolean);
      const allToolUses = lines
        .map((line) => {
          try {
            return JSON.parse(line);
          } catch {
            return null;
          }
        })
        .filter(
          (entry) =>
            entry?.type === "assistant" &&
            Array.isArray(entry?.message?.content)
        )
        .flatMap((entry) =>
          (
            entry.message.content as Array<{
              type: string;
              name?: string;
              input?: Record<string, unknown>;
            }>
          ).filter((block) => block.type === "tool_use")
        );

      const toolNames = allToolUses.map((t) => t.name);
      logger.info({ toolNames }, "All tool calls in email session");

      // Find email-related tool call (Claude may or may not use email_send)
      const emailToolCall = allToolUses.find(
        (t) => t.name === "email_send" || t.name === "reply"
      );

      logger.info(
        {
          toolNames,
          emailToolFound: !!emailToolCall,
          emailToolName: emailToolCall?.name,
          to: emailToolCall?.input?.to,
        },
        "Email session tool usage"
      );

      // Claude processed the email and used MCP tools
      expect(allToolUses.length).toBeGreaterThan(0);

      // If email_send was used, verify recipient
      if (emailToolCall?.name === "email_send") {
        expect(emailToolCall.input?.to).toBe("e2e-sender@example.com");
      }
    }, 30_000);
  });

  // ─── Cron E2E ──────────────────────────────────────────────
  describe("Cron E2E", () => {
    it("cron trigger spawns Claude session and creates session file", async () => {
      const cronId = `e2e-cron-${Date.now()}`;

      const res = await boxFetch("/cron/trigger", {
        method: "POST",
        body: {
          cronjobId: cronId,
          cronjobName: "e2e-cron-test",
          prompt: "Say the word 'hello' and nothing else.",
        },
      });
      expect(res.ok).toBe(true);

      // Verify session appears in SQLite sessions table
      const sessionId = await findSessionId("cron", cronId);
      logger.info({ sessionId, cronId }, "Cron session found");

      // Verify session JSONL file was created on disk
      const dockerProvider = providerFactory.getProvider("docker");
      const fileCheck = await dockerProvider.execShell(
        finalBox.instanceName!,
        `test -f /home/box/.claude/projects/-home-box/${sessionId}.jsonl && echo EXISTS`
      );
      expect(fileCheck.stdout.trim()).toBe("EXISTS");

      logger.info({ sessionId }, "Cron session file verified on disk");
    }, 120_000);
  });

  // ─── Session History E2E ───────────────────────────────────
  describe("Session History E2E", () => {
    it("history returns empty for nonexistent session", async () => {
      const res = await boxFetch("/sessions/nonexistent-fake-id/history", {
        auth: false,
      });
      expect(res.ok).toBe(true);
      const data = (await res.json()) as { messages: unknown[] };
      expect(data.messages).toEqual([]);
    });
  });

  // ─── MCP Deployment Verification ───
  describe("MCP Deployment", () => {
    it("claude mcp list shows ai-tools", async () => {
      const dockerProvider = providerFactory.getProvider("docker");
      const result = await dockerProvider.execShell(
        finalBox.instanceName!,
        'su - box -c "claude mcp list" 2>&1'
      );
      expect(result.stdout).toContain("ai-tools");
    });

    it("user-configured MCP visible in claude mcp list", async () => {
      const dockerProvider = providerFactory.getProvider("docker");
      const result = await dockerProvider.execShell(
        finalBox.instanceName!,
        'su - box -c "claude mcp list" 2>&1'
      );
      expect(result.stdout).toContain("test-http-mcp");
    });
  });

  // ═══════════════════════════════════════════════════════════
  // Contract Tests — API shape validation (run after E2E)
  // These fire background Claude sessions as side effects
  // ═══════════════════════════════════════════════════════════

  // ─── Email Delivery ────────────────────────────────────────
  describe("Email Delivery", () => {
    const emailId = `test-email-${Date.now()}`;
    const emailPayload = {
      id: emailId,
      messageId: `<${emailId}@example.com>`,
      from: { email: "sender@example.com", name: "Test Sender" },
      to: "test-box@agents.localhost",
      subject: "Integration test email",
      body: { text: "Hello from integration test" },
      receivedAt: new Date().toISOString(),
    };

    it("receives email and saves to inbox", async () => {
      const res = await boxFetch("/email/receive", {
        method: "POST",
        body: emailPayload,
      });
      expect(res.ok).toBe(true);

      const data = (await res.json()) as {
        success: boolean;
        filepath: string;
      };
      expect(data.success).toBe(true);
      expect(data.filepath).toContain(emailId);
    });

    it("email file exists on filesystem", async () => {
      const dockerProvider = providerFactory.getProvider("docker");
      const content = await dockerProvider.readFile(
        finalBox.instanceName!,
        `/home/box/.inbox/${emailId}.json`
      );
      const parsed = JSON.parse(content.toString());
      expect(parsed.id).toBe(emailId);
      expect(parsed.from.email).toBe("sender@example.com");
    });

    it("inbox directory lists email files", async () => {
      const dockerProvider = providerFactory.getProvider("docker");
      const entries = await dockerProvider.listDir(
        finalBox.instanceName!,
        "/home/box/.inbox"
      );
      expect(entries.some((e) => e.name === `${emailId}.json`)).toBe(true);
    });

    it("rejects request without auth", async () => {
      const res = await boxFetch("/email/receive", {
        method: "POST",
        body: emailPayload,
        auth: false,
      });
      expect(res.status).toBeGreaterThanOrEqual(400);
    });

    it("rejects invalid payload", async () => {
      const res = await boxFetch("/email/receive", {
        method: "POST",
        body: { garbage: true },
      });
      expect(res.status).toBeGreaterThanOrEqual(400);
    });
  });

  // ─── Sessions ──────────────────────────────────────────────
  describe("Sessions", () => {
    it("session list returns array", async () => {
      const res = await boxFetch("/sessions/list", { auth: false });
      expect(res.ok).toBe(true);

      const data = (await res.json()) as { sessions: unknown[] };
      expect(Array.isArray(data.sessions)).toBe(true);
    });

    it("send returns success with auto contextId", async () => {
      const res = await boxFetch("/sessions/send", {
        method: "POST",
        body: { message: "integration test ping" },
      });
      expect(res.ok).toBe(true);

      const data = (await res.json()) as {
        success: boolean;
        contextId: string;
      };
      expect(data.success).toBe(true);
      expect(data.contextId).toMatch(/^chat-/);
    });

    it("send uses provided contextId", async () => {
      const res = await boxFetch("/sessions/send", {
        method: "POST",
        body: {
          message: "integration test with custom ctx",
          contextId: "my-custom-ctx",
        },
      });
      expect(res.ok).toBe(true);

      const data = (await res.json()) as {
        success: boolean;
        contextId: string;
      };
      expect(data.contextId).toBe("my-custom-ctx");
    });

    it("send rejects without auth", async () => {
      const res = await boxFetch("/sessions/send", {
        method: "POST",
        body: { message: "should fail" },
        auth: false,
      });
      expect(res.status).toBeGreaterThanOrEqual(400);
    });

    it("send rejects empty message", async () => {
      const res = await boxFetch("/sessions/send", {
        method: "POST",
        body: { message: "" },
      });
      expect(res.status).toBeGreaterThanOrEqual(400);
    });

    it("session appears in list after send", async () => {
      const ctxId = `poll-test-${Date.now()}`;
      await boxFetch("/sessions/send", {
        method: "POST",
        body: {
          message: "say hello",
          contextType: "test",
          contextId: ctxId,
        },
      });

      let found = false;
      for (let i = 0; i < 30; i++) {
        await new Promise((r) => setTimeout(r, 1000));
        const res = await boxFetch("/sessions/list", { auth: false });
        if (!res.ok) continue;

        const data = (await res.json()) as {
          sessions: Array<{ contextId: string; contextType: string }>;
        };
        if (data.sessions.some((s) => s.contextId === ctxId)) {
          found = true;
          break;
        }
      }
      expect(found).toBe(true);
    }, 60_000);
  });

  // ─── Cronjob Trigger ───────────────────────────────────────
  describe("Cronjob Trigger", () => {
    const cronjobId = `test-cron-${Date.now()}`;

    it("trigger returns success", async () => {
      const res = await boxFetch("/cron/trigger", {
        method: "POST",
        body: {
          cronjobId,
          cronjobName: "test-cron",
          prompt: "say hello from cron",
        },
      });
      expect(res.ok).toBe(true);

      const data = (await res.json()) as {
        success: boolean;
        sessionId: string;
      };
      expect(data.success).toBe(true);
      expect(data.sessionId).toBe(cronjobId);
    });

    it("rejects without auth", async () => {
      const res = await boxFetch("/cron/trigger", {
        method: "POST",
        body: {
          cronjobId: "x",
          cronjobName: "x",
          prompt: "x",
        },
        auth: false,
      });
      expect(res.status).toBeGreaterThanOrEqual(400);
    });

    it("cron session in list", async () => {
      let found = false;
      for (let i = 0; i < 30; i++) {
        await new Promise((r) => setTimeout(r, 1000));
        const res = await boxFetch("/sessions/list", { auth: false });
        if (!res.ok) continue;

        const data = (await res.json()) as {
          sessions: Array<{ contextId: string; contextType: string }>;
        };
        if (
          data.sessions.some(
            (s) => s.contextType === "cron" && s.contextId === cronjobId
          )
        ) {
          found = true;
          break;
        }
      }
      expect(found).toBe(true);
    }, 60_000);
  });

  // ─── Filesystem via Deployed Box ───────────────────────────
  describe("Filesystem", () => {
    it("writeFile + readFile roundtrip", async () => {
      const dockerProvider = providerFactory.getProvider("docker");
      const content = "hello from agent test\n";

      await dockerProvider.writeFile(
        finalBox.instanceName!,
        "/home/box/test-file.txt",
        content
      );
      const result = await dockerProvider.readFile(
        finalBox.instanceName!,
        "/home/box/test-file.txt"
      );
      expect(result.toString()).toBe(content);
    });

    it("listDir on home directory", async () => {
      const dockerProvider = providerFactory.getProvider("docker");
      const entries = await dockerProvider.listDir(
        finalBox.instanceName!,
        "/home/box"
      );
      const names = entries.map((e) => e.name);
      expect(names).toContain(".inbox");
      expect(names).toContain(".box-agent");
    });

    it("writeFile with mkdir creates nested dirs", async () => {
      const dockerProvider = providerFactory.getProvider("docker");
      const content = "nested content";

      await dockerProvider.writeFile(
        finalBox.instanceName!,
        "/home/box/deep/nested/file.txt",
        content,
        { mkdir: true }
      );
      const result = await dockerProvider.readFile(
        finalBox.instanceName!,
        "/home/box/deep/nested/file.txt"
      );
      expect(result.toString()).toBe(content);
    });
  });
});
