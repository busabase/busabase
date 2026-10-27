import * as realFs from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * A credential file must never exist readable by anyone else while it holds (or is
 * about to hold) a key. A `chmod` AFTER the write leaves a window: with `umask 022`
 * the file is `0644` and another local user who opens it then keeps a working
 * descriptor after the chmod. So the order of the calls matters, not just the final
 * mode — record them and check the order.
 */
const calls: string[] = [];

vi.mock("node:fs", async (importOriginal) => {
  const fs = await importOriginal<typeof import("node:fs")>();
  return {
    ...fs,
    openSync: (...args: Parameters<typeof fs.openSync>) => {
      const [path, flags, mode] = args;
      if (String(path).endsWith(".env"))
        calls.push(`open:${String(flags)}:${(mode as number | undefined)?.toString(8)}`);
      return fs.openSync(...args);
    },
    fchmodSync: (...args: Parameters<typeof fs.fchmodSync>) => {
      calls.push(`fchmod:${(args[1] as number).toString(8)}`);
      return fs.fchmodSync(...args);
    },
    writeSync: (...args: Parameters<typeof fs.writeSync>) => {
      calls.push("write");
      return (fs.writeSync as (...a: unknown[]) => number)(...args);
    },
    writeFileSync: (...args: Parameters<typeof fs.writeFileSync>) => {
      if (String(args[0]).endsWith(".env")) calls.push("writeFileSync(.env)");
      return fs.writeFileSync(...args);
    },
  };
});

import { dotEnvPath, resetActiveCredentialTarget, writeDotEnvFile } from "./config-file";

let home: string;
let originalHome: string | undefined;
let originalUmask: number;

beforeEach(async () => {
  originalHome = process.env.HOME;
  delete process.env.BUSABASE_PROFILE;
  delete process.env.BUSABASE_CONFIG;
  home = await mkdtemp(join(tmpdir(), "busabase-perm-"));
  process.env.HOME = home;
  originalUmask = process.umask(0o022); // the common default: new files would be 0644
  resetActiveCredentialTarget();
  calls.length = 0;
});

afterEach(async () => {
  process.umask(originalUmask);
  process.env.HOME = originalHome;
  resetActiveCredentialTarget();
  await rm(home, { recursive: true, force: true });
});

const modeOf = (p: string) => realFs.statSync(p).mode & 0o777;

describe.skipIf(process.platform === "win32")("credential file permissions", () => {
  it("creates a new .env 0600 from the start, with umask 022", () => {
    writeDotEnvFile({ BUSABASE_API_KEY: "sk_first_login" });
    expect(modeOf(dotEnvPath())).toBe(0o600);
    expect(calls.find((c) => c.startsWith("open:"))).toBe("open:w:600");
  });

  it("never writes the key with writeFileSync (which would create it 0644 first)", () => {
    writeDotEnvFile({ BUSABASE_API_KEY: "sk_first_login" });
    expect(calls).not.toContain("writeFileSync(.env)");
  });

  it("tightens a loose existing .env before the new key is written", () => {
    realFs.mkdirSync(join(home, ".busabase"), { recursive: true });
    realFs.writeFileSync(dotEnvPath(), "BUSABASE_BASE_URL=https://busabase.com\n", { mode: 0o644 });
    realFs.chmodSync(dotEnvPath(), 0o644);
    expect(modeOf(dotEnvPath())).toBe(0o644);

    calls.length = 0;
    writeDotEnvFile({ BUSABASE_API_KEY: "sk_rotated" });

    expect(modeOf(dotEnvPath())).toBe(0o600);
    const fchmodAt = calls.indexOf("fchmod:600");
    const writeAt = calls.indexOf("write");
    expect(fchmodAt).toBeGreaterThanOrEqual(0);
    expect(writeAt).toBeGreaterThan(fchmodAt); // secret goes in only after the file is private
    expect(realFs.readFileSync(dotEnvPath(), "utf8")).toContain("BUSABASE_API_KEY=sk_rotated");
  });

  it("creates ~/.busabase owner-only", () => {
    writeDotEnvFile({ BUSABASE_API_KEY: "sk_first_login" });
    expect(modeOf(join(home, ".busabase"))).toBe(0o700);
  });

  it("keeps a symlinked .env pointing at its target", () => {
    const target = join(home, "dotfiles-env");
    realFs.writeFileSync(target, "BUSABASE_BASE_URL=https://busabase.com\n", { mode: 0o644 });
    realFs.mkdirSync(join(home, ".busabase"), { recursive: true });
    realFs.symlinkSync(target, dotEnvPath());

    writeDotEnvFile({ BUSABASE_API_KEY: "sk_linked" });

    expect(realFs.lstatSync(dotEnvPath()).isSymbolicLink()).toBe(true);
    expect(realFs.readFileSync(target, "utf8")).toContain("BUSABASE_API_KEY=sk_linked");
    expect(modeOf(target)).toBe(0o600);
  });
});
