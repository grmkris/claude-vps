import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { and, desc, eq } from "drizzle-orm";

import { sessions, type Session } from "../db/schema";
import { createBoxAgentTestDb, type BoxAgentTestDb } from "../test-utils";

// Test implementations that accept db instance (mirrors production functions)
function getSession(
  db: BoxAgentTestDb["db"],
  type: string,
  id: string
): string | null {
  const result = db
    .select({ sessionId: sessions.sessionId })
    .from(sessions)
    .where(and(eq(sessions.contextType, type), eq(sessions.contextId, id)))
    .get();

  return result?.sessionId ?? null;
}

function saveSession(
  db: BoxAgentTestDb["db"],
  type: string,
  id: string,
  sessionId: string
): void {
  db.insert(sessions)
    .values({
      contextType: type,
      contextId: id,
      sessionId,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [sessions.contextType, sessions.contextId],
      set: {
        sessionId,
        updatedAt: new Date(),
      },
    })
    .run();
}

function listSessions(db: BoxAgentTestDb["db"]): Session[] {
  return db.select().from(sessions).orderBy(desc(sessions.updatedAt)).all();
}

describe("sessions utility", () => {
  let testDb: BoxAgentTestDb;

  beforeEach(() => {
    testDb = createBoxAgentTestDb();
  });

  afterEach(() => {
    testDb.close();
  });

  describe("saveSession", () => {
    test("creates new session", () => {
      saveSession(testDb.db, "email", "email-123", "session-abc");

      const result = getSession(testDb.db, "email", "email-123");
      expect(result).toBe("session-abc");
    });

    test("upserts existing session", () => {
      // Create initial session
      saveSession(testDb.db, "chat", "chat-1", "old-session");
      expect(getSession(testDb.db, "chat", "chat-1")).toBe("old-session");

      // Update with new sessionId
      saveSession(testDb.db, "chat", "chat-1", "new-session");
      expect(getSession(testDb.db, "chat", "chat-1")).toBe("new-session");

      // Should still be only one session
      const allSessions = listSessions(testDb.db);
      const chatSessions = allSessions.filter((s) => s.contextId === "chat-1");
      expect(chatSessions.length).toBe(1);
    });

    test("handles different context types with same id", () => {
      saveSession(testDb.db, "email", "id-1", "email-session");
      saveSession(testDb.db, "chat", "id-1", "chat-session");

      expect(getSession(testDb.db, "email", "id-1")).toBe("email-session");
      expect(getSession(testDb.db, "chat", "id-1")).toBe("chat-session");
    });
  });

  describe("getSession", () => {
    test("returns null for non-existent session", () => {
      const result = getSession(testDb.db, "email", "nonexistent");
      expect(result).toBeNull();
    });

    test("returns sessionId for existing session", () => {
      saveSession(testDb.db, "cron", "daily-job", "cron-session-123");

      const result = getSession(testDb.db, "cron", "daily-job");
      expect(result).toBe("cron-session-123");
    });

    test("returns null for wrong context type", () => {
      saveSession(testDb.db, "email", "msg-1", "some-session");

      const result = getSession(testDb.db, "chat", "msg-1");
      expect(result).toBeNull();
    });
  });

  describe("listSessions", () => {
    test("returns empty array when no sessions", () => {
      const result = listSessions(testDb.db);
      expect(result).toEqual([]);
    });

    test("returns all sessions", () => {
      saveSession(testDb.db, "email", "email-1", "session-1");
      saveSession(testDb.db, "chat", "chat-1", "session-2");
      saveSession(testDb.db, "webhook", "hook-1", "session-3");

      const result = listSessions(testDb.db);
      expect(result.length).toBe(3);
    });

    test("orders by updatedAt descending", () => {
      // Insert directly with explicit timestamps to avoid timing issues
      const now = Date.now();
      testDb.db
        .insert(sessions)
        .values({
          contextType: "email",
          contextId: "first",
          sessionId: "session-first",
          createdAt: new Date(now - 2000),
          updatedAt: new Date(now - 2000),
        })
        .run();

      testDb.db
        .insert(sessions)
        .values({
          contextType: "email",
          contextId: "second",
          sessionId: "session-second",
          createdAt: new Date(now - 1000),
          updatedAt: new Date(now - 1000),
        })
        .run();

      testDb.db
        .insert(sessions)
        .values({
          contextType: "email",
          contextId: "third",
          sessionId: "session-third",
          createdAt: new Date(now),
          updatedAt: new Date(now),
        })
        .run();

      const result = listSessions(testDb.db);
      expect(result.length).toBe(3);

      // Most recently updated should be first
      expect(result[0]!.contextId).toBe("third");
      expect(result[2]!.contextId).toBe("first");
    });

    test("contains expected fields", () => {
      saveSession(testDb.db, "email", "test-id", "test-session");

      const result = listSessions(testDb.db);
      expect(result.length).toBe(1);

      const session = result[0]!;
      expect(session.contextType).toBe("email");
      expect(session.contextId).toBe("test-id");
      expect(session.sessionId).toBe("test-session");
      expect(session.createdAt).toBeInstanceOf(Date);
      expect(session.updatedAt).toBeInstanceOf(Date);
    });
  });
});
