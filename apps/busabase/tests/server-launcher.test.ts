import { spawn } from "node:child_process";
import { copyFile, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";

/**
 * `busabase server` is the command the README leads with, and until now nothing
 * in CI ever ran it — which is how a launcher bug shipped: the entry point was
 * handed to `import()` as a raw filesystem path, so on Windows `C:\...` parsed
 * as protocol `c:` and the process died right after the splash banner
 * (busabase#63).
 *
 * Windows cannot be reproduced here, but the same class of bug is reachable on
 * POSIX: a path containing `#` is read as a URL fragment, so a bare `import()`
 * of it fails with ERR_MODULE_NOT_FOUND while `pathToFileURL` encodes it to
 * `%23` and resolves. Running the real launcher from such a directory therefore
 * fails if anyone drops the conversion — including on Linux CI.
 */

const repoRoot = path.resolve(fileURLToPath(new URL("../", import.meta.url)));
const realLauncher = path.join(repoRoot, "bin", "busabase.mjs");
const workspaces: string[] = [];

/** A minimal package laid out the way findServerEntry() expects to find it. */
const buildFakeInstall = async (dirName: string) => {
  const parent = await mkdtemp(path.join(tmpdir(), "busabase-launcher-"));
  workspaces.push(parent);
  const root = path.join(parent, dirName);
  const standalone = path.join(root, ".next", "standalone", "apps", "busabase");
  await mkdir(path.join(root, "bin"), { recursive: true });
  await mkdir(standalone, { recursive: true });
  await copyFile(realLauncher, path.join(root, "bin", "busabase.mjs"));
  await writeFile(
    path.join(root, "package.json"),
    JSON.stringify({ name: "busabase", version: "0.0.0-test", type: "module" }),
  );
  // Stands in for the Next standalone server: announces itself and exits, so
  // the test observes that the launcher actually imported it.
  await writeFile(
    path.join(standalone, "server.js"),
    'console.log("FAKE_SERVER_STARTED");\nprocess.exit(0);\n',
  );
  return path.join(root, "bin", "busabase.mjs");
};

const runLauncher = (launcher: string) =>
  new Promise<{ code: number | null; output: string }>((resolve) => {
    const child = spawn(process.execPath, [launcher, "server"], {
      env: { ...process.env, NO_COLOR: "1", BUSABASE_SKIP_UPDATE_CHECK: "1" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    child.stdout.on("data", (c: Buffer) => {
      output += c.toString();
    });
    child.stderr.on("data", (c: Buffer) => {
      output += c.toString();
    });
    child.on("close", (code) => resolve({ code, output }));
  });

afterAll(async () => {
  await Promise.all(workspaces.map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("busabase server launcher", { timeout: 60_000 }, () => {
  it("boots the built server from an ordinary install path", async () => {
    const launcher = await buildFakeInstall("plain");
    const { output } = await runLauncher(launcher);
    expect(output).toContain("FAKE_SERVER_STARTED");
  });

  it("boots from a path the ESM loader cannot read as a bare specifier", async () => {
    // `#` is the POSIX-reachable stand-in for Windows' `C:` drive letter: both
    // make the filesystem path an invalid module specifier. If the launcher
    // ever hands the raw path to import() again, this fails here, on Linux,
    // instead of only on a Windows user's machine.
    const launcher = await buildFakeInstall("has#hash");
    const { output } = await runLauncher(launcher);
    expect(output).not.toContain("ERR_MODULE_NOT_FOUND");
    expect(output).toContain("FAKE_SERVER_STARTED");
  });
});
