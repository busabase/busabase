import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  configJsonPath,
  currentProfileName,
  dotEnvPath,
  ensureProfilesInitialized,
  isMultiProfile,
  listProfileNames,
  loadConfigFile,
  loadDotEnvFile,
  PROFILE_KEY,
  profilePath,
  profilesDir,
  readEnvFileAt,
  readProfile,
  removeProfile,
  resetActiveCredentialTarget,
  resolveCredentialTarget,
  setActiveCredentialTarget,
  setCurrentProfile,
  writeConfigFile,
  writeDotEnvFile,
} from "./config-file";

/**
 * `~/.busabase/.env` is the credential store every CLI/SDK call and the installed
 * skill read from, so its parse/merge/permission behaviour is load-bearing: a bad
 * merge could drop a token, and a world-readable rewrite would leak one. HOME is
 * redirected to a scratch dir so these never touch a real developer credential.
 */

let home: string;
let originalHome: string | undefined;
let originalProfileEnv: string | undefined;
let originalConfigEnv: string | undefined;

beforeEach(async () => {
  originalHome = process.env.HOME;
  originalProfileEnv = process.env.BUSABASE_PROFILE;
  originalConfigEnv = process.env.BUSABASE_CONFIG;
  process.env.BUSABASE_PROFILE = undefined;
  process.env.BUSABASE_CONFIG = undefined;
  delete process.env.BUSABASE_PROFILE;
  delete process.env.BUSABASE_CONFIG;
  home = await mkdtemp(join(tmpdir(), "busabase-cfg-"));
  process.env.HOME = home;
  resetActiveCredentialTarget();
});

afterEach(async () => {
  process.env.HOME = originalHome;
  if (originalProfileEnv === undefined) delete process.env.BUSABASE_PROFILE;
  else process.env.BUSABASE_PROFILE = originalProfileEnv;
  if (originalConfigEnv === undefined) delete process.env.BUSABASE_CONFIG;
  else process.env.BUSABASE_CONFIG = originalConfigEnv;
  resetActiveCredentialTarget();
  await rm(home, { force: true, recursive: true });
});

/** Re-pin the process target the way a real command does after parsing flags. */
const useTarget = (selector: { profile?: string; config?: string } = {}): void => {
  setActiveCredentialTarget(resolveCredentialTarget(selector));
};

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

/**
 * Multi-account behaviour. The load-bearing promise is that a single-account
 * install is untouched — no new files, no new keys — until a second account is
 * actually created, and that from then on `config.json` alone decides who is
 * active (never a stray file or the mirror line inside `.env`).
 */
describe("single-account mode (no config.json)", () => {
  it("reports the implicit default profile and creates nothing extra", () => {
    writeDotEnvFile({ BUSABASE_BASE_URL: "http://a", BUSABASE_API_KEY: "sk_1" });

    expect(isMultiProfile()).toBe(false);
    expect(currentProfileName()).toBe("default");
    expect(listProfileNames()).toEqual(["default"]);
    expect(existsSync(configJsonPath())).toBe(false);
    expect(existsSync(profilesDir())).toBe(false);
  });

  it("keeps .env free of the mirror field, byte-for-byte like before", () => {
    writeDotEnvFile({ BUSABASE_BASE_URL: "http://a", BUSABASE_API_KEY: "sk_1" });
    expect(readFileSync(dotEnvPath(), "utf8")).toBe(
      "BUSABASE_BASE_URL=http://a\nBUSABASE_API_KEY=sk_1\n",
    );
  });

  it("serves --profile default from .env before profiles/ exists", () => {
    writeDotEnvFile({ BUSABASE_API_KEY: "sk_1" });
    useTarget({ profile: "default" });
    expect(loadDotEnvFile().BUSABASE_API_KEY).toBe("sk_1");
  });
});

describe("ensureProfilesInitialized (lazy migration)", () => {
  it("preserves the existing .env as profiles/default.env and records it active", () => {
    writeDotEnvFile({ BUSABASE_BASE_URL: "http://a", BUSABASE_API_KEY: "sk_existing" });

    ensureProfilesInitialized();

    expect(readEnvFileAt(profilePath("default"))).toEqual({
      BUSABASE_BASE_URL: "http://a",
      BUSABASE_API_KEY: "sk_existing",
    });
    expect(loadConfigFile().currentProfile).toBe("default");
    expect(isMultiProfile()).toBe(true);
  });

  it("is idempotent — a second call never clobbers the active profile", () => {
    writeDotEnvFile({ BUSABASE_API_KEY: "sk_1" });
    ensureProfilesInitialized();
    writeConfigFile({ currentProfile: "work" });

    ensureProfilesInitialized();

    expect(loadConfigFile().currentProfile).toBe("work");
  });
});

