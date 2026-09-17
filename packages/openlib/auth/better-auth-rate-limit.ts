import "server-only";

export interface BetterAuthRateLimitValue {
  key: string;
  count: number;
  lastRequest: number;
}

export interface BetterAuthRateLimitStorage {
  get(key: string): Promise<BetterAuthRateLimitValue | null>;
  set(key: string, value: BetterAuthRateLimitValue, update?: boolean): Promise<void>;
  consume(
    key: string,
    rule: { window: number; max: number },
  ): Promise<{ allowed: boolean; retryAfter: number | null }>;
  delete(key: string): Promise<void>;
}

interface RedisCommandClient {
  get(key: string): Promise<string | null>;
  set(
    key: string,
    value: string,
    options?: { EX?: number; NX?: boolean; KEEPTTL?: boolean },
  ): Promise<unknown>;
  del(key: string): Promise<number>;
  eval(script: string, options: { keys: string[]; arguments: string[] }): Promise<unknown>;
  connect(): Promise<unknown>;
  destroy(): void;
  on(event: "error" | "end", listener: (...args: unknown[]) => void): unknown;
}

export interface BetterAuthRateLimitConfig {
  enabled: boolean;
  window: number;
  max: number;
  storage: "memory";
  customStorage?: BetterAuthRateLimitStorage;
  customRules: Record<string, { window: number; max: number }>;
}

interface RedisStorageOptions {
  appName: string;
  redisUrl?: string;
  defaultWindow?: number;
  getClient?: () => Promise<RedisCommandClient>;
}

interface RateLimitConfigOptions {
  appName: string;
  env?: Record<string, string | undefined>;
  getClient?: () => Promise<RedisCommandClient>;
}

const globalRegistry = globalThis as typeof globalThis & {
  __betterAuthRateLimitRedisConnections?: Map<string, Promise<RedisCommandClient>>;
};

if (!globalRegistry.__betterAuthRateLimitRedisConnections) {
  globalRegistry.__betterAuthRateLimitRedisConnections = new Map();
}
const connections = globalRegistry.__betterAuthRateLimitRedisConnections;

const isRedisUrl = (value: string | undefined): value is string =>
  /^(redis|rediss):\/\//.test(value?.trim() ?? "");

const normalizeNamespace = (value: string): string => {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9:_-]+/g, "-");
  if (!normalized) throw new Error("Better Auth rate limiting requires a non-empty appName");
  return normalized;
};

const positiveInteger = (value: string | undefined, fallback: number): number => {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
};

const connectRedis = (url: string): Promise<RedisCommandClient> => {
  const existing = connections.get(url);
  if (existing) return existing;

  let connection: Promise<RedisCommandClient>;
  connection = import("redis")
    .then(async ({ createClient }) => {
      const client = createClient({
        url,
        disableOfflineQueue: true,
        socket: {
          connectTimeout: positiveInteger(process.env.BETTER_AUTH_REDIS_CONNECT_TIMEOUT_MS, 1_500),
          reconnectStrategy: false,
        },
      }) as unknown as RedisCommandClient;
      client.on("error", () => {
        // Commands reject to the caller. The listener prevents an unhandled EventEmitter error.
      });
      client.on("end", () => {
        if (connections.get(url) === connection) connections.delete(url);
      });
      try {
        await client.connect();
      } catch (error) {
        try {
          client.destroy();
        } catch {
          // Keep the original connection failure as the actionable cause.
        }
        throw error;
      }
      return client;
    })
    .catch((cause) => {
      if (connections.get(url) === connection) connections.delete(url);
      throw new Error("Better Auth Redis rate-limit storage is unavailable", { cause });
    });
  connections.set(url, connection);
  return connection;
};

const CONSUME_SCRIPT = `
local raw = redis.call("GET", KEYS[1])
local now = tonumber(ARGV[1])
local window = tonumber(ARGV[2])
local max = tonumber(ARGV[3])

if not raw then
  local value = cjson.encode({ key = ARGV[4], count = 1, lastRequest = now })
  redis.call("SET", KEYS[1], value, "EX", window)
  return { 1, window }
end

local value = cjson.decode(raw)
local count = tonumber(value.count) or 0
local ttl = redis.call("TTL", KEYS[1])
if ttl < 1 then ttl = 1 end

if count >= max then
  return { 0, ttl }
end

value.count = count + 1
redis.call("SET", KEYS[1], cjson.encode(value), "KEEPTTL")
return { 1, ttl }
`;

