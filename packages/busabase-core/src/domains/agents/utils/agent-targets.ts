/**
 * "Which agent can I actually send this to?" — one answer, derived from the
 * catalog, for every surface that has to ask.
 *
 * The catalog is NOT a flat list of things you can talk to. It mixes two
 * shapes, and a caller that reads only one of them is wrong in a way that is
 * invisible until someone's setup differs from the author's:
 *
 *   - a local subprocess row (Claude Code, Codex) IS the target — `available`
 *     says whether its binary is on this machine;
 *   - the Buda row is a *connector*, not a target. Its own `available` says
 *     "a Buda connection exists", and the addressable agents live inside
 *     `connectedAgents` — one entry per agent the user picked in Buda, each
 *     with its own `buda:<id>` slug that `resolveLaunch` knows how to launch.
 *
 * Pure and isomorphic on purpose (no react, no db): the Ask Agent picker and
 * the later `@`-mention picker both need exactly this list, and they must not
 * disagree about what is launchable.
 */

import type { AgentCatalogEntryVO } from "busabase-contract/domains/agents/types";

/** One thing a message can actually be sent to. `slug` is `sessions.create`-ready. */
export interface AgentTarget {
  slug: string;
  name: string;
  transport: AgentCatalogEntryVO["transport"];
  /**
   * The catalog row this came from. Equal to `slug` for a local subprocess;
   * `"buda"` for an agent reached through a Buda connection. Kept so a picker
   * can group ("Buda · Research agent") without re-deriving the relationship.
   */
  catalogSlug: string;
  /** Present only when this target is one of a connector's connected agents. */
  connectorName?: string;
}

/**
 * Flatten the catalog into launchable targets.
 *
 * A connector row contributes its connected agents and never itself — sending
 * to the bare `buda` slug would pick whichever connection happened to be first,
 * which is a coin flip the user did not ask us to toss.
 */
export const normalizeAgentTargets = (catalog: readonly AgentCatalogEntryVO[]): AgentTarget[] => {
  const targets: AgentTarget[] = [];
  for (const entry of catalog) {
    if (entry.connectedAgents.length > 0) {
      for (const connected of entry.connectedAgents) {
        targets.push({
          slug: connected.slug,
          name: connected.name,
          transport: entry.transport,
          catalogSlug: entry.slug,
          connectorName: entry.name,
        });
      }
      continue;
    }
    // `comingSoon` rows are never available, so this one test covers them too.
    if (entry.available) {
      targets.push({
        slug: entry.slug,
        name: entry.name,
        transport: entry.transport,
        catalogSlug: entry.slug,
      });
    }
  }
  return targets;
};

/**
 * What the caller should do with the normalized list.
 *
 * Deliberately three outcomes and not "a list plus an if": the zero case is a
 * *navigation* (there is nothing to pick, so offer the add-agent flow) and the
 * one case is a *skip* (a picker with a single row is a click that asks
 * nothing). Encoding that here keeps every entry point from re-deciding it.
 *
 * Note what is NOT in here: "loading" and "failed". Those are states of the
 * catalog *request*, not of its result, and collapsing them into `none` is the
 * exact bug the failure matrix calls out — a network blip would silently become
 * "you have no agents, go set one up".
 */
export type AgentTargetChoice =
  | { kind: "none" }
  | { kind: "single"; target: AgentTarget }
  | { kind: "choose"; targets: AgentTarget[] };

export const chooseAgentTarget = (targets: readonly AgentTarget[]): AgentTargetChoice => {
  if (targets.length === 0) return { kind: "none" };
  const [only] = targets;
  if (targets.length === 1 && only) return { kind: "single", target: only };
  return { kind: "choose", targets: [...targets] };
};
