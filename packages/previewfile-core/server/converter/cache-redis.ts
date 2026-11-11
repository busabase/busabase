/**
 * Redis client singleton used by ConversionCache.
 *
 * Reads `REDIS_URL` (or `REDIS_CONNECTION_STRING`) from env. Matches the
 * behavior of the standalone host's previous `@/lib/redis` so no app config
 * changes are needed.
 *
 * For buda integration: ConversionCache also takes a `keyPrefix` config so
 * buda's cache entries (e.g. `buda:conv-cache:...`) don't collide with
 * the standalone host's on a shared Redis instance.
 */
import { createClient, type RedisClientType } from "redis";
import { resolveConversionRedisUrl } from "../redis-url";

let redisClient: RedisClientType | null = null;

export function getCacheRedis(): RedisClientType | null {
  if (redisClient) return redisClient;
  const url = resolveConversionRedisUrl();
  if (!url) return null;
  const client: RedisClientType = createClient({ url });
  client.on("error", () => {});
  redisClient = client;
  return redisClient;
}
