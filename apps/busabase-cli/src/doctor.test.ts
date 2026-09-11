import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  type DoctorCheck,
  detectInstalledSkill,
  detectMcpConfig,
  hasFailure,
  inferEdition,
  inspectEnvFile,
  inspectJsonFile,
  renderDoctor,
  summarize,
} from "./doctor.js";

/** Build an in-memory filesystem for the pure inspectors. */
const fs = (files: Record<string, string>) => ({
  exists: (p: string) => p in files,
  read: (p: string) => {
    const body = files[p];
    if (body === undefined) throw new Error("ENOENT");
    if (body === "\0UNREADABLE") throw new Error("EACCES: permission denied");
    return body;
  },
});

const check = (over: Partial<DoctorCheck> = {}): DoctorCheck => ({
  id: "x",
  label: "X",
  state: "ok",
  probe: "local",
  detail: "",
  ...over,
});

describe("inspectEnvFile", () => {
  it("distinguishes a missing file from an empty one", () => {
    // The rest of the CLI collapses both into `{}`; a diagnostic must not.
    expect(inspectEnvFile("/x/.env", fs({})).state).toBe("missing");
    expect(inspectEnvFile("/x/.env", fs({ "/x/.env": "\n# just a comment\n" })).state).toBe(
      "empty",
    );
  });

  it("reports a file it cannot read as unreadable, not as absent", () => {
    const report = inspectEnvFile("/x/.env", fs({ "/x/.env": "\0UNREADABLE" }));
    expect(report.state).toBe("unreadable");
    expect(report.error).toMatch(/EACCES/);
  });

  it("lists the keys it found so the user can see what is actually stored", () => {
    const report = inspectEnvFile(
      "/x/.env",
      fs({ "/x/.env": "# c\nBUSABASE_API_KEY=sk_1\nBUSABASE_BASE_URL=https://h\n" }),
    );
    expect(report.state).toBe("present");
    expect(report.keys).toEqual(["BUSABASE_API_KEY", "BUSABASE_BASE_URL"]);
  });
});

describe("inspectJsonFile", () => {
  it("calls malformed JSON unreadable rather than pretending the file is absent", () => {
    const report = inspectJsonFile("/x/c.json", fs({ "/x/c.json": "{ not json" }));
    expect(report.state).toBe("unreadable");
    expect(report.error).toBeTruthy();
  });

  it("rejects a JSON array or scalar — the callers all expect an object", () => {
    expect(inspectJsonFile("/x/c.json", fs({ "/x/c.json": "[1,2]" })).state).toBe("unreadable");
  });

  it("separates a permission error from a parse error — both are 'unreadable', neither is 'missing'", () => {
    // A root-owned ~/.claude.json is the realistic case, and calling it absent
    // would send the user looking for a file that is sitting right there.
    const report = inspectJsonFile("/x/c.json", fs({ "/x/c.json": "\0UNREADABLE" }));
    expect(report.state).toBe("unreadable");
    expect(report.error).toMatch(/EACCES/);
  });

  it("parses an object and exposes it", () => {
    const report = inspectJsonFile("/x/c.json", fs({ "/x/c.json": '{"currentProfile":"work"}' }));
    expect(report.state).toBe("present");
    expect(report.parsed).toEqual({ currentProfile: "work" });
  });
});

describe("inferEdition", () => {
  const isLocalHost = (url: string) => url.includes("localhost") || url.includes("127.0.0.1");

  it("calls a loopback host local, and says that is why", () => {
    const guess = inferEdition({ baseUrl: "http://localhost:15419", health: {}, isLocalHost });
    expect(guess.edition).toBe("local");
    expect(guess.because).toMatch(/loopback/);
  });

  it("reads a version field as Cloud, and keeps the caveat with the verdict", () => {
    const guess = inferEdition({
      baseUrl: "https://busabase.com",
      health: { version: "0.11.0" },
      isLocalHost,
    });
    expect(guess).toMatchObject({ edition: "cloud", serverVersion: "0.11.0" });
    expect(guess.because).toMatch(/version field/);
  });

  it("treats a version-less remote host as self-hosted, admitting it is ambiguous", () => {
    const guess = inferEdition({ baseUrl: "https://busa.internal", health: {}, isLocalHost });
    expect(guess.edition).toBe("local");
    expect(guess.because).toMatch(/identical/);
  });

  it("refuses to guess when the server said nothing at all", () => {
    const guess = inferEdition({ baseUrl: "https://busa.internal", health: null, isLocalHost });
    expect(guess.edition).toBe("unknown");
    expect(guess.serverVersion).toBeUndefined();
  });
});