describe("profile switching", () => {
  /** Two accounts on the SAME host — the case a host-keyed store cannot express. */
  const seedTwoProfiles = (): void => {
    writeDotEnvFile({ BUSABASE_BASE_URL: "https://cloud.test", BUSABASE_API_KEY: "sk_default" });
    ensureProfilesInitialized();
    useTarget({ profile: "work" });
    writeDotEnvFile({
      BUSABASE_BASE_URL: "https://cloud.test",
      BUSABASE_API_KEY: "sk_work",
      BUSABASE_SPACE_ID: "spc_work",
    });
    resetActiveCredentialTarget();
  };

  it("materialises the chosen profile into the .env mirror", () => {
    seedTwoProfiles();

    setCurrentProfile("work");

    const mirror = readEnvFileAt(dotEnvPath());
    expect(mirror.BUSABASE_API_KEY).toBe("sk_work");
    expect(mirror.BUSABASE_SPACE_ID).toBe("spc_work");
    // The mirror advertises who it holds, for anyone who `source`s it.
    expect(mirror[PROFILE_KEY]).toBe("work");
  });

  it("switches back without losing the first account", () => {
    seedTwoProfiles();
    setCurrentProfile("work");

    setCurrentProfile("default");

    expect(readEnvFileAt(dotEnvPath()).BUSABASE_API_KEY).toBe("sk_default");
    expect(readProfile("work").BUSABASE_API_KEY).toBe("sk_work");
  });

  it("treats config.json as the only authority, ignoring a tampered mirror line", () => {
    seedTwoProfiles();
    setCurrentProfile("work");

    // Hand-edit the mirror field to lie about who is active.
    writeFileSync(dotEnvPath(), `${PROFILE_KEY}=default\nBUSABASE_API_KEY=sk_work\n`);

    expect(currentProfileName()).toBe("work");
  });

  it("never stores the mirror field inside a profile file", () => {
    seedTwoProfiles();
    setCurrentProfile("work");

    expect(readEnvFileAt(profilePath("work"))).not.toHaveProperty(PROFILE_KEY);
  });

  it("rejects switching to a profile that does not exist", () => {
    seedTwoProfiles();
    expect(() => setCurrentProfile("nope")).toThrow(/Unknown profile/);
  });

  it("rejects a path-traversing profile name", () => {
    expect(() => setCurrentProfile("../../etc/passwd")).toThrow(/Invalid profile name/);
  });
});

describe("credential target resolution", () => {
  const seedTwoProfiles = (): void => {
    writeDotEnvFile({ BUSABASE_API_KEY: "sk_default" });
    ensureProfilesInitialized();
    useTarget({ profile: "work" });
    writeDotEnvFile({ BUSABASE_API_KEY: "sk_work" });
    resetActiveCredentialTarget();
  };

  it("reads a non-active profile straight from its file, bypassing .env", () => {
    seedTwoProfiles();
    useTarget({ profile: "work" });
    expect(loadDotEnvFile().BUSABASE_API_KEY).toBe("sk_work");
    // .env still belongs to the active account — two terminals can't trip over each other.
    expect(readEnvFileAt(dotEnvPath()).BUSABASE_API_KEY).toBe("sk_default");
  });

  it("writes to a non-active profile without disturbing the mirror", () => {
    seedTwoProfiles();
    useTarget({ profile: "work" });

    writeDotEnvFile({ BUSABASE_API_KEY: "sk_work_rotated" });

    expect(readEnvFileAt(profilePath("work")).BUSABASE_API_KEY).toBe("sk_work_rotated");
    expect(readEnvFileAt(dotEnvPath()).BUSABASE_API_KEY).toBe("sk_default");
  });

  it("echoes a mirror-mode write back into the active profile (token rotation)", () => {
    seedTwoProfiles();
    setCurrentProfile("work");
    useTarget();

    // What maybeAutoRefresh does: rotate the credential through the default target.
    writeDotEnvFile({ BUSABASE_API_KEY: "sk_rotated" });

    expect(readEnvFileAt(dotEnvPath()).BUSABASE_API_KEY).toBe("sk_rotated");
    // Without this, switching away and back would resurrect the stale token.
    expect(readEnvFileAt(profilePath("work")).BUSABASE_API_KEY).toBe("sk_rotated");
  });

  it("honours BUSABASE_PROFILE from the environment", () => {
    seedTwoProfiles();
    process.env.BUSABASE_PROFILE = "work";
    resetActiveCredentialTarget();
    expect(loadDotEnvFile().BUSABASE_API_KEY).toBe("sk_work");
  });

  it("--config points at an arbitrary file and bypasses profiles entirely", () => {
    seedTwoProfiles();
    const external = join(home, "elsewhere.env");
    writeFileSync(external, "BUSABASE_API_KEY=sk_external\n");

    useTarget({ config: external });
    expect(loadDotEnvFile().BUSABASE_API_KEY).toBe("sk_external");

    writeDotEnvFile({ BUSABASE_SPACE_ID: "spc_ext" });
    expect(readEnvFileAt(external).BUSABASE_SPACE_ID).toBe("spc_ext");
    // Neither the mirror nor any profile was touched.
    expect(readEnvFileAt(dotEnvPath()).BUSABASE_API_KEY).toBe("sk_default");
    expect(readEnvFileAt(external)).not.toHaveProperty(PROFILE_KEY);
  });
});

describe("removeProfile", () => {
  it("refuses to delete the active profile", () => {
    writeDotEnvFile({ BUSABASE_API_KEY: "sk_1" });
    ensureProfilesInitialized();
    expect(() => removeProfile("default")).toThrow(/active profile/);
  });

  it("deletes an inactive profile", () => {
    writeDotEnvFile({ BUSABASE_API_KEY: "sk_default" });
    ensureProfilesInitialized();
    useTarget({ profile: "work" });
    writeDotEnvFile({ BUSABASE_API_KEY: "sk_work" });
    resetActiveCredentialTarget();

    removeProfile("work");

    expect(existsSync(profilePath("work"))).toBe(false);
    expect(listProfileNames()).toEqual(["default"]);
  });
});

describe("config.json settings", () => {
  it("stores a preference without dragging the install into multi-account mode", () => {
    writeConfigFile({ output: "json" });
    expect(loadConfigFile().output).toBe("json");
    expect(isMultiProfile()).toBe(false);
    expect(existsSync(profilesDir())).toBe(false);
  });

  it("survives a malformed file by falling back to defaults", () => {
    writeConfigFile({ output: "json" });
    writeFileSync(configJsonPath(), "{ not json");
    expect(loadConfigFile()).toEqual({});
    expect(currentProfileName()).toBe("default");
  });
});
