import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  collectProfileStatus,
  findSpace,
  renderAuthStatus,
  runAuthConfigSet,
  runAuthSwitch,
  runSpaceUse,
  type VerifiedAuth,
} from "./auth";
import {
  currentProfileName,
  dotEnvPath,
  ensureProfilesInitialized,
  profilePath,
  readEnvFileAt,
  resetActiveCredentialTarget,
  resolveCredentialTarget,
  setActiveCredentialTarget,
  setCurrentProfile,
  writeDotEnvFile,
} from "./config-file";

/**
 * Account and space selection. Two things must hold for the feature to be worth
 * anything: switching accounts has to move the `.env` mirror (or the skill and the
 * docs' curl snippets keep talking to the old account), and switching spaces has
 * to land in the active profile only — a space stored globally would hand one
 * account's key another account's space and 403.
 */

let home: string;
let originalHome: string | undefined;

beforeEach(async () => {
  originalHome = process.env.HOME;
  delete process.env.BUSABASE_PROFILE;
  delete process.env.BUSABASE_CONFIG;
  home = await mkdtemp(join(tmpdir(), "busabase-auth-"));
  process.env.HOME = home;
  resetActiveCredentialTarget();
});

afterEach(async () => {
  process.env.HOME = originalHome;
  resetActiveCredentialTarget();
  await rm(home, { force: true, recursive: true });
});

const useTarget = (selector: { profile?: string; config?: string } = {}): void => {
  setActiveCredentialTarget(resolveCredentialTarget(selector));
};

/** Two accounts on the same Cloud host, plus one self-hosted — the real mix. */
const seedProfiles = (): void => {
  writeDotEnvFile({
    BUSABASE_BASE_URL: "https://cloud.test",
    BUSABASE_API_KEY: "sk_kelly",
    BUSABASE_SPACE_ID: "spc_kelly",
  });
  ensureProfilesInitialized();
  useTarget({ profile: "work" });
  writeDotEnvFile({
    BUSABASE_BASE_URL: "https://cloud.test",
    BUSABASE_API_KEY: "sk_work",
    BUSABASE_SPACE_ID: "spc_work",
  });
  useTarget({ profile: "local" });
  writeDotEnvFile({ BUSABASE_BASE_URL: "http://localhost:15419" });
  resetActiveCredentialTarget();
};

const cloudAuth: VerifiedAuth = {
  space: { id: "spc_kelly", name: "Kelly", slug: "kelly" },
  spaces: [
    { id: "spc_kelly", name: "Kelly", slug: "kelly" },
    { id: "spc_vf", name: "VideoFactory", slug: "video-factory" },
  ],
};

describe("collectProfileStatus", () => {
  it("classifies credentials and marks exactly one profile active", () => {
    seedProfiles();
    const statuses = collectProfileStatus();

    expect(statuses.map((s) => s.profile).sort()).toEqual(["default", "local", "work"]);
    expect(statuses.filter((s) => s.active)).toHaveLength(1);
    expect(statuses.find((s) => s.profile === "default")?.active).toBe(true);
    expect(statuses.find((s) => s.profile === "work")?.credential).toBe("api_key");
    // A local open server needs no credential at all.
    expect(statuses.find((s) => s.profile === "local")?.credential).toBe("none");
  });

  it("reports an OAuth profile with its expiry", () => {
    writeDotEnvFile({
      BUSABASE_BASE_URL: "https://cloud.test",
      BUSABASE_API_KEY: "oauth_token",
      BUSABASE_TOKEN_EXPIRES_AT: new Date(Date.now() + 86_400_000).toISOString(),
    });
    const [status] = collectProfileStatus();
    expect(status.credential).toBe("oauth");
    expect(renderAuthStatus([status])).toMatch(/OAuth, expires in/);
  });
});

describe("renderAuthStatus", () => {
  it("groups by host for reading while storage stays flat", () => {
    seedProfiles();
    const rendered = renderAuthStatus(collectProfileStatus());

    expect(rendered).toContain("https://cloud.test");
    expect(rendered).toContain("http://localhost:15419");
    // Both same-host accounts appear under the one host heading.
    const cloudIndex = rendered.indexOf("https://cloud.test");
    const localIndex = rendered.indexOf("http://localhost:15419");
    expect(rendered.slice(cloudIndex, localIndex)).toContain("work");
    expect(rendered.slice(cloudIndex, localIndex)).toContain("default");
    expect(rendered).toMatch(/\* default/);
  });

  it("tells a single-account user how to add a second one", () => {
    writeDotEnvFile({ BUSABASE_BASE_URL: "https://cloud.test", BUSABASE_API_KEY: "sk_1" });
    expect(renderAuthStatus(collectProfileStatus())).toContain("login --profile");
  });
});