describe("detectInstalledSkill", () => {
  const cwd = "/work/repo";
  const home = "/home/kelly";

  it("finds a project-scoped skill", () => {
    const p = join(cwd, ".agents/skills/busabase/SKILL.md");
    expect(detectInstalledSkill({ cwd, home, exists: (x) => x === p })).toMatchObject({
      found: true,
      paths: [p],
    });
  });

  it("finds a home-scoped skill when the project has none", () => {
    const p = join(home, ".claude/skills/busabase/SKILL.md");
    expect(detectInstalledSkill({ cwd, home, exists: (x) => x === p }).paths).toEqual([p]);
  });

  it("reports both when a project copy and a global copy coexist", () => {
    // Two copies is a real state worth surfacing — they can disagree.
    const a = join(cwd, ".agents/skills/busabase/SKILL.md");
    const b = join(home, ".claude/skills/busabase/SKILL.md");
    expect(detectInstalledSkill({ cwd, home, exists: (x) => x === a || x === b }).paths).toEqual([
      a,
      b,
    ]);
  });

  it("reports one file once when cwd is the home directory", () => {
    // Running `doctor` from ~ collapses the project and global candidates onto
    // the same path; listing it twice reads as two installs that might disagree.
    const p = join(home, ".agents/skills/busabase/SKILL.md");
    expect(detectInstalledSkill({ cwd: home, home, exists: (x) => x === p }).paths).toEqual([p]);
  });

  it("reports not-found rather than guessing", () => {
    const found = detectInstalledSkill({ cwd, home, exists: () => false });
    expect(found).toMatchObject({ found: false, paths: [] });
    expect(found.version).toBeUndefined();
  });
});

describe("detectMcpConfig", () => {
  const cwd = "/work/repo";
  const home = "/home/kelly";
  const inspect = (files: Record<string, string>) => (p: string) => inspectJsonFile(p, fs(files));

  it("finds a top-level mcpServers entry", () => {
    const detected = detectMcpConfig({
      cwd,
      home,
      inspect: inspect({ "/work/repo/.mcp.json": '{"mcpServers":{"busabase":{"url":"x"}}}' }),
    });
    expect(detected).toMatchObject({ found: true, paths: ["/work/repo/.mcp.json"] });
  });

  it("finds one nested under Claude Code's per-project shape", () => {
    // ~/.claude.json keeps project servers under projects.<dir>.mcpServers, so
    // looking only at the top level would report a configured host as missing.
    const detected = detectMcpConfig({
      cwd,
      home,
      inspect: inspect({
        "/home/kelly/.claude.json": '{"projects":{"/work/repo":{"mcpServers":{"busabase":{}}}}}',
      }),
    });
    expect(detected.found).toBe(true);
  });

  it("does not count some other server as Busabase", () => {
    const detected = detectMcpConfig({
      cwd,
      home,
      inspect: inspect({ "/work/repo/.mcp.json": '{"mcpServers":{"github":{}}}' }),
    });
    expect(detected.found).toBe(false);
  });

  it("reports a corrupt config as broken instead of throwing or ignoring it", () => {
    const detected = detectMcpConfig({
      cwd,
      home,
      inspect: inspect({ "/work/repo/.mcp.json": "{oops" }),
    });
    expect(detected.found).toBe(false);
    expect(detected.broken).toHaveLength(1);
    expect(detected.broken[0].path).toBe("/work/repo/.mcp.json");
  });

  it("always names the places it looked, so absence reads as the narrow claim it is", () => {
    const detected = detectMcpConfig({ cwd, home, inspect: inspect({}) });
    expect(detected.searched).toEqual(["/home/kelly/.claude.json", "/work/repo/.mcp.json"]);
  });
});

describe("aggregation", () => {
  it("counts each state", () => {
    expect(
      summarize([
        check({ state: "ok" }),
        check({ state: "warn" }),
        check({ state: "warn" }),
        check({ state: "fail" }),
        check({ state: "n-a" }),
      ]),
    ).toEqual({ ok: 1, warn: 2, fail: 1, na: 1 });
  });

  it("fails the command only on a real fault, not on warnings", () => {
    expect(hasFailure([check({ state: "warn" }), check({ state: "n-a" })])).toBe(false);
    expect(hasFailure([check({ state: "fail" })])).toBe(true);
  });
});

describe("renderDoctor", () => {
  it("never renders a not-checked item as a pass", () => {
    // The whole trust model rests on this: `–` for unknown, never `✓`.
    const text = renderDoctor({
      checks: [check({ label: "MCP", state: "n-a", probe: "skipped", detail: "not looked at" })],
      summary: summarize([check({ state: "n-a" })]),
    });
    expect(text).toContain("– MCP");
    expect(text).not.toContain("✓ MCP");
  });

  it("labels how each finding was obtained", () => {
    const text = renderDoctor({
      checks: [
        check({ label: "Stored", probe: "local", detail: "a key" }),
        check({ label: "Live", probe: "live", detail: "accepted" }),
      ],
      summary: summarize([check(), check()]),
    });
    expect(text).toContain("[read locally]");
    expect(text).toContain("[checked against the server]");
  });

  it("prints the fix under anything that needs one", () => {
    const text = renderDoctor({
      checks: [check({ state: "fail", detail: "down", fix: "busabase-cli login" })],
      summary: summarize([check({ state: "fail" })]),
    });
    expect(text).toContain("→ busabase-cli login");
  });

  it("only calls the machine ready when nothing is wrong or warned about", () => {
    const clean = renderDoctor({ checks: [check()], summary: summarize([check()]) });
    expect(clean).toContain("ready to use Busabase");
    const warned = renderDoctor({
      checks: [check({ state: "warn" })],
      summary: summarize([check({ state: "warn" })]),
    });
    expect(warned).not.toContain("ready to use Busabase");
  });
});
