import type { createClient, RedisClientOptions } from "redis";

type RedisClientType = ReturnType<typeof createClient>;

/**
 * Creates a Redis client with standard exponential backoff reconnect strategy
 */
export async function createRedisClient(
  options?: RedisClientOptions & { url?: string },
): Promise<RedisClientType> {
  const { createClient } = await import("redis");
  return createClient({
    ...options,
    url: options?.url || process.env.REDIS_URL,
    socket: {
      reconnectStrategy: (retries: number) => {
        console.warn(`[Redis] reconnecting... attempt ${retries}`);
        return Math.min(retries * 100, 3000);
      },
      ...(options?.socket || {}),
    },
  });
}
