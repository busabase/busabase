import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildRuntimeSkillDoc,
  fetchSetupSkill,
  installSkillDoc,
  parseSkillTopic,
  resolveSkillDocument,
  resolveSkillMode,
  resolveSkillsDir,
} from "./skill-command.js";

const CLOUD = { baseUrl: "https://busabase.com", mode: "cloud" as const };
const never = (() => {
  throw new Error("must not reach the network");
}) as unknown as typeof fetch;

/** A response good enough for the code under test, without pulling in a real server. */
const reply = (status: number, body: string): Response =>
  ({ ok: status >= 200 && status < 300, status, text: async () => body }) as Response;

describe("parseSkillTopic", () => {
  it("defaults to the everyday skill when no topic is given", () => {
    expect(parseSkillTopic(undefined)).toBe("busabase");
  });

  it("accepts the setup topic, whatever the casing", () => {
    expect(parseSkillTopic("setup")).toBe("setup");
    expect(parseSkillTopic("  SETUP ")).toBe("setup");
  });

  it("names the valid topics when it rejects one, so the retry needs no guessing", () => {
    // Commander routes any non-`install` operand into the parent action, so a typo
    // arrives here rather than as an "unknown command" — this message is the only
    // thing standing between the user and a silently wrong document.
    expect(() => parseSkillTopic("workspace")).toThrow(/busabase, setup/);
  });
});

describe("resolveSkillMode", () => {
  const isLocalHost = (url: string) => url.includes("localhost");

  it("lets an explicit --mode win over everything else", () => {
    expect(
      resolveSkillMode({
        baseUrl: "https://busabase.com",
        spaceId: "local",
        override: "cloud",
        isLocalHost,
      }),
    ).toBe("cloud");
  });

  it("treats the reserved single-tenant space id as decisive", () => {
    // A self-hosted server reached over a LAN name is still local, and only the
    // space id says so — the hostname looks remote.
    expect(
      resolveSkillMode({ baseUrl: "https://busa.internal", spaceId: "local", isLocalHost }),
    ).toBe("local");
  });

  it("falls back to the host, reusing the login flow's own notion of local", () => {
    expect(resolveSkillMode({ baseUrl: "http://localhost:15419", isLocalHost })).toBe("local");
    expect(resolveSkillMode({ baseUrl: "https://busabase.com", isLocalHost })).toBe("cloud");
  });
});

describe("buildRuntimeSkillDoc", () => {
  it("keeps a real API key out of the document unless it is asked for", () => {
    const doc = buildRuntimeSkillDoc({ ...CLOUD, apiKey: undefined });
    expect(doc).toContain("YOUR_API_KEY");
    expect(doc).not.toContain("busa_live_secret");
  });

  it("interpolates the key only when one is passed in", () => {
    const doc = buildRuntimeSkillDoc({ ...CLOUD, apiKey: "busa_live_secret" });
    expect(doc).toContain("busa_live_secret");
  });

  it("drops auth and space targeting entirely for a local install", () => {
    const doc = buildRuntimeSkillDoc({ baseUrl: "http://localhost:15419", mode: "local" });
    expect(doc).not.toContain("Authorization: Bearer");
    expect(doc).toContain("http://localhost:15419");
  });
});

describe("fetchSetupSkill", () => {
  it("accepts a document that looks like one", async () => {
    const result = await fetchSetupSkill("https://busabase.com", (async () =>
      reply(200, "---\nname: busabase\n---\n# hi")) as unknown as typeof fetch);
    expect(result.content).toContain("name: busabase");
  });

  it("refuses a 200 that is not a skill document", async () => {
    // A reverse proxy or captive portal answering with an HTML login page is a real
    // failure mode; printing that as "your skill" would be worse than falling back.
    const result = await fetchSetupSkill("https://busabase.com", (async () =>
      reply(200, "<!doctype html><title>Sign in</title>")) as unknown as typeof fetch);
    expect(result.content).toBeNull();
    expect(result.reason).toMatch(/did not return a skill document/);
  });

  it("reports a non-2xx instead of throwing", async () => {
    const result = await fetchSetupSkill("https://busabase.com", (async () =>
      reply(404, "nope")) as unknown as typeof fetch);
    expect(result.content).toBeNull();
    expect(result.reason).toMatch(/HTTP 404/);
  });

  it("reports an unreachable host instead of throwing", async () => {
    const result = await fetchSetupSkill("https://busabase.com", (async () => {
      throw new Error("ECONNREFUSED");
    }) as unknown as typeof fetch);
    expect(result.content).toBeNull();
    expect(result.reason).toMatch(/unreachable/);
  });
});