const UPDATE_SCRIPT = `
if ARGV[2] == "1" and redis.call("EXISTS", KEYS[1]) == 1 then
  redis.call("SET", KEYS[1], ARGV[1], "KEEPTTL")
else
  redis.call("SET", KEYS[1], ARGV[1], "EX", ARGV[3])
end
return 1
`;

export function createBetterAuthRedisRateLimitStorage(
  options: RedisStorageOptions,
): BetterAuthRateLimitStorage | undefined {
  const redisUrl = options.redisUrl?.trim();
  if (!isRedisUrl(redisUrl) && !options.getClient) return undefined;

  const namespace = normalizeNamespace(options.appName);
  const defaultWindow = options.defaultWindow ?? 60;
  const clientFor = options.getClient ?? (() => connectRedis(redisUrl as string));
  const namespacedKey = (key: string) => `better-auth:${namespace}:rate-limit:${key}`;

  const run = async <T>(operation: (client: RedisCommandClient) => Promise<T>): Promise<T> => {
    try {
      return await operation(await clientFor());
    } catch (cause) {
      throw new Error(`Better Auth Redis rate limiting failed for ${namespace}`, { cause });
    }
  };

  return {
    get: (key) =>
      run(async (client) => {
        const raw = await client.get(namespacedKey(key));
        if (!raw) return null;
        const parsed = JSON.parse(raw) as Partial<BetterAuthRateLimitValue>;
        if (!Number.isFinite(parsed.count) || !Number.isFinite(parsed.lastRequest)) {
          throw new Error("Invalid Better Auth rate-limit value in Redis");
        }
        return {
          key,
          count: Number(parsed.count),
          lastRequest: Number(parsed.lastRequest),
        };
      }),
    set: (key, value, update = false) =>
      run(async (client) => {
        await client.eval(UPDATE_SCRIPT, {
          keys: [namespacedKey(key)],
          arguments: [JSON.stringify({ ...value, key }), update ? "1" : "0", String(defaultWindow)],
        });
      }),
    consume: (key, rule) =>
      run(async (client) => {
        const result = await client.eval(CONSUME_SCRIPT, {
          keys: [namespacedKey(key)],
          arguments: [String(Date.now()), String(rule.window), String(rule.max), key],
        });
        if (!Array.isArray(result) || result.length < 2) {
          throw new Error("Invalid Better Auth rate-limit response from Redis");
        }
        const allowed = Number(result[0]) === 1;
        return {
          allowed,
          retryAfter: allowed ? null : Math.max(Number(result[1]) || 1, 1),
        };
      }),
    delete: (key) => run(async (client) => void (await client.del(namespacedKey(key)))),
  };
}

export function getBetterAuthRateLimitConfig(
  options: RateLimitConfigOptions,
): BetterAuthRateLimitConfig {
  const env = options.env ?? process.env;
  const window = positiveInteger(env.BETTER_AUTH_RATE_LIMIT_WINDOW_SECONDS, 60);
  const max = positiveInteger(env.BETTER_AUTH_RATE_LIMIT_MAX, 100);
  const rule = (prefix: string, fallbackWindow: number, fallbackMax: number) => ({
    window: positiveInteger(env[`${prefix}_WINDOW_SECONDS`], fallbackWindow),
    max: positiveInteger(env[`${prefix}_MAX`], fallbackMax),
  });
  const customStorage = createBetterAuthRedisRateLimitStorage({
    appName: options.appName,
    redisUrl: env.REDIS_URL,
    defaultWindow: window,
    getClient: options.getClient,
  });

  return {
    enabled: env.BETTER_AUTH_RATE_LIMIT_ENABLED?.trim().toLowerCase() !== "false",
    window,
    max,
    storage: "memory",
    ...(customStorage ? { customStorage } : {}),
    customRules: {
      "/sign-in/email": rule("BETTER_AUTH_RATE_LIMIT_SIGN_IN", 60, 5),
      "/sign-up/email": rule("BETTER_AUTH_RATE_LIMIT_SIGN_UP", 300, 5),
      "/request-password-reset": rule("BETTER_AUTH_RATE_LIMIT_PASSWORD_RESET", 300, 3),
      "/send-verification-email": rule("BETTER_AUTH_RATE_LIMIT_VERIFICATION", 60, 1),
      "/sign-in/wechat-miniapp": rule("BETTER_AUTH_RATE_LIMIT_WECHAT_MINIAPP", 60, 5),
    },
  };
}

export async function closeBetterAuthRedisRateLimitConnections(): Promise<number> {
  const active = [...connections.values()];
  connections.clear();
  await Promise.allSettled(
    active.map(async (connection) => {
      try {
        (await connection).destroy();
      } catch {
        // Failed connections have already been removed and need no cleanup.
      }
    }),
  );
  return active.length;
}
