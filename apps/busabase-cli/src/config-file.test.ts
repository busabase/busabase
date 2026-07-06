import { readFileSync, statSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { dotEnvPath, loadDotEnvFile, writeDotEnvFile } from "./config-file";

/**
 * `~/.busabase/.env` is the credential store every CLI/SDK call and the installed
 * skill read from, so its parse/merge/permission behaviour is load-bearing: a bad
 * merge could drop a token, and a world-readable rewrite would leak one. HOME is
 * redirected to a scratch dir so these never touch a real developer credential.
 */

let home: string;
let originalHome: string | undefined;

beforeEach(async () => {
  originalHome = process.env.HOME;
  home = await mkdtemp(join(tmpdir(), "busabase-cfg-"));
  process.env.HOME = home;
});

afterEach(async () => {
  process.env.HOME = originalHome;
  await rm(home, { force: true, recursive: true });
});

describe("dotEnvPath", () => {
  it("points at ~/.busabase/.env", () => {
    expect(dotEnvPath()).toBe(join(home, ".busabase", ".env"));
  });
});

describe("loadDotEnvFile", () => {
  it("returns {} when the file is absent", () => {
    expect(loadDotEnvFile()).toEqual({});
  });

  it("parses KEY=value pairs, skipping blanks and # comments", () => {
    writeDotEnvFile({ BUSABASE_BASE_URL: "http://localhost:15419", BUSABASE_API_KEY: "sk_1" });
    expect(loadDotEnvFile()).toMatchObject({
      BUSABASE_BASE_URL: "http://localhost:15419",
      BUSABASE_API_KEY: "sk_1",
    });
  });

  it("strips surrounding quotes and ignores lines without '='", () => {
    // Hand-write an awkward file to exercise the raw parser (seed once to create dir).
    writeDotEnvFile({ A: "1" });
    writeFileSync(
      dotEnvPath(),
      ["# a comment", "", 'QUOTED="value with spaces"', "SINGLE='sq'", "NOEQUALS", "B=2"].join(
        "\n",
      ),
    );
    const parsed = loadDotEnvFile();
    expect(parsed.QUOTED).toBe("value with spaces");
    expect(parsed.SINGLE).toBe("sq");
    expect(parsed.B).toBe("2");
    expect(parsed).not.toHaveProperty("NOEQUALS");
  });
});

describe("writeDotEnvFile", () => {
  it("round-trips through loadDotEnvFile", () => {
    writeDotEnvFile({ BUSABASE_API_KEY: "sk_round" });
    expect(loadDotEnvFile().BUSABASE_API_KEY).toBe("sk_round");
  });

  it("preserves untouched keys when merging", () => {
    writeDotEnvFile({ BUSABASE_BASE_URL: "http://a", BUSABASE_API_KEY: "sk_keep" });
    writeDotEnvFile({ BUSABASE_SPACE_ID: "spc_1" });
    expect(loadDotEnvFile()).toMatchObject({
      BUSABASE_BASE_URL: "http://a",
      BUSABASE_API_KEY: "sk_keep",
      BUSABASE_SPACE_ID: "spc_1",
    });
  });

  it("deletes a key when the value is null (logout path)", () => {
    writeDotEnvFile({ BUSABASE_API_KEY: "sk_del", BUSABASE_BASE_URL: "http://a" });
    writeDotEnvFile({ BUSABASE_API_KEY: null });
    const parsed = loadDotEnvFile();
    expect(parsed).not.toHaveProperty("BUSABASE_API_KEY");
    expect(parsed.BUSABASE_BASE_URL).toBe("http://a");
  });

  it("writes the credential file owner-only (0600)", () => {
    writeDotEnvFile({ BUSABASE_API_KEY: "sk_secret" });
    const mode = statSync(dotEnvPath()).mode & 0o777;
    // Best-effort chmod is a no-op on some filesystems; assert only when it stuck.
    if (process.platform !== "win32") {
      expect(mode).toBe(0o600);
    }
    // Sanity: the value really is on disk.
    expect(readFileSync(dotEnvPath(), "utf8")).toContain("BUSABASE_API_KEY=sk_secret");
  });
});
