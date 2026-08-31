import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { checkForUpdate } from "./update-check";

/**
 * Real temp directory as the cache path (not a mocked fs) — only `fetch` is
 * mocked. Proves the cache file actually gets written/read on disk, not just
 * that the mock plumbing was called correctly.
 */
let cacheDir: string;
let originalFetch: typeof fetch;
let originalCI: string | undefined;
let originalNoCheck: string | undefined;
let originalIsTTY: boolean | undefined;

beforeEach(async () => {
  cacheDir = await mkdtemp(path.join(os.tmpdir(), "busabase-update-check-"));
  process.env.BUSABASE_UPDATE_CACHE_DIR = cacheDir;
  originalFetch = global.fetch;
  originalCI = process.env.CI;
  originalNoCheck = process.env.BUSABASE_NO_UPDATE_CHECK;
  originalIsTTY = process.stdout.isTTY;
  delete process.env.CI;
  delete process.env.BUSABASE_NO_UPDATE_CHECK;
  // The whole feature is a no-op unless the terminal is interactive — force
  // it on for these tests, restored in afterEach.
  Object.defineProperty(process.stdout, "isTTY", { value: true, configurable: true });
});

afterEach(async () => {
  global.fetch = originalFetch;
  delete process.env.BUSABASE_UPDATE_CACHE_DIR;
  if (originalCI === undefined) delete process.env.CI;
  else process.env.CI = originalCI;
  if (originalNoCheck === undefined) delete process.env.BUSABASE_NO_UPDATE_CHECK;
  else process.env.BUSABASE_NO_UPDATE_CHECK = originalNoCheck;
  Object.defineProperty(process.stdout, "isTTY", { value: originalIsTTY, configurable: true });
  await rm(cacheDir, { recursive: true, force: true });
});

const mockRegistryVersion = (
  version: string | null,
  opts: { ok?: boolean; delayMs?: number } = {},
) => {
  const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
    if (opts.delayMs) {
      await new Promise((resolve, reject) => {
        const timer = setTimeout(resolve, opts.delayMs);
        init?.signal?.addEventListener("abort", () => {
          clearTimeout(timer);
          reject(new DOMException("aborted", "AbortError"));
        });
      });
    }
    return {
      ok: opts.ok ?? true,
      json: async () => (version ? { version } : {}),
    } as Response;
  });
  global.fetch = fetchMock as unknown as typeof fetch;
  return fetchMock;
};

