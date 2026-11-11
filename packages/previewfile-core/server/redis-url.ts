/**
 * The Redis URL the conversion queue (ioredis/BullMQ) and the conversion cache
 * (node-redis) connect to, or null when there is none.
 *
 * Both clients speak only the Redis protocol, but hosts share one `REDIS_URL`
 * variable with their own cache layer, which also accepts other backends —
 * `lmdb://` is the default for local development and the self-hosted Busabase
 * image. Such a URL must read as "no Redis": the queue is then disabled and the
 * convert route answers 503. Passing it through instead made node-redis throw
 * `Invalid protocol` (a 500) and made ioredis treat the path as a Unix socket
 * and retry forever (a request that never returns).
 */
export function resolveConversionRedisUrl(): string | null {
  const url = process.env.REDIS_URL || process.env.REDIS_CONNECTION_STRING;
  if (!url) return null;
  return /^rediss?:\/\//i.test(url.trim()) ? url : null;
}
