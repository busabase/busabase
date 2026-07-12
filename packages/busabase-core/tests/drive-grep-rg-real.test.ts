import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRouterClient } from "@orpc/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Drive Grep Retrieval P1 — real `rg` (ripgrep) acceleration coverage.
 *
 * These tests exercise the ACTUAL `rg` binary end to end (its real behavior
 * is preserved via a pass-through wrapper, see `vi.mock` below — never
 * replaced) — so, per the task's explicit instruction, they must SKIP (not
 * fail) on any machine/CI runner without `rg` installed, rather than assume
 * its presence. `isRgAvailable()` is the exact same detection `grepAssets`
 * itself uses, so "this describe block ran" and "grepAssets would have
 * chosen the rg path" are the same fact.
 *
 * The pass-through wrapper around `child_process.execFile` (real Node
 * builtin, not a mutable object — `vi.spyOn` can't redefine its properties,
 * hence `vi.mock` + `importOriginal` instead) confirms the `rg` search
 * invocation (`-F`) was actually made, not merely that the JS scanner
 * produced the same output by coincidence (the whole point of
 * literal-pattern parity is that both paths agree, so output alone can't
 * distinguish which one ran).
 */

const { execFileMock } = vi.hoisted(() => ({ execFileMock: vi.fn() }));

vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  execFileMock.mockImplementation(actual.execFile);
  return { ...actual, execFile: execFileMock };
});

const rgSearchCalls = () =>
  execFileMock.mock.calls.filter(
    (call) => call[0] === "rg" && Array.isArray(call[1]) && (call[1] as string[]).includes("-F"),
  );

type Client = ReturnType<
  typeof createRouterClient<typeof import("../src/router").busabaseRouter, Record<never, never>>
>;

const MIGRATIONS_CWD = path.resolve(__dirname, "../../../apps/busabase");
const HASH = (byte: string) => `sha256:${byte.repeat(64)}`;

const expectDefined = <T>(value: T | undefined | null): T => {
  expect(value).toBeDefined();
  expect(value).not.toBeNull();
  if (value === undefined || value === null) throw new Error("Expected value to be defined");
  return value;
};

const { isRgAvailable } = await import("../src/domains/assets/logic/asset-grep-logic");
const rgAvailable = await isRgAvailable();

describe.skipIf(!rgAvailable)("Drive Grep Retrieval — rg-accelerated grep (real binary)", () => {
  let dataDir = "";
  let storageDir = "";
  let originalCwd = "";
  let client: Client;

  beforeAll(async () => {
    originalCwd = process.cwd();
    process.chdir(MIGRATIONS_CWD);
    dataDir = await mkdtemp(path.join(os.tmpdir(), "busabase-grep-rg-db-"));
    storageDir = await mkdtemp(path.join(os.tmpdir(), "busabase-grep-rg-storage-"));
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

  it("finds a literal match with correct line/column via the real rg binary", async () => {
    const { assetId } = await uploadAsset({ fileName: "rg-basic.log", hashByte: "1" });
    await client.assets.putText({
      assetId,
      text: "before line\nERROR: disk full\nafter line",
    });

    const result = await client.assets.grep({ pattern: "ERROR", scope: { assetIds: [assetId] } });

    expect(rgSearchCalls().length).toBeGreaterThanOrEqual(1);
    expect(result.matches).toHaveLength(1);
    const match = expectDefined(result.matches[0]);
    expect(match.line).toBe(2);
    expect(match.column).toBe(1);
    expect(match.text).toBe("ERROR: disk full");
    expect(match.before).toEqual([]);
    expect(match.after).toEqual([]);
  });

  it("computes correct line/column for multi-byte CJK content via rg (byte-offset → char-column conversion)", async () => {
    const { assetId } = await uploadAsset({ fileName: "rg-cjk.log", hashByte: "2" });
    await client.assets.putText({ assetId, text: "你好世界，ACME公司在此" });

    const result = await client.assets.grep({ pattern: "ACME", scope: { assetIds: [assetId] } });

    expect(rgSearchCalls().length).toBeGreaterThanOrEqual(1);
    expect(result.matches).toHaveLength(1);
    const match = expectDefined(result.matches[0]);
    expect(match.line).toBe(1);
    expect(match.column).toBe("你好世界，".length + 1);
  });

  it("honors the case-insensitive flag via rg -i", async () => {
    const { assetId } = await uploadAsset({ fileName: "rg-case.log", hashByte: "3" });
    await client.assets.putText({ assetId, text: "Order-2024 shipped\norder-2025 pending" });

    const caseSensitive = await client.assets.grep({
      pattern: "order",
      scope: { assetIds: [assetId] },
    });
    expect(caseSensitive.matches).toHaveLength(1);
    expect(caseSensitive.matches[0]?.line).toBe(2);

    const caseInsensitive = await client.assets.grep({
      pattern: "order",
      flags: "i",
      scope: { assetIds: [assetId] },
    });
    expect(caseInsensitive.matches).toHaveLength(2);
    expect(rgSearchCalls().length).toBeGreaterThanOrEqual(1);
  });

  it("caps at maxMatches via rg's -m flag and reports truncated: true", async () => {
    const { assetId } = await uploadAsset({ fileName: "rg-many-hits.log", hashByte: "4" });
    const text = Array.from({ length: 20 }, (_, i) => `hit number ${i}`).join("\n");
    await client.assets.putText({ assetId, text });

    const result = await client.assets.grep({
      pattern: "hit",
      scope: { assetIds: [assetId] },
      maxMatches: 5,
    });

    expect(rgSearchCalls().length).toBeGreaterThanOrEqual(1);
    expect(result.matches).toHaveLength(5);
    expect(result.truncated).toBe(true);
  });

  it("falls back to the JS scanner (never rg) when contextLines > 0, even for a literal pattern", async () => {
    const { assetId } = await uploadAsset({ fileName: "rg-context.log", hashByte: "5" });
    await client.assets.putText({
      assetId,
      text: "before line 1\nbefore line 2\nERROR: disk full\nafter line 1\nafter line 2",
    });

    const result = await client.assets.grep({
      pattern: "ERROR",
      scope: { assetIds: [assetId] },
      contextLines: 2,
    });

    expect(result.matches).toHaveLength(1);
    const match = expectDefined(result.matches[0]);
    expect(match.before).toEqual(["before line 1", "before line 2"]);
    expect(match.after).toEqual(["after line 1", "after line 2"]);
    // contextLines > 0 is explicitly out of the rg-acceleration scope (see
    // asset-grep-logic.ts's "Optional rg acceleration" section banner) — it
    // must always fall back to the JS scanner, never invoke rg's search.
    expect(rgSearchCalls()).toHaveLength(0);
  });
});
