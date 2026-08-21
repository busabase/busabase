import { mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { AgentTransport } from "busabase-contract/domains/agents/types";
import { buildAgentWorkspaceGuide } from "./agent-workspace-guide";

/**
 * Force a conservative default permission mode for Claude Code sessions,
 * regardless of the user's own global `~/.claude/settings.json`.
 *
 * Verified empirically (2026-08-13), not assumed: on a machine whose global
 * Claude Code config had no explicit `permissions.defaultMode`, the ACP
 * adapter still let a Bash `echo` run without asking (its own allow-rules
 * treat some commands as safe) — expected. But without this file, a machine
 * whose global config sets a permissive mode (`acceptEdits`/`bypassPermissions`,
 * common for a developer's own daily-driver terminal use) would carry that
 * straight into every Busabase-spawned session, silently defeating the
 * permission cards this domain exists to show. Writing an explicit
 * project-level override is what makes "every request blocks and asks" a
 * guarantee Busabase controls, not something borrowed from whatever the host
 * machine happens to have configured for unrelated work.
 */
async function seedClaudeSettings(dir: string): Promise<void> {
  const claudeDir = join(dir, ".claude");
  await mkdir(claudeDir, { recursive: true });
  await writeFile(
    join(claudeDir, "settings.json"),
    `${JSON.stringify({ permissions: { defaultMode: "default" } }, null, 2)}\n`,
  );
}

/**
 * Local subprocess agents require a real, stable absolute `cwd`: their ACP
 * adapters stat it, load project instructions from it, and key resumable state
 * by it. Busabase therefore owns one scratch directory per space.
 *
 * Remote Buda sessions are different. Buda runs in its own sandbox and
 * intentionally ignores the connecting client's `cwd` and `mcpServers`, so
 * creating a host-side workspace is both unnecessary and incorrect on Cloud.
 * Returning `/` satisfies ACP's absolute-path shape without touching the Cloud
 * container's non-writable home directory.
 */
export async function prepareAgentWorkspace(
  transport: AgentTransport,
  spaceId: string,
  homeDir = homedir(),
): Promise<string> {
  if (transport === "remote-websocket") return "/";

  const normalizedSpaceId = spaceId || "default";
  const dir = join(homeDir, ".busabase", "agent-workspaces", normalizedSpaceId);
  await mkdir(dir, { recursive: true });
  await seedClaudeSettings(dir);
  await writeFile(join(dir, "CLAUDE.md"), buildAgentWorkspaceGuide(normalizedSpaceId));
  return dir;
}
