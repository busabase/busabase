import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

/**
 * Unit coverage for `packages/busabase-core/src/domains/airapp/logic/local-runtime.ts`
 * — the install/dev execution engine backing the `"local"` AirApp runner. Real
 * process spawning is never exercised here (that's covered separately by
 * live/manual verification); instead `node:child_process`'s `spawn` is mocked
 * so the pure/logic pieces (port detection, workdir isolation, file writing)
 * are tested in isolation, matching this repo's
 * `tests/text-cache-local-streaming.test.ts` style (real fs for fs-touching
 * code, `vi.mock` for external deps).
 *
 * The sandbox-config, concurrency-mutex and fail-open-warning suites that used
 * to live here went with the `"srt"` engine they covered: it network-isolated
 * the process, which also made its port unreachable for preview, so it was
 * never offered by `resolveAvailableAirAppEngines` and never ran. Isolated
 * execution is now `logic/sandock-runtime.ts`'s job.
 */

describe("detectPort", () => {
  it("matches 'listening on port 4123'", async () => {
    const { detectPort } = await import("../src/domains/airapp/logic/local-runtime");
    expect(detectPort("Server listening on port 4123")).toBe(4123);
  });

  it("matches 'localhost:3000'", async () => {
    const { detectPort } = await import("../src/domains/airapp/logic/local-runtime");
    expect(detectPort("ready - started server on http://localhost:3000")).toBe(3000);
  });

  it("matches '0.0.0.0:8080'", async () => {
    const { detectPort } = await import("../src/domains/airapp/logic/local-runtime");
    expect(detectPort("Listening on 0.0.0.0:8080")).toBe(8080);
  });

  it("matches 'listening on: 5000' (colon variant)", async () => {
    const { detectPort } = await import("../src/domains/airapp/logic/local-runtime");
    expect(detectPort("App listening on: 5000")).toBe(5000);
  });

  it("does not match a line with no port info", async () => {
    const { detectPort } = await import("../src/domains/airapp/logic/local-runtime");
    expect(detectPort("Compiling...")).toBeNull();
  });

  it("does not match a nonsense out-of-range number", async () => {
    const { detectPort } = await import("../src/domains/airapp/logic/local-runtime");
    expect(detectPort("build id 99999999")).toBeNull();
  });

  it("returns null for garbage input", async () => {
    const { detectPort } = await import("../src/domains/airapp/logic/local-runtime");
    expect(detectPort("")).toBeNull();
    expect(detectPort("asdkjfh 987 !!! %%")).toBeNull();
  });

  it("matches Vite's real-world 'Local: http://localhost:5173/' format", async () => {
    const { detectPort } = await import("../src/domains/airapp/logic/local-runtime");
    expect(detectPort("  ➜  Local:   http://localhost:5173/")).toBe(5173);
  });
});

describe("resolveWorkdir", () => {
  const originalEnv = process.env.SANDAGENT_WORKDIR;

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.SANDAGENT_WORKDIR;
    } else {
      process.env.SANDAGENT_WORKDIR = originalEnv;
    }
  });

  it("returns a path rooted under SANDAGENT_WORKDIR/airapp-runtime/{nodeId}/{uuid}", async () => {
    process.env.SANDAGENT_WORKDIR = ".tmp-test-workdir";
    const { resolveWorkdir } = await import("../src/domains/airapp/logic/local-runtime");
    const workdir = resolveWorkdir("node-123");
    const expectedBase = path.resolve(
      process.cwd(),
      ".tmp-test-workdir",
      "airapp-runtime",
      "node-123",
    );
    expect(workdir.startsWith(expectedBase + path.sep)).toBe(true);
  });

  it("falls back to '.tmp' when SANDAGENT_WORKDIR is unset", async () => {
    delete process.env.SANDAGENT_WORKDIR;
    const { resolveWorkdir } = await import("../src/domains/airapp/logic/local-runtime");
    const workdir = resolveWorkdir("node-123");
    const expectedBase = path.resolve(process.cwd(), ".tmp", "airapp-runtime", "node-123");
    expect(workdir.startsWith(expectedBase + path.sep)).toBe(true);
  });

  it("returns a DIFFERENT path on each call for the same nodeId (Run again must not reuse a stale workdir)", async () => {
    const { resolveWorkdir } = await import("../src/domains/airapp/logic/local-runtime");
    const first = resolveWorkdir("same-node");
    const second = resolveWorkdir("same-node");
    expect(first).not.toBe(second);
  });
});

describe("writeFiles", () => {
  let tmpDir = "";

  afterEach(async () => {
    if (tmpDir) {
      await rm(tmpDir, { recursive: true, force: true });
      tmpDir = "";
    }
  });

  it("creates nested parent directories for a deep file path", async () => {
    const { writeFiles } = await import("../src/domains/airapp/logic/local-runtime");
    tmpDir = await mkdtemp(path.join(os.tmpdir(), "airapp-writefiles-"));
    await writeFiles(tmpDir, { "src/components/App.tsx": "export const App = () => null;" });
    const content = await readFile(path.join(tmpDir, "src/components/App.tsx"), "utf-8");
    expect(content).toBe("export const App = () => null;");
  });

  it("writes multiple files at different depths with correct content", async () => {
    const { writeFiles } = await import("../src/domains/airapp/logic/local-runtime");
    tmpDir = await mkdtemp(path.join(os.tmpdir(), "airapp-writefiles-"));
    const files = {
      "package.json": '{"name":"demo"}',
      "src/index.ts": "console.log('hi');",
      "src/lib/deep/nested/util.ts": "export const x = 1;",
    };
    await writeFiles(tmpDir, files);
    for (const [filePath, expectedContent] of Object.entries(files)) {
      const actual = await readFile(path.join(tmpDir, filePath), "utf-8");
      expect(actual).toBe(expectedContent);
    }
  });

  it("does not throw and leaves no stray state for an empty files object", async () => {
    const { writeFiles } = await import("../src/domains/airapp/logic/local-runtime");
    tmpDir = await mkdtemp(path.join(os.tmpdir(), "airapp-writefiles-"));
    await expect(writeFiles(tmpDir, {})).resolves.toBeUndefined();
    const entries = await import("node:fs/promises").then((fs) => fs.readdir(tmpDir));
    expect(entries).toEqual([]);
  });
});
