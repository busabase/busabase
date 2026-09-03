/**
 * Shared Redis pub/sub helpers.
 *
 * Why this exists: every domain that wanted cross-pod messaging used to spin
 * up its own dedicated subscriber connection (`createRedisClient` + manual
 * connect + manual subscribe + manual try/catch + manual `subscriberInitialized`
 * boolean). Redis pubsub is per-connection, but one connection can carry any
 * number of subscriptions, so each domain doing this independently wastes
 * connections and duplicates ~30 lines of boilerplate.
 *
 * This module owns a single process-wide subscriber connection and exposes
 * `subscribeToChannel` / `pSubscribeToPattern`. Callers describe what they
 * want; lifecycle, connection sharing, and graceful degradation are handled
 * here.
 *
 * Real Redis only — when REDIS_URL is unset or `lmdb://`, both subscribe
 * helpers return without throwing, matching the cache module's "silently
 * disabled" behaviour. Callers don't need to know.
 */

import type { createClient } from "redis";
import { cache } from "./index";
import { createRedisClient } from "./redis-client";

type RedisClient = ReturnType<typeof createClient>;

export type PubsubHandler = (payload: string, channel: string) => void;

export interface PubsubOptions {
  /** Log prefix used for diagnostic messages. e.g. "ChatRunRegistry". */
  name?: string;
}

function isRealRedisUrl(): boolean {
  const url = process.env.REDIS_URL ?? "";
  return url.startsWith("redis://") || url.startsWith("rediss://");
}

let subscriber: RedisClient | null = null;
let subscriberPromise: Promise<RedisClient | null> | null = null;

/**
 * Lazily create the process-wide subscriber connection. Internal — callers
 * use `subscribeToChannel` / `pSubscribeToPattern`.
 */
async function ensureSubscriber(): Promise<RedisClient | null> {
  if (subscriber) return subscriber;
  if (!isRealRedisUrl()) return null;
  if (subscriberPromise) return subscriberPromise;

  subscriberPromise = (async () => {
    try {
      const client = await createRedisClient();
      client.on("error", (err: unknown) => {
        console.warn("[Pubsub] subscriber connection error:", err);
      });
      await client.connect();
      subscriber = client;
      return client;
    } catch (err) {
      console.warn("[Pubsub] subscriber init failed, pubsub disabled:", err);
      subscriberPromise = null;
      return null;
    }
  })();

  return subscriberPromise;
}

/**
 * Subscribe a handler to an exact Redis channel.
 *
 * - No-op when REDIS_URL is unset / `lmdb://` (single-process dev).
 * - Multiple callers can subscribe to the same channel; each handler runs.
 * - Handler exceptions are caught and logged so one buggy module can't
 *   silently break another module's subscription.
 *
 * Idempotency: each call adds another listener. Modules that should run
 * exactly once should guard with their own `initialized` flag.
 */
export async function subscribeToChannel(
  channel: string,
  handler: PubsubHandler,
  options?: PubsubOptions,
): Promise<void> {
  const client = await ensureSubscriber();
  if (!client) return;

  const tag = options?.name ? `[Pubsub:${options.name}]` : "[Pubsub]";
  await client.subscribe(channel, (raw: string) => {
    try {
      handler(raw, channel);
    } catch (err) {
      console.warn(`${tag} handler threw on ${channel}:`, err);
    }
  });
}

/**
 * pSubscribe a handler to a glob-style channel pattern (e.g. `relay:resp:*`).
 * Same semantics as `subscribeToChannel`; callback receives the matched
 * channel name as the second arg so callers can demux by suffix.
 */
export async function pSubscribeToPattern(
  pattern: string,
  handler: PubsubHandler,
  options?: PubsubOptions,
): Promise<void> {
  const client = await ensureSubscriber();
  if (!client) return;

  const tag = options?.name ? `[Pubsub:${options.name}]` : "[Pubsub]";
  await client.pSubscribe(pattern, (raw: string, channel: string) => {
    try {
      handler(raw, channel);
    } catch (err) {
      console.warn(`${tag} handler threw on ${channel}:`, err);
    }
  });
}

/**
 * Publish to a Redis channel via the shared cache singleton's publisher
 * connection. Returns false (without throwing) when the cache provider
 * isn't configured / doesn't support publish, so call sites can stay
 * fire-and-forget.
 */
export async function publishToChannel(channel: string, payload: unknown): Promise<boolean> {
  try {
    const c = await cache;
    if (!c?.publish) return false;
    const message = typeof payload === "string" ? payload : JSON.stringify(payload);
    await c.publish(channel, message);
    return true;
  } catch (err) {
    console.warn("[Pubsub] publish failed:", err);
    return false;
  }
}
