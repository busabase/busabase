type RealtimeMessageHandler<T> = (message: T) => void;
type Unsubscribe = () => void;

type RedisClient = {
  connect: () => Promise<unknown>;
  duplicate: () => RedisClient;
  on: (event: "error", listener: (error: unknown) => void) => RedisClient;
  publish: (channel: string, message: string) => Promise<unknown>;
  subscribe: (channel: string, listener: (message: string) => void) => Promise<unknown>;
  unsubscribe: (channel: string, listener?: (message: string) => void) => Promise<unknown>;
};

const localSubscribers = new Map<string, Set<(message: string) => void>>();

let redisSubscriber: RedisClient | null = null;
let redisReady: Promise<{ publisher: RedisClient; subscriber: RedisClient }> | null = null;

const localPublish = (channel: string, message: string) => {
  for (const handler of localSubscribers.get(channel) ?? []) {
    handler(message);
  }
};

const localSubscribe = (channel: string, handler: (message: string) => void): Unsubscribe => {
  let subscribers = localSubscribers.get(channel);
  if (!subscribers) {
    subscribers = new Set();
    localSubscribers.set(channel, subscribers);
  }
  subscribers.add(handler);

  return () => {
    subscribers.delete(handler);
    if (subscribers.size === 0) {
      localSubscribers.delete(channel);
    }
  };
};

const getRedisUrl = () => {
  const url = process.env.REDIS_URL ?? "";
  return url.startsWith("redis://") || url.startsWith("rediss://") ? url : null;
};

const ensureRedis = async () => {
  if (!redisReady) {
    redisReady = (async () => {
      const redisUrl = getRedisUrl();
      if (!redisUrl) {
        throw new Error("REDIS_URL is not a redis:// or rediss:// URL");
      }
      const { createClient } = (await import("redis")) as {
        createClient: (options: { url: string }) => RedisClient;
      };
      const publisher = createClient({ url: redisUrl });
      const subscriber = publisher.duplicate();
      publisher.on("error", (error) => console.warn("[openlib/realtime] Redis publisher", error));
      subscriber.on("error", (error) => console.warn("[openlib/realtime] Redis subscriber", error));
      await Promise.all([publisher.connect(), subscriber.connect()]);
      redisSubscriber = subscriber;
      return { publisher, subscriber };
    })();
  }

  return redisReady;
};

export const publishRealtimeMessage = async (channel: string, payload: unknown) => {
  const message = JSON.stringify(payload);

  if (!getRedisUrl()) {
    localPublish(channel, message);
    return;
  }

  const { publisher } = await ensureRedis();
  await publisher.publish(channel, message);
};

export const subscribeRealtimeMessages = <T>(
  channel: string,
  onMessage: RealtimeMessageHandler<T>,
  signal?: AbortSignal,
): Unsubscribe => {
  const handler = (message: string) => onMessage(JSON.parse(message) as T);

  if (!getRedisUrl()) {
    const unsubscribe = localSubscribe(channel, handler);
    signal?.addEventListener("abort", unsubscribe, { once: true });
    return unsubscribe;
  }

  let active = true;
  let unsubscribe: Unsubscribe = () => {
    active = false;
  };

  ensureRedis()
    .then(({ subscriber }) => {
      if (!active) {
        return;
      }
      void subscriber.subscribe(channel, handler);
      unsubscribe = () => {
        active = false;
        void (redisSubscriber ?? subscriber).unsubscribe(channel, handler);
      };
      signal?.addEventListener("abort", unsubscribe, { once: true });
    })
    .catch((error) => {
      active = false;
      console.warn("[openlib/realtime] Redis subscribe failed", error);
    });

  return () => unsubscribe();
};
