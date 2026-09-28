/**
 * `busabase-cli playbooks search`, including the old-server fallback.
 *
 * The CLI and the server ship separately (spec agent-playbook-discovery.md
 * §6.6). A server older than `playbooks.search` answers 404; the worst possible
 * reaction is to print an empty list, because an agent reads that as "this
 * space has no playbooks" and improvises a process the user already wrote
 * down. So on a 404 this degrades to what an old server CAN answer — its skill
 * nodes, matched on the client — and says loudly, on stderr and in
 * `coverage.prompts`, that custom node prompts were not searched.
 */
import type { BusabaseClient } from "busabase-sdk";
import { classifyError } from "./errors.js";

export type PlaybookKindFlag = "skill" | "prompt";

export interface PlaybookSearchFlags {
  queries: string[];
  kinds?: PlaybookKindFlag[];
  nearNodeId?: string;
  inNodeId?: string;
  limit?: number;
  locale?: string;
}

/** What `coverage.prompts` says when the server could not search prompts at all. */
export const PROMPTS_UNSUPPORTED = "unsupported by this server";

export const PLAYBOOKS_FALLBACK_WARNING =
  "[busabase-cli] This server predates `playbooks search` (404). Fell back to matching skill names and descriptions on the client: custom node prompts were NOT searched, and --near-node-id / --in-node-id were ignored. An empty result here does not mean the space has no playbooks.";

/** Same weights the server uses (§6.2): name/slug 3, description 2, × distinct phrasings hit. */
const scoreSkill = (
  skill: { name: string; slug: string; description: string },
  queries: string[],
): { score: number; matchedOn: string[] } => {
  const fields = [
    { name: "name", group: "name", weight: 3, text: skill.name.toLowerCase() },
    { name: "slug", group: "name", weight: 3, text: skill.slug.toLowerCase() },
    { name: "description", group: "description", weight: 2, text: skill.description.toLowerCase() },
  ];
  const matched = new Set<string>();
  const groups = new Map<string, number>();
  let hits = 0;
  for (const query of queries) {
    let hit = false;
    for (const field of fields) {
      if (field.text.includes(query)) {
        hit = true;
        matched.add(field.name);
        groups.set(field.group, field.weight);
      }
    }
    if (hit) hits += 1;
  }
  const weight = [...groups.values()].reduce((sum, value) => sum + value, 0);
  return {
    score: weight * hits,
    matchedOn: fields.map((f) => f.name).filter((name) => matched.has(name)),
  };
};

/** Skills-only search against a server with no `playbooks.search`. */
export const fallbackSkillSearch = async (client: BusabaseClient, flags: PlaybookSearchFlags) => {
  const queries = [...new Set(flags.queries.map((q) => q.trim().toLowerCase()).filter(Boolean))];
  const wantSkills = !flags.kinds || flags.kinds.length === 0 || flags.kinds.includes("skill");
  const skills = wantSkills ? await client.nodes.list({ types: ["skill"] }) : [];
  const browse = queries.length === 0;
  const ranked = skills
    .map((skill) => ({
      skill,
      ...(browse ? { score: 0, matchedOn: [] } : scoreSkill(skill, queries)),
    }))
    .filter((entry) => browse || entry.score > 0)
    .sort(
      (a, b) => b.score - a.score || Date.parse(b.skill.updatedAt) - Date.parse(a.skill.updatedAt),
    );
  const limit = browse ? Math.min(flags.limit ?? 30, 30) : (flags.limit ?? 10);
  const items = ranked.slice(0, limit).map(({ skill, score, matchedOn }) => ({
    kind: "skill" as const,
    nodeId: skill.id,
    nodeType: skill.type,
    nodeName: skill.name,
    nodeSlug: skill.slug,
    path: [] as string[],
    name: skill.name,
    description: skill.description,
    matchedOn,
    score,
    updatedAt: skill.updatedAt,
  }));
  return {
    items,
    total: ranked.length,
    truncated: ranked.length > items.length,
    coverage: {
      skillsScanned: skills.length,
      promptNodesScanned: 0,
      prompts: PROMPTS_UNSUPPORTED,
    },
  };
};

export const playbooksSearchCommand = async (
  client: BusabaseClient,
  flags: PlaybookSearchFlags,
  warn: (message: string) => void = (message) => console.error(message),
) => {
  try {
    return await client.playbooks.search({
      queries: flags.queries,
      ...(flags.kinds ? { kinds: flags.kinds } : {}),
      ...(flags.nearNodeId ? { nearNodeId: flags.nearNodeId } : {}),
      ...(flags.inNodeId ? { inNodeId: flags.inNodeId } : {}),
      ...(flags.limit !== undefined ? { limit: flags.limit } : {}),
      ...(flags.locale ? { locale: flags.locale } : {}),
    });
  } catch (error) {
    // `playbooks.search` itself never answers NOT_FOUND (an unknown node id
    // just narrows to nothing), so a 404 here can only mean the route does
    // not exist on this server.
    if (classifyError(error).code !== "NOT_FOUND") throw error;
    warn(PLAYBOOKS_FALLBACK_WARNING);
    return fallbackSkillSearch(client, flags);
  }
};
