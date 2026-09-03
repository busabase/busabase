import type { AgentCatalogEntryVO } from "busabase-contract/domains/agents/types";
import { describe, expect, it } from "vitest";
import { chooseAgentTarget, normalizeAgentTargets } from "./agent-targets";

const entry = (over: Partial<AgentCatalogEntryVO>): AgentCatalogEntryVO => ({
  slug: "claude-acp",
  name: "Claude Code",
  description: "",
  transport: "local-subprocess",
  version: null,
  available: false,
  comingSoon: false,
  unavailableReason: null,
  connectionRequired: false,
  connectedAgentName: null,
  connectedAgents: [],
  ...over,
});

describe("normalizeAgentTargets", () => {
  it("takes a local row only when its binary is actually there", () => {
    const targets = normalizeAgentTargets([
      entry({ slug: "claude-acp", available: true }),
      entry({
        slug: "codex-acp",
        name: "Codex CLI",
        available: false,
        unavailableReason: "`npx` was not found on this machine.",
      }),
    ]);

    expect(targets.map((target) => target.slug)).toEqual(["claude-acp"]);
  });

  it("never offers a coming-soon row", () => {
    const targets = normalizeAgentTargets([
      entry({ slug: "someday", available: false, comingSoon: true }),
    ]);

    expect(targets).toEqual([]);
  });

  // The bug this pins: reading only `available` would offer the bare `buda`
  // connector row, and `sessions.create` would then pick whichever connection
  // happened to be first — a coin toss the user never asked us to make.
  it("expands a connector into one addressable target per connected agent", () => {
    const targets = normalizeAgentTargets([
      entry({
        slug: "buda",
        name: "Buda AI Agent",
        transport: "remote-websocket",
        available: true,
        connectedAgentName: "Research",
        connectedAgents: [
          { slug: "buda:research", name: "Research" },
          { slug: "buda:writer", name: "Writer" },
        ],
      }),
    ]);

    expect(targets).toEqual([
      {
        slug: "buda:research",
        name: "Research",
        transport: "remote-websocket",
        catalogSlug: "buda",
        connectorName: "Buda AI Agent",
      },
      {
        slug: "buda:writer",
        name: "Writer",
        transport: "remote-websocket",
        catalogSlug: "buda",
        connectorName: "Buda AI Agent",
      },
    ]);
    expect(targets.map((target) => target.slug)).not.toContain("buda");
  });

  it("mixes both shapes in one list", () => {
    const targets = normalizeAgentTargets([
      entry({ slug: "claude-acp", available: true }),
      entry({
        slug: "buda",
        transport: "remote-websocket",
        available: true,
        connectedAgents: [{ slug: "buda:research", name: "Research" }],
      }),
    ]);

    expect(targets.map((target) => target.slug)).toEqual(["claude-acp", "buda:research"]);
  });
});

describe("chooseAgentTarget", () => {
  it("reports nothing to pick when the catalog is genuinely empty", () => {
    expect(chooseAgentTarget([])).toEqual({ kind: "none" });
  });

  it("skips the picker for a single target", () => {
    const targets = normalizeAgentTargets([entry({ available: true })]);
    expect(chooseAgentTarget(targets)).toEqual({ kind: "single", target: targets[0] });
  });

  it("asks when there is a real choice", () => {
    const targets = normalizeAgentTargets([
      entry({ slug: "claude-acp", available: true }),
      entry({ slug: "codex-acp", name: "Codex CLI", available: true }),
    ]);
    expect(chooseAgentTarget(targets)).toEqual({ kind: "choose", targets });
  });
});
