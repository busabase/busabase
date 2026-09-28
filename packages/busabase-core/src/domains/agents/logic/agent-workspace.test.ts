import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { prepareAgentWorkspace } from "./agent-workspace";
import { buildAgentWorkspaceGuide } from "./agent-workspace-guide";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

describe("prepareAgentWorkspace", () => {
  it("does not create a host workspace for remote Buda sessions", async () => {
    const homeDir = join(tmpdir(), `missing-busabase-home-${Date.now()}`);

    await expect(prepareAgentWorkspace("remote-websocket", "space-123", homeDir)).resolves.toBe(
      "/",
    );
    await expect(access(homeDir)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("keeps the stable seeded workspace for local subprocess agents", async () => {
    const homeDir = await mkdtemp(join(tmpdir(), "busabase-agent-workspace-"));
    temporaryDirectories.push(homeDir);

    const workspace = await prepareAgentWorkspace("local-subprocess", "space-123", homeDir);

    expect(workspace).toBe(join(homeDir, ".busabase", "agent-workspaces", "space-123"));
    await expect(readFile(join(workspace, ".claude", "settings.json"), "utf8")).resolves.toContain(
      '"defaultMode": "default"',
    );
    await expect(readFile(join(workspace, "CLAUDE.md"), "utf8")).resolves.toContain(
      "<!-- workspace: space-123 -->",
    );
  });

  it("writes the same guide for Claude Code, Codex, and Gemini", async () => {
    const homeDir = await mkdtemp(join(tmpdir(), "busabase-agent-workspace-"));
    temporaryDirectories.push(homeDir);

    const workspace = await prepareAgentWorkspace("local-subprocess", "space-123", homeDir);
    const [claude, agents, gemini] = await Promise.all(
      ["CLAUDE.md", "AGENTS.md", "GEMINI.md"].map((file) =>
        readFile(join(workspace, file), "utf8"),
      ),
    );

    expect(claude).toBe(buildAgentWorkspaceGuide("space-123"));
    expect(agents).toBe(claude);
    expect(gemini).toBe(claude);
  });
});