describe("runAuthSwitch", () => {
  it("moves the .env mirror so the skill and curl follow along", async () => {
    seedProfiles();

    await runAuthSwitch({ name: "work", interactive: false });

    expect(currentProfileName()).toBe("work");
    expect(readEnvFileAt(dotEnvPath()).BUSABASE_API_KEY).toBe("sk_work");
  });

  it("auto-picks when exactly one alternative exists", async () => {
    writeDotEnvFile({ BUSABASE_API_KEY: "sk_default" });
    ensureProfilesInitialized();
    useTarget({ profile: "work" });
    writeDotEnvFile({ BUSABASE_API_KEY: "sk_work" });
    resetActiveCredentialTarget();

    const summary = await runAuthSwitch({ interactive: false });

    expect(summary.profile).toBe("work");
    expect(currentProfileName()).toBe("work");
  });

  it("refuses to guess when several alternatives exist and there's no TTY", async () => {
    seedProfiles();
    await expect(runAuthSwitch({ interactive: false })).rejects.toThrow(/Several profiles/);
  });

  it("changes only the space when given --space-id alone", async () => {
    seedProfiles();

    const summary = await runAuthSwitch({ spaceId: "spc_other", interactive: false });

    expect(summary.status).toBe("space changed");
    expect(currentProfileName()).toBe("default");
    expect(readEnvFileAt(profilePath("default")).BUSABASE_SPACE_ID).toBe("spc_other");
    expect(readEnvFileAt(dotEnvPath()).BUSABASE_SPACE_ID).toBe("spc_other");
    // The other account's space is untouched.
    expect(readEnvFileAt(profilePath("work")).BUSABASE_SPACE_ID).toBe("spc_work");
  });
});

describe("findSpace", () => {
  const entries = [
    { id: "spc_kelly", name: "Kelly", slug: "kelly", active: true },
    { id: "spc_vf", name: "VideoFactory", slug: "video-factory", active: false },
  ];

  it("matches by id, slug, and name (case-insensitively)", () => {
    expect(findSpace(entries, "spc_vf").id).toBe("spc_vf");
    expect(findSpace(entries, "video-factory").id).toBe("spc_vf");
    expect(findSpace(entries, "videofactory").id).toBe("spc_vf");
  });

  it("fails loudly on an unknown space, listing what is available", () => {
    expect(() => findSpace(entries, "nope")).toThrow(/Kelly, VideoFactory/);
  });
});

describe("runSpaceUse", () => {
  it("retargets the active profile and mirrors it, leaving the credential alone", async () => {
    seedProfiles();
    setCurrentProfile("work");
    useTarget();

    const summary = await runSpaceUse({
      auth: cloudAuth,
      targetedSpaceId: "spc_kelly",
      selector: "VideoFactory",
      interactive: false,
    });

    expect(summary.spaceId).toBe("spc_vf");
    expect(readEnvFileAt(profilePath("work")).BUSABASE_SPACE_ID).toBe("spc_vf");
    expect(readEnvFileAt(dotEnvPath()).BUSABASE_SPACE_ID).toBe("spc_vf");
    // Same account throughout — no re-login happened.
    expect(readEnvFileAt(profilePath("work")).BUSABASE_API_KEY).toBe("sk_work");
    // The other account keeps its own space.
    expect(readEnvFileAt(profilePath("default")).BUSABASE_SPACE_ID).toBe("spc_kelly");
  });

  it("rejects a space the account cannot see, instead of 403-ing later", async () => {
    seedProfiles();
    useTarget();
    await expect(
      runSpaceUse({ auth: cloudAuth, selector: "spc_someone_else", interactive: false }),
    ).rejects.toThrow(/No space named/);
  });

  it("auto-selects the only space on a self-hosted server", async () => {
    writeDotEnvFile({ BUSABASE_BASE_URL: "http://localhost:15419" });
    useTarget();
    const selfHosted: VerifiedAuth = {
      space: { id: "spc_local", name: "Local", slug: null },
      spaces: [{ id: "spc_local", name: "Local", slug: null }],
    };

    const summary = await runSpaceUse({ auth: selfHosted, interactive: false });

    expect(summary.spaceId).toBe("spc_local");
    expect(readEnvFileAt(dotEnvPath()).BUSABASE_SPACE_ID).toBe("spc_local");
  });

  it("refuses to guess between several spaces without a TTY", async () => {
    seedProfiles();
    useTarget();
    await expect(runSpaceUse({ auth: cloudAuth, interactive: false })).rejects.toThrow(
      /Several spaces/,
    );
  });
});

describe("runAuthConfigSet", () => {
  it("rejects an unknown setting and an invalid value", () => {
    expect(() => runAuthConfigSet("nope", "x")).toThrow(/Unknown setting/);
    expect(() => runAuthConfigSet("output", "yaml")).toThrow(/Invalid output/);
  });

  it("saves a valid preference", () => {
    expect(runAuthConfigSet("output", "json")).toMatchObject({ status: "saved", output: "json" });
  });
});
