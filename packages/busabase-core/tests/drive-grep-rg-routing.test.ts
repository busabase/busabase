import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRouterClient } from "@orpc/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Drive Grep Retrieval P1 — proves the single most important correctness
 * property of the optional `rg` acceleration: a REGEX pattern (one
 * containing a JS regex metacharacter) must NEVER reach the `rg` search
 * invocation, even when `rg` is available. `rg`'s regex engine is not
 * identical to JS's, so routing a regex pattern through it would risk
 * silently different matches — a correctness regression, not an
 * optimization.
 *
 * `node:child_process` is mocked here so this file's result is deterministic
 * regardless of whether the real `rg` binary happens to be installed on the
 * machine running the suite — the mock simulates "rg is available" so both
 * the negative case (regex never calls it) and the positive case (literal
 * does call it, when eligible) are exercised for real, every time.
 */

const execFileMock = vi.fn(
  (
    _cmd: string,
    args: string[],
    optionsOrCallback: unknown,
    maybeCallback?: (error: Error | null, stdout?: string, stderr?: string) => void,
  ) => {
    const callback = (
      typeof optionsOrCallback === "function" ? optionsOrCallback : maybeCallback
    ) as (error: Error | null, stdout?: string, stderr?: string) => void;
    if (args.includes("--version")) {
      callback(null, "ripgrep 14.1.0 (mocked)\n", "");
      return;
    }
    // A real search invocation (`-F ...`) — respond with a well-formed but
    // empty `rg --json` stream (no `match` events). This test only cares
    // about WHETHER the search invocation happened, not its result content
    // (real-binary correctness is covered by drive-grep-rg-real.test.ts).
    callback(null, "", "");
  },
);

vi.mock("node:child_process", () => ({
  execFile: (...args: unknown[]) => (execFileMock as unknown as (...a: unknown[]) => void)(...args),
}));

type BusabaseRouter = typeof import("../src/router").busabaseRouter;
type Client = ReturnType<typeof createRouterClient<BusabaseRouter, Record<never, never>>>;

const MIGRATIONS_CWD = path.resolve(__dirname, "../../../apps/busabase");
const HASH = (byte: string) => `sha256:${byte.repeat(64)}`;

const expectDefined = <T>(value: T | undefined | null): T => {
  expect(value).toBeDefined();
  expect(value).not.toBeNull();
  if (value === undefined || value === null) throw new Error("Expected value to be defined");
  return value;
};

const rgSearchCalls = () =>
  execFileMock.mock.calls.filter(
    (call) => call[0] === "rg" && Array.isArray(call[1]) && (call[1] as string[]).includes("-F"),
  );

describe("Drive Grep Retrieval — rg routing (mocked rg, deterministic regardless of real rg presence)", () => {
  let dataDir = "";
  let storageDir = "";
  let originalCwd = "";
  let client: Client;

  beforeAll(async () => {
    originalCwd = process.cwd();
    process.chdir(MIGRATIONS_CWD);
    dataDir = await mkdtemp(path.join(os.tmpdir(), "busabase-grep-rgroute-db-"));
    storageDir = await mkdtemp(path.join(os.tmpdir(), "busabase-grep-rgroute-storage-"));
    process.env.PG_DATABASE_URL = `pglite://${dataDir}`;
    process.env.STORAGE_URL = `local:${storageDir}?base_url=/api/test/storage`;
    const { busabaseRouter } = await import("../src/router");
    client = createRouterClient(busabaseRouter);
  });

  afterAll(async () => {
    delete process.env.PG_DATABASE_URL;
    delete process.env.STORAGE_URL;
    if (originalCwd) process.chdir(originalCwd);
    if (dataDir) await rm(dataDir, { recursive: true, force: true });
    if (storageDir) await rm(storageDir, { recursive: true, force: true });
  });

  beforeEach(() => {
    execFileMock.mockClear();
  });

  const uploadAsset = async (opts: { fileName: string; hashByte: string }) => {
    const contentHash = HASH(opts.hashByte);
    const req = await client.assets.createUploadUrl({
      fileName: opts.fileName,
      mimeType: "text/plain",
      sizeBytes: 100,
      contentHash,
    });
    const confirmed = await client.assets.confirm({
      storageKey: req.storageKey,
      fileName: opts.fileName,
      mimeType: "text/plain",
      sizeBytes: 100,
      contentHash,
    });
    return { assetId: expectDefined(confirmed.assetId) };
  };

  it("never invokes the rg search command for a regex pattern, even though (mocked) rg is available", async () => {
    const { assetId } = await uploadAsset({ fileName: "regex-route.log", hashByte: "1" });
    // One match per line only (mirrors `scanLinesForMatches`'s non-global
    // `regex.exec`) — two lines, so two matches.
    await client.assets.putText({ assetId, text: "needle123 and more\nneedle456 and more" });

    const result = await client.assets.grep({
      pattern: "needle\\d+", // "\\" + "d" is not itself a metachar, but "\\" is — regex, not literal.
      scope: { assetIds: [assetId] },
    });

    expect(result.matches).toHaveLength(2);
    expect(rgSearchCalls()).toHaveLength(0);
  });

  it("invokes the rg search command for a literal pattern with contextLines: 0, when rg is available", async () => {
    const { assetId } = await uploadAsset({ fileName: "literal-route.log", hashByte: "2" });
    await client.assets.putText({ assetId, text: "literal-needle here" });

    await client.assets.grep({
      pattern: "literal-needle",
      scope: { assetIds: [assetId] },
    });

    expect(rgSearchCalls().length).toBeGreaterThanOrEqual(1);
  });

  it("does not invoke rg for a literal pattern when contextLines > 0 (scoped down, falls back to JS)", async () => {
    const { assetId } = await uploadAsset({ fileName: "literal-context-route.log", hashByte: "3" });
    await client.assets.putText({ assetId, text: "literal-needle here" });

    const result = await client.assets.grep({
      pattern: "literal-needle",
      scope: { assetIds: [assetId] },
      contextLines: 1,
    });

    expect(result.matches).toHaveLength(1);
    expect(rgSearchCalls()).toHaveLength(0);
  });
});
