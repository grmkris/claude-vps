import Redis from "ioredis";

export interface RedisConfig {
  url: string;
}

export function createRedisClient(config: RedisConfig): Redis {
  return new Redis(config.url, {
    maxRetriesPerRequest: null,
  });
}

export { Redis };
