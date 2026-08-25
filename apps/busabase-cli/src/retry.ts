/**
 * Retry for transient failures.
 *
 * The CLI had none: one 429 from a rate limiter, one 502 from a proxy, or one
 * dropped connection ended the command with exit 1 and no second attempt. A
 * person retries by pressing up-arrow; an agent halfway through a batch just
 * reports the task as failed.
 *
 * What is NOT retried matters more than what is. A 429 means the server refused
 * the request before doing any work, so repeating it is safe for any method. A
 * 5xx or a dropped socket on a MUTATION is ambiguous — the change request may
 * already have been created — so those are retried only for reads. Retrying a
 * POST that actually succeeded would file the same proposal twice.
 */

export interface RetryOptions {
  /** Extra attempts after the first. `0` disables retrying entirely. */
  retries: number;
  /** Sleep hook, injectable so tests do not actually wait. */
  sleep?: (ms: number) => Promise<void>;
  /** Where the "retrying in Ns" notice goes. Never stdout — that carries data. */
  notify?: (message: string) => void;
  /** Deterministic jitter in tests. */
  jitter?: () => number;
}

const BASE_DELAY_MS = 500;
const MAX_DELAY_MS = 20_000;

const READ_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

const isNetworkError = (error: unknown): boolean =>
  error instanceof TypeError ||
  /fetch failed|econnreset|econnrefused|etimedout|socket hang up/i.test(
    error instanceof Error ? error.message : String(error),
  );

/** `Retry-After` is either delay-seconds or an HTTP-date; both are legal. */
export function parseRetryAfter(header: string | null, now = Date.now()): number | undefined {
  if (!header) return undefined;
  const seconds = Number(header.trim());
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds * 1000, MAX_DELAY_MS);
  const at = Date.parse(header);
  if (Number.isNaN(at)) return undefined;
  return Math.min(Math.max(at - now, 0), MAX_DELAY_MS);
}

/** Whether this outcome is worth another attempt for a request using `method`. */
export function shouldRetry(method: string, status: number | undefined): boolean {
  if (status === 429) return true;
  const isRead = READ_METHODS.has(method.toUpperCase());
  if (!isRead) return false;
  // `undefined` status = the request never produced a response (transport error).
  return status === undefined || status >= 500;
}

/**
 * Wrap a fetch so transient failures are retried with exponential backoff.
 * Returns `base` unchanged when `retries` is 0, so the no-retry path adds no
 * wrapper and no behaviour.
 */
export function withRetry(base: typeof fetch, options: RetryOptions): typeof fetch {
  const { retries } = options;
  if (retries <= 0) return base;
  const sleep = options.sleep ?? defaultSleep;
  const notify = options.notify ?? ((message: string) => console.error(message));
  const jitter = options.jitter ?? Math.random;

  return (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const method = init?.method ?? (input instanceof Request ? input.method : "GET");
    for (let attempt = 0; ; attempt += 1) {
      let response: Response | undefined;
      let failure: unknown;
      try {
        response = await base(input as Parameters<typeof fetch>[0], init);
      } catch (error) {
        if (!isNetworkError(error)) throw error;
        failure = error;
      }

      const status = response?.status;
      const last = attempt >= retries;
      if (!shouldRetry(method, status) || last) {
        if (response) return response;
        throw failure;
      }

      const backoff = Math.min(BASE_DELAY_MS * 2 ** attempt, MAX_DELAY_MS);
      const delay =
        parseRetryAfter(response?.headers.get("retry-after") ?? null) ??
        Math.round(backoff * (0.5 + jitter() * 0.5));
      notify(
        `[busabase-cli] ${status ? `HTTP ${status}` : "connection failed"} — retrying in ${Math.round(
          delay / 1000,
        )}s (attempt ${attempt + 2} of ${retries + 1})`,
      );
      await sleep(delay);
    }
  }) as typeof fetch;
}
