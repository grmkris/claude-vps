import type { PGlite } from "@electric-sql/pglite";
import type { Database } from "@vps-claude/db";

import * as schema from "@vps-claude/db";
import { createQueueClient, type QueueClient } from "@vps-claude/queue";
import { type UserId, typeIdGenerator } from "@vps-claude/shared";
import { Redis } from "ioredis";

import { createTestDatabase, cleanupTestDatabase } from "./pg-lite";
import { createTestRedisSetup, type RedisTestSetup } from "./redis-test-server";

export interface TestUser {
  id: UserId;
  email: string;
  name: string;
}

export interface TestSetup {
  db: Database;
  pgLite: PGlite;
  deps: {
    queue: QueueClient;
    redis: Redis;
    redisSetup: RedisTestSetup;
  };
  users: {
    authenticated: TestUser;
  };
  cleanup: () => Promise<void>;
  close: () => Promise<void>;
}

export async function createTestSetup(): Promise<TestSetup> {
  const { db, pgLite } = await createTestDatabase();

  // Real in-memory Redis + real queue
  const redisSetup = await createTestRedisSetup();
  const redis = new Redis(redisSetup.url, { maxRetriesPerRequest: null });
  const queueClient = createQueueClient({ redis });

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
    deps: {
      queue: queueClient,
      redis,
      redisSetup,
    },
    users: {
      authenticated: testUser,
    },
    cleanup: async () => {
      await cleanupTestDatabase(db);
    },
    close: async () => {
      await queueClient.close();
      redis.disconnect();
      await redisSetup.shutdown();
      await pgLite.close();
    },
  };
}
