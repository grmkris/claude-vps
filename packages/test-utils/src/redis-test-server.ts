import { RedisMemoryServer } from "redis-memory-server";

/**
 * Test Redis setup return type
 */
export interface RedisTestSetup {
  server: RedisMemoryServer;
  host: string;
  port: number;
  url: string;
  shutdown: () => Promise<void>;
}

/**
 * Creates an in-memory Redis server for testing
 * Uses atomic .create() to prevent race conditions when tests run in parallel
 */
export async function createTestRedisSetup(): Promise<RedisTestSetup> {
  const redisServer = await RedisMemoryServer.create();

  const host = await redisServer.getHost();
  const port = await redisServer.getPort();

  const shutdown = async () => {
    await redisServer.stop();
  };

  return {
    server: redisServer,
    host,
    port,
    url: `redis://${host}:${port}`,
    shutdown,
  };
}
