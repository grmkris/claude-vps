import { and, eq } from "drizzle-orm";

import { db } from "../db";
import { sessions } from "../db/schema";

export function getSession(type: string, id: string): string | null {
  const result = db
    .select({ sessionId: sessions.sessionId })
    .from(sessions)
    .where(and(eq(sessions.contextType, type), eq(sessions.contextId, id)))
    .get();

  return result?.sessionId ?? null;
}

export function saveSession(type: string, id: string, sessionId: string): void {
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