describe("checkForUpdate", () => {
  it("returns a notice and writes the cache on a cold (no cache file) check", async () => {
    const fetchMock = mockRegistryVersion("2.0.0");

    const notice = await checkForUpdate("busabase-cli", "1.0.0");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://registry.npmjs.org/busabase-cli/latest",
      expect.anything(),
    );
    expect(notice).toContain("1.0.0 → 2.0.0");
    expect(notice).toContain("npm i -g busabase-cli@latest");

    const cacheRaw = await readFile(path.join(cacheDir, "update-check.json"), "utf8");
    const cache = JSON.parse(cacheRaw);
    expect(cache["busabase-cli"].latestVersion).toBe("2.0.0");
  });

  it("returns null when already on the latest version", async () => {
    mockRegistryVersion("1.0.0");
    const notice = await checkForUpdate("busabase-cli", "1.0.0");
    expect(notice).toBeNull();
  });

  it("does not re-fetch when the cache is fresh (within 24h)", async () => {
    const first = mockRegistryVersion("2.0.0");
    await checkForUpdate("busabase-cli", "1.0.0");
    expect(first).toHaveBeenCalledTimes(1);

    // A second call within the same run reuses the cache written above.
    const second = mockRegistryVersion("3.0.0"); // would be a DIFFERENT answer if re-fetched
    const notice = await checkForUpdate("busabase-cli", "1.0.0");

    expect(second).not.toHaveBeenCalled();
    // Still reports the version from the FIRST (cached) check, not a phantom re-fetch.
    expect(notice).toContain("1.0.0 → 2.0.0");
  });

  it("re-fetches once the cache entry is older than 24h", async () => {
    mockRegistryVersion("2.0.0");
    await checkForUpdate("busabase-cli", "1.0.0");

    // Age the cache file past the 24h window.
    const cacheFile = path.join(cacheDir, "update-check.json");
    const cache = JSON.parse(await readFile(cacheFile, "utf8"));
    cache["busabase-cli"].lastCheckedAt = Date.now() - 25 * 60 * 60 * 1000;
    await import("node:fs/promises").then((fs) => fs.writeFile(cacheFile, JSON.stringify(cache)));

    const second = mockRegistryVersion("3.0.0");
    const notice = await checkForUpdate("busabase-cli", "1.0.0");

    expect(second).toHaveBeenCalledTimes(1);
    expect(notice).toContain("1.0.0 → 3.0.0");
  });

  it("stays silent and never throws on a network failure", async () => {
    global.fetch = vi.fn(async () => {
      throw new TypeError("fetch failed");
    }) as unknown as typeof fetch;

    await expect(checkForUpdate("busabase-cli", "1.0.0")).resolves.toBeNull();
  });

  it("stays silent and never throws when the registry responds with a non-OK status", async () => {
    mockRegistryVersion("2.0.0", { ok: false });
    await expect(checkForUpdate("busabase-cli", "1.0.0")).resolves.toBeNull();
  });

  it("aborts a slow request instead of hanging the caller", async () => {
    // Slower than the module's own fetch timeout — must resolve null, not hang.
    mockRegistryVersion("2.0.0", { delayMs: 5_000 });
    const notice = await checkForUpdate("busabase-cli", "1.0.0");
    expect(notice).toBeNull();
  }, 2_000);

  it("skips entirely (no fetch) when BUSABASE_NO_UPDATE_CHECK is set", async () => {
    process.env.BUSABASE_NO_UPDATE_CHECK = "1";
    const fetchMock = mockRegistryVersion("2.0.0");
    const notice = await checkForUpdate("busabase-cli", "1.0.0");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(notice).toBeNull();
  });

  it("skips entirely (no fetch) when CI=true", async () => {
    process.env.CI = "true";
    const fetchMock = mockRegistryVersion("2.0.0");
    const notice = await checkForUpdate("busabase-cli", "1.0.0");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(notice).toBeNull();
  });

  it("skips entirely (no fetch) when stdout is not a TTY", async () => {
    Object.defineProperty(process.stdout, "isTTY", { value: false, configurable: true });
    const fetchMock = mockRegistryVersion("2.0.0");
    const notice = await checkForUpdate("busabase-cli", "1.0.0");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(notice).toBeNull();
  });

  it("keeps a corrupt cache file from breaking the check — treats it as no cache", async () => {
    await import("node:fs/promises").then((fs) =>
      fs
        .mkdir(cacheDir, { recursive: true })
        .then(() => fs.writeFile(path.join(cacheDir, "update-check.json"), "{ not valid json")),
    );
    const fetchMock = mockRegistryVersion("2.0.0");
    const notice = await checkForUpdate("busabase-cli", "1.0.0");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(notice).toContain("1.0.0 → 2.0.0");
  });

  it("keys cache entries per package — checking busabase does not clobber busabase-cli's entry", async () => {
    mockRegistryVersion("2.0.0");
    await checkForUpdate("busabase-cli", "1.0.0");

    mockRegistryVersion("5.0.0");
    await checkForUpdate("busabase", "4.0.0");

    const cache = JSON.parse(await readFile(path.join(cacheDir, "update-check.json"), "utf8"));
    expect(cache["busabase-cli"].latestVersion).toBe("2.0.0");
    expect(cache.busabase.latestVersion).toBe("5.0.0");
  });

  it("resolves near-instantly on a cache hit — the whole point of caching (perf/no-block regression guard)", async () => {
    mockRegistryVersion("2.0.0");
    await checkForUpdate("busabase-cli", "1.0.0"); // warms the cache

    mockRegistryVersion("2.0.0", { delayMs: 5_000 }); // would hang if this path re-fetched
    const start = Date.now();
    await checkForUpdate("busabase-cli", "1.0.0");
    expect(Date.now() - start).toBeLessThan(200);
  });
});
