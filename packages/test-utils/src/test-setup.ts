import * as schema from "@vps-claude/db";
import type { Database } from "@vps-claude/db";
import { typeIdGenerator } from "@vps-claude/shared";

import { createTestDatabase, cleanupTestDatabase } from "./pg-lite";
import type { PGlite } from "@electric-sql/pglite";

export interface TestUser {
  id: string;
  email: string;
  name: string;
}

export interface TestSetup {
  db: Database;
  pgLite: PGlite;
  users: {
    authenticated: TestUser;
  };
  cleanup: () => Promise<void>;
  close: () => Promise<void>;
}

export async function createTestSetup(): Promise<TestSetup> {
  const { db, pgLite } = await createTestDatabase();

  const userId = typeIdGenerator("user");
  const testUser: TestUser = {
    id: userId,
    email: "test@example.com",
    name: "Test User",
  };

  await db.insert(schema.user).values({
    id: testUser.id,
    email: testUser.email,
    name: testUser.name,
    emailVerified: true,
  });

  return {
    db,
    pgLite,
    users: {
      authenticated: testUser,
    },
    cleanup: async () => {
      await cleanupTestDatabase(db);
    },
    close: async () => {
      await pgLite.close();
    },
  };
}
