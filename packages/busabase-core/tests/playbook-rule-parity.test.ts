import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { renderPluginSkill } from "../../../scripts/busabase-skills-plugin/render";
import { buildAgentWorkspaceGuide } from "../src/domains/agents/logic/agent-workspace-guide";
import {
  BUSABASE_MCP_INSTRUCTIONS,
  BUSABASE_SELF_HOSTED_MCP_INSTRUCTIONS,
  buildBusabaseMcpSkill,
} from "../src/mcp-skill";
import { PLAYBOOK_RULE_HEADING, PLAYBOOK_RULE_MARKDOWN } from "../src/playbook-rule";
import { buildSkillMarkdown } from "../src/skill-doc";

/**
 * One "find the playbook first" rule, word for word, on every agent surface
 * (spec `agent-playbook-discovery.md` §7). The three generated surfaces interpolate the
 * constant; the hand-written repo skill carries a copy — this is what stops that copy drifting.
 */

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const repoSkill = readFileSync(resolve(repoRoot, ".agents/skills/busabase/SKILL.md"), "utf8");
// The MCP-first skill both public agent plugins bundle (github.com/busabase/skills
// claude/skills/busabase and plugins/busabase/skills/busabase), generated from one source.
const pluginSkills = {
  claude: renderPluginSkill("claude"),
  codex: renderPluginSkill("codex"),
};

const surfaces: [string, string][] = [
  ["/SETUP_SKILL.md (cloud)", buildSkillMarkdown("https://busabase.com", { mode: "cloud" })],
  ["/SETUP_SKILL.md (local)", buildSkillMarkdown("http://localhost:15419", { mode: "local" })],
  ["MCP instructions (cloud)", BUSABASE_MCP_INSTRUCTIONS],
  ["MCP instructions (self-hosted)", BUSABASE_SELF_HOSTED_MCP_INSTRUCTIONS],
  ["busabase://skill", buildBusabaseMcpSkill()],
  // Written verbatim as CLAUDE.md, AGENTS.md (Codex), and GEMINI.md — see
  // AGENT_WORKSPACE_GUIDE_FILES in agent-workspace.ts.
  ["agent workspace CLAUDE.md / AGENTS.md / GEMINI.md", buildAgentWorkspaceGuide("space-123")],
  [".agents/skills/busabase/SKILL.md", repoSkill],
  ["Claude Code plugin busabase skill", pluginSkills.claude],
  ["Codex plugin busabase skill", pluginSkills.codex],
];

describe("playbook rule parity", () => {
  it("opens with the canonical sentence", () => {
    expect(PLAYBOOK_RULE_MARKDOWN.startsWith(PLAYBOOK_RULE_HEADING)).toBe(true);
    expect(PLAYBOOK_RULE_HEADING).toBe("**Before you work anything out, look for a playbook.**");
  });

  it.each(surfaces)("%s carries the whole rule verbatim", (_name, doc) => {
    expect(doc).toContain(PLAYBOOK_RULE_MARKDOWN);
  });

  it.each(surfaces)("%s states the rule before the write rules", (_name, doc) => {
    // The rule is the first step of every instruction, so it has to be read before any
    // section that tells the agent how to write.
    const rule = doc.indexOf(PLAYBOOK_RULE_HEADING);
    const firstWriteRule = Math.min(
      ...["Write for the reviewer", "Writes go through Change Requests", "## The one rule"]
        .map((marker) => doc.indexOf(marker))
        .filter((index) => index >= 0),
    );
    expect(rule).toBeGreaterThanOrEqual(0);
    expect(rule).toBeLessThan(firstWriteRule);
  });

  it("names the real calls on each surface", () => {
    expect(BUSABASE_MCP_INSTRUCTIONS).toContain("`playbooks_search`");
    expect(BUSABASE_MCP_INSTRUCTIONS).toContain("`playbooks_get`");
    expect(buildAgentWorkspaceGuide("s")).toContain("`playbooks_search`");
    expect(buildSkillMarkdown("http://localhost:15419", { mode: "local" })).toContain(
      "/api/v1/playbooks/search",
    );
    expect(repoSkill).toContain("busabase-cli playbooks search --query");
    for (const doc of Object.values(pluginSkills)) {
      expect(doc).toContain("`playbooks_search`");
      expect(doc).toContain("`playbooks_get`");
    }
  });

  it("never says custom prompts replace the node type's built-ins", () => {
    // They are appended (node-agent-prompts.ts); the old wording taught agents to avoid
    // writing any, for fear of wiping the defaults.
    for (const [, doc] of surfaces) {
      expect(doc).not.toMatch(/prompts? (REPLACE|replace) (that node type's|the type's)/);
    }
  });
});
