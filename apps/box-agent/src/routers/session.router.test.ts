import { OpenAPIHandler } from "@orpc/openapi/fetch";
import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { and, desc, eq } from "drizzle-orm";

import type { BoxAgentContext } from "../procedures";

import { sessions, type Session } from "../db/schema";
import { createBoxAgentTestDb, type BoxAgentTestDb } from "../test-utils";

const TEST_SECRET = "test-secret-key-that-is-at-least-32-characters";

// Mock env module
void mock.module("../env", () => ({
  env: {
    BOX_AGENT_SECRET: TEST_SECRET,
    BOX_API_URL: "http://localhost:33000/box",
    BOX_API_TOKEN: "test-token",
    BOX_SUBDOMAIN: "test-box",
    BOX_AGENT_PORT: 33002,
    BOX_INBOX_DIR: "/tmp/test-inbox",
    BOX_DB_PATH: ":memory:",
  },
}));

// Test database instance
let testDb: BoxAgentTestDb;

// Mock sessions module to use test db
void mock.module("../utils/sessions", () => ({
  getSession: (type: string, id: string): string | null => {
    const result = testDb.db
      .select({ sessionId: sessions.sessionId })
      .from(sessions)
      .where(and(eq(sessions.contextType, type), eq(sessions.contextId, id)))
      .get();
    return result?.sessionId ?? null;
  },
  saveSession: (type: string, id: string, sessionId: string): void => {
    testDb.db
      .insert(sessions)
      .values({
        contextType: type,
        contextId: id,
        sessionId,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [sessions.contextType, sessions.contextId],
        set: { sessionId, updatedAt: new Date() },
      })
      .run();
  },
  listSessions: (): Session[] => {
    return testDb.db
      .select()
      .from(sessions)
      .orderBy(desc(sessions.updatedAt))
      .all();
  },
}));

// Mock agent module to avoid actual Claude SDK calls
void mock.module("../utils/agent", () => ({
  runWithSession: mock(() => Promise.resolve({ result: "test response" })),
}));

// Import router after mocks are set up
const { sessionRouter } = await import("./session.router");

describe("session router", () => {
  let handler: OpenAPIHandler<BoxAgentContext>;

  beforeEach(() => {
    testDb = createBoxAgentTestDb();
    handler = new OpenAPIHandler(sessionRouter, {});
  });

  afterEach(() => {
    testDb.close();
  });

  async function makeRequest(
    path: string,
    options: RequestInit & { headers?: Record<string, string> } = {}
  ): Promise<Response> {
    const request = new Request(`http://localhost:33002${path}`, options);
    const result = await handler.handle(request, {
      prefix: "/",
      context: {
        boxSecretHeader: options.headers?.["X-Box-Secret"],
        wideEvent: undefined,
      },
    });
    if (!result.matched) throw new Error("Route not matched");
    return result.response;
  }

  describe("GET /sessions/list", () => {
    test("returns empty array initially", async () => {
      const response = await makeRequest("/sessions/list");
      expect(response.status).toBe(200);

      const data = (await response.json()) as { sessions: Session[] };
      expect(data.sessions).toEqual([]);
    });

    test("returns sessions after creation", async () => {
      // Insert test sessions directly
      testDb.db
        .insert(sessions)
        .values({
          contextType: "email",
          contextId: "test-email-1",
          sessionId: "session-123",
          createdAt: new Date(),
          updatedAt: new Date(),
        })
        .run();

      testDb.db
        .insert(sessions)
        .values({
          contextType: "chat",
          contextId: "test-chat-1",
          sessionId: "session-456",
          createdAt: new Date(),
          updatedAt: new Date(),
        })
        .run();

      const response = await makeRequest("/sessions/list");
      expect(response.status).toBe(200);

      const data = (await response.json()) as { sessions: Session[] };
      expect(data.sessions.length).toBe(2);
      expect(data.sessions[0]).toHaveProperty("contextType");
      expect(data.sessions[0]).toHaveProperty("contextId");
      expect(data.sessions[0]).toHaveProperty("sessionId");
    });

    test("does not require auth", async () => {
      // No X-Box-Secret header
      const response = await makeRequest("/sessions/list");
      expect(response.status).toBe(200);
    });
  });

  describe("POST /sessions/send", () => {
    test("requires auth header", async () => {
      const response = await makeRequest("/sessions/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: "test message" }),
      });

      expect(response.status).toBe(401);
    });

    test("rejects invalid auth", async () => {
      const response = await makeRequest("/sessions/send", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Box-Secret": "wrong-secret",
        },
        body: JSON.stringify({ message: "test message" }),
      });

      expect(response.status).toBe(401);
    });

    test("accepts valid auth and returns contextId", async () => {
      const response = await makeRequest("/sessions/send", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Box-Secret": TEST_SECRET,
        },
        body: JSON.stringify({ message: "Hello" }),
      });

      expect(response.status).toBe(200);

      const data = (await response.json()) as {
        success: boolean;
        contextId: string;
      };
      expect(data.success).toBe(true);
      expect(data.contextId).toBeDefined();
      expect(data.contextId).toMatch(/^chat-\d+$/);
    });

    test("uses provided contextId", async () => {
      const response = await makeRequest("/sessions/send", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Box-Secret": TEST_SECRET,
        },
        body: JSON.stringify({
          message: "Test",
          contextId: "custom-context-123",
        }),
      });

      expect(response.status).toBe(200);

      const data = (await response.json()) as {
        success: boolean;
        contextId: string;
      };
      expect(data.contextId).toBe("custom-context-123");
    });

    test("uses custom contextType", async () => {
      const response = await makeRequest("/sessions/send", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Box-Secret": TEST_SECRET,
        },
        body: JSON.stringify({
          message: "Test",
          contextType: "email",
          contextId: "email-thread-1",
        }),
      });

      expect(response.status).toBe(200);

      const data = (await response.json()) as {
        success: boolean;
        contextId: string;
      };
      expect(data.success).toBe(true);
    });

    test("rejects empty message", async () => {
      const response = await makeRequest("/sessions/send", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Box-Secret": TEST_SECRET,
        },
        body: JSON.stringify({ message: "" }),
      });

      // Should fail validation (min length 1)
      expect(response.status).toBe(400);
    });
  });
});
