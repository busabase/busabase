/**
 * `install <source>` reads a GitHub URL (unchanged) or, now, a local
 * directory / `file://` URL — the exact output `busabase-cli export` writes.
 * Covers only the source-resolution split; `resolvePackageSource`'s GitHub
 * branch is exercised elsewhere (server-side install tests already fetch a
 * synthetic zipball), so this stays scoped to what changed: telling a path
 * apart from a URL, and reading a real directory from disk.
 */
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { isLocalPackageSource, resolvePackageSource } from "./commands";

describe("isLocalPackageSource", () => {
  it("treats http(s) URLs as GitHub sources", () => {
    expect(isLocalPackageSource("https://github.com/acme/support-kb-template")).toBe(false);
    expect(isLocalPackageSource("http://github.com/acme/support-kb-template")).toBe(false);
  });

  it("treats a bare or relative filesystem path as local", () => {
    expect(isLocalPackageSource("./support-kb-template")).toBe(true);
    expect(isLocalPackageSource("../export-out")).toBe(true);
    expect(isLocalPackageSource("/tmp/support-kb-template")).toBe(true);
    expect(isLocalPackageSource("support-kb-template")).toBe(true);
  });

  it("treats a file:// URL as local", () => {
    expect(isLocalPackageSource("file:///tmp/support-kb-template")).toBe(true);
  });

  it("does not mistake any other scheme for a local path or accept it as GitHub", () => {
    // Neither branch should silently swallow an unexpected scheme — the
    // GitHub path already rejects non-github.com hosts; a non-http(s) scheme
    // reaching `isLocalPackageSource` should read as local so `readDirectoryFiles`
    // (not a silent host-allowlist bypass) is what reports it's not a real path.
    expect(isLocalPackageSource("git://github.com/acme/support-kb-template")).toBe(true);
  });
});

describe("resolvePackageSource — local directory", () => {
  let dir: string;

  afterEach(async () => {
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  it("reads every file under a local directory, keyed by its relative POSIX path", async () => {
    dir = await mkdtemp(join(tmpdir(), "busabase-install-local-"));
    await writeFile(join(dir, "busabase.json"), JSON.stringify({ format: "busabase-package@1" }));
    await mkdir(join(dir, "content", "blog"), { recursive: true });
    await writeFile(join(dir, "content", "blog", "base.json"), "{}");

    const resolved = await resolvePackageSource(dir, {});
    expect(resolved.github).toBeUndefined();
    expect(resolved.label).toBe(dir);
    expect([...resolved.files.keys()].sort()).toEqual(["busabase.json", "content/blog/base.json"]);
  });

  it("reads the same directory via a file:// URL", async () => {
    dir = await mkdtemp(join(tmpdir(), "busabase-install-local-"));
    await writeFile(join(dir, "busabase.json"), "{}");

    const resolved = await resolvePackageSource(`file://${dir}`, {});
    expect(resolved.files.has("busabase.json")).toBe(true);
  });

  it("errors clearly on an empty or missing directory instead of installing nothing", async () => {
    dir = await mkdtemp(join(tmpdir(), "busabase-install-local-empty-"));
    await expect(resolvePackageSource(dir, {})).rejects.toThrow(/No files found under/);
  });
});