describe("resolveSkillDocument", () => {
  const runtime = { offline: false, fetchImpl: never, cliVersion: "9.9.9" };

  it("never touches the network for the everyday skill", async () => {
    const resolved = await resolveSkillDocument("busabase", CLOUD, runtime);
    expect(resolved.source).toBe("embedded");
    expect(resolved.note).toBeUndefined();
    expect(resolved.content).toContain("name: busabase");
  });

  it("prefers the server's own setup document when it can be read", async () => {
    const resolved = await resolveSkillDocument("setup", CLOUD, {
      ...runtime,
      fetchImpl: (async () => reply(200, "---\nlive: yes\n---")) as unknown as typeof fetch,
    });
    expect(resolved.source).toBe("server");
    expect(resolved.content).toContain("live: yes");
    expect(resolved.note).toBeUndefined();
  });

  it("falls back to the bundled copy on an old server, and says so", async () => {
    // The self-hosted guide catalog has never served a `setup` topic, so this is the
    // ordinary case for an existing install, not an exotic one.
    const resolved = await resolveSkillDocument("setup", CLOUD, {
      ...runtime,
      fetchImpl: (async () => reply(404, "")) as unknown as typeof fetch,
    });
    expect(resolved.source).toBe("embedded");
    expect(resolved.content.length).toBeGreaterThan(0);
    expect(resolved.note).toMatch(/bundled with busabase-cli 9\.9\.9/);
    expect(resolved.note).toMatch(/HTTP 404/);
  });

  it("skips the server entirely when --offline is set", async () => {
    const resolved = await resolveSkillDocument("setup", CLOUD, { ...runtime, offline: true });
    expect(resolved.source).toBe("embedded");
    expect(resolved.note).toMatch(/--offline/);
  });
});

describe("resolveSkillsDir", () => {
  const cwd = "/work/repo";
  const home = "/home/kelly";

  it("resolves an explicit relative directory against the working directory", () => {
    expect(resolveSkillsDir({ explicit: "skills", cwd, home, exists: () => false })).toBe(
      join(cwd, "skills"),
    );
  });

  it("passes an explicit absolute directory through untouched", () => {
    expect(resolveSkillsDir({ explicit: "/tmp/s", cwd, home, exists: () => false })).toBe("/tmp/s");
  });

  it("prefers an existing .agents/skills in the project over the global directory", () => {
    const exists = (p: string) => p === join(cwd, ".agents/skills");
    expect(resolveSkillsDir({ cwd, home, exists })).toBe(join(cwd, ".agents/skills"));
  });

  it("uses .claude/skills when that is the one the project keeps", () => {
    const exists = (p: string) => p === join(cwd, ".claude/skills");
    expect(resolveSkillsDir({ cwd, home, exists })).toBe(join(cwd, ".claude/skills"));
  });

  it("falls back to the user's global skills directory when the project keeps none", () => {
    expect(resolveSkillsDir({ cwd, home, exists: () => false })).toBe(
      join(home, ".claude", "skills"),
    );
  });
});

describe("installSkillDoc", () => {
  const dir = "/work/repo/.agents/skills";
  const target = join(dir, "busabase", "SKILL.md");

  it("writes the document and reports the exact path", () => {
    const written: Array<[string, string]> = [];
    const result = installSkillDoc({
      dir,
      content: "# doc",
      force: false,
      exists: () => false,
      write: (p, c) => written.push([p, c]),
    });
    expect(result).toMatchObject({ path: target, written: true });
    expect(written).toEqual([[target, "# doc\n"]]);
  });

  it("refuses to replace an existing skill, which may be one the user edited", () => {
    const result = installSkillDoc({
      dir,
      content: "# doc",
      force: false,
      exists: () => true,
      write: () => {
        throw new Error("must not write");
      },
    });
    expect(result.written).toBe(false);
    expect(result.reason).toMatch(/--force/);
  });

  it("replaces it once --force says so", () => {
    const written: Array<[string, string]> = [];
    const result = installSkillDoc({
      dir,
      content: "# doc\n",
      force: true,
      exists: () => true,
      write: (p, c) => written.push([p, c]),
    });
    expect(result.written).toBe(true);
    expect(written[0][1]).toBe("# doc\n");
  });
});
