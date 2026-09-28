import "server-only";

/**
 * Busabase playbooks published through MCP's own primitives
 * (`agent-playbook-discovery.md` §7a follow-up 2).
 *
 * The playbook rule reaches an agent through the server `instructions` and the
 * `playbooks_search` tool — but some hosts (Claude Desktop, Claude Code's
 * slash-prompts) surface `prompts/list` and `resources/list` to the human and pay
 * little attention to `instructions`. So the same playbooks are also listed there:
 *
 * - every custom node prompt → an MCP prompt `playbook__<nodeSlug>__<key>`, whose
 *   `prompts/get` is the body `playbooks.get` renders (byte-identical to Ask Agent);
 * - every Skill node → an MCP resource `busabase://skill/{nodeId}`, whose
 *   `resources/read` is its `SKILL.md`.
 *
 * Everything is read in-process through the playbooks logic — the lists are
 * `listPlaybooks` (the same catalog `playbooks.list` serves the dashboard's
 * Playbooks page), the bodies `getPlaybook` — inside whatever busabase-core
 * context the host has bound for the request, so the ACL is the one
 * `playbooks.search` applies. The host decides WHICH space: `withSpace` runs the
 * callback in that space's context, or returns `null` when the request does not
 * name one unambiguously — then only the host's static documents are listed.
 */

import { ORPCError } from "@orpc/server";
import type { PlaybookListItemVO } from "busabase-contract/contract/playbook-schemas";
import type {
  McpDocumentProviders,
  McpPromptListing,
  McpResourceListing,
  McpToolExtra,
} from "openlib/mcp";
import { getPlaybook, listPlaybooks } from "./domains/playbooks/logic/playbooks";

/** Prefix of every playbook prompt name; also what tells `prompts/get` the name is ours. */
export const BUSABASE_MCP_PLAYBOOK_PROMPT_PREFIX = "playbook__";

/** URI template of a Skill node's `SKILL.md`. Distinct from the static `busabase://skill` manual. */
export const BUSABASE_MCP_SKILL_NODE_URI_TEMPLATE = "busabase://skill/{nodeId}";

const SKILL_NODE_URI_PREFIX = "busabase://skill/";

/**
 * At most this many prompts and this many skill resources are listed. MCP clients
 * show these lists to a human as a menu; past a couple of hundred it stops being one.
 * `playbooks_search` reaches the rest.
 */
export const BUSABASE_MCP_PLAYBOOK_LIST_LIMIT = 200;

/**
 * Description of the static `busabase://skill` manual on both servers. It is the one
 * listed entry a human reads first, so it is where the cap is stated.
 */
export const BUSABASE_MCP_SKILL_RESOURCE_DESCRIPTION = `The full change-request workflow: everyday tools, proposing structure, field types, starter blueprints, the revision loop, error handling, and the untrusted-content rules. This workspace's own playbooks are listed alongside it — each custom node prompt as a \`${BUSABASE_MCP_PLAYBOOK_PROMPT_PREFIX}…\` prompt, each skill as a \`busabase://skill/{nodeId}\` resource — at most ${BUSABASE_MCP_PLAYBOOK_LIST_LIMIT} of each; \`playbooks_search\` finds the rest.`;

/** A `listPlaybooks` prompt item, with the prompt-only fields it always carries made required. */
export type PlaybookPromptItem = Pick<
  PlaybookListItemVO,
  "nodeId" | "nodeName" | "nodeSlug" | "path"
> & {
  key: string;
  label: string;
  intent: "read-only" | "change";
};

/** A `listPlaybooks` skill item, reduced to what a resource listing needs. */
interface PlaybookSkillItem {
  nodeId: string;
  name: string;
  description: string;
}

/**
 * Every readable custom prompt, in `listPlaybooks` order (folder path, then label).
 * Unranked and the same on every call, which is what a menu — and the names computed
 * from it — needs.
 */
const listPromptItems = async (): Promise<PlaybookPromptItem[]> => {
  const { items } = await listPlaybooks({ kinds: ["prompt"] });
  return items.flatMap((item) =>
    item.kind === "prompt" && item.key !== undefined
      ? [
          {
            nodeId: item.nodeId,
            nodeName: item.nodeName,
            nodeSlug: item.nodeSlug,
            path: item.path,
            key: item.key,
            label: item.label ?? item.key,
            intent: item.intent ?? "change",
          },
        ]
      : [],
  );
};

const listSkillItems = async (): Promise<PlaybookSkillItem[]> => {
  const { items } = await listPlaybooks({ kinds: ["skill"] });
  return items.flatMap((item) =>
    item.kind === "skill"
      ? [
          {
            nodeId: item.nodeId,
            name: item.name ?? item.nodeName,
            description: item.description ?? "",
          },
        ]
      : [],
  );
};

const PART_MAX_CHARS = 48;

/**
 * One name part: only `[A-Za-z0-9_-]` (safe in every host's slash-command syntax),
 * no `__` inside (that is the separator), at most 48 chars. Empty after that (a
 * slug that was all CJK, say) → the fallback.
 */
const sanitizePart = (value: string, fallback: string): string => {
  const cleaned = value
    .replace(/[^A-Za-z0-9_-]+/g, "-")
    .replace(/_+/g, "_")
    .replace(/-+/g, "-")
    .replace(/^[-_]+|[-_]+$/g, "")
    .slice(0, PART_MAX_CHARS)
    .replace(/[-_]+$/g, "");
  return cleaned || fallback;
};

export const skillNodeUri = (nodeId: string) =>
  `${SKILL_NODE_URI_PREFIX}${encodeURIComponent(nodeId)}`;

/**
 * Stable, readable, unique prompt names for a prompt list, in list order.
 *
 * `playbook__<nodeSlug>__<key>`. Slugs are unique per node TYPE, not per space, so
 * a Base and a Doc can share one; names that collide get the node id appended, and
 * anything still colliding (two keys that sanitize alike) a `_2`, `_3`… in order.
 */
export const buildPlaybookPromptNames = (prompts: readonly PlaybookPromptItem[]): string[] => {
  const base = prompts.map(
    (prompt) =>
      `${BUSABASE_MCP_PLAYBOOK_PROMPT_PREFIX}${sanitizePart(prompt.nodeSlug, sanitizePart(prompt.nodeId, "node"))}__${sanitizePart(prompt.key, "prompt")}`,
  );
  const counts = new Map<string, number>();
  for (const name of base) counts.set(name, (counts.get(name) ?? 0) + 1);
  const withNode = base.map((name, index) =>
    (counts.get(name) ?? 0) > 1
      ? `${name}__${sanitizePart((prompts[index] as PlaybookPromptItem).nodeId, "node")}`
      : name,
  );
  const seen = new Map<string, number>();
  return withNode.map((name) => {
    const n = (seen.get(name) ?? 0) + 1;
    seen.set(name, n);
    return n === 1 ? name : `${name}_${n}`;
  });
};

const describeLocation = (path: readonly string[]) =>
  path.length > 0 ? path.join(" / ") : "top level";

const promptListing = (prompt: PlaybookPromptItem, name: string): McpPromptListing => ({
  name,
  title: prompt.label,
  description: `${prompt.label} — custom prompt on ${prompt.nodeName} (${describeLocation(prompt.path)})`,
  arguments: [
    {
      name: "locale",
      description:
        'Locale to render the prompt in, e.g. "en" or "zh-CN". Omit to render in English and let the agent reply in the user\'s language.',
      required: false,
    },
  ],
});

const isNotFound = (error: unknown) => error instanceof ORPCError && error.code === "NOT_FOUND";

/** Runs `fn` in the caller's space context, or returns `null` when no single space applies. */
export type BusabaseMcpPlaybookSpaceRunner = <T>(
  extra: McpToolExtra,
  fn: () => Promise<T>,
) => Promise<T | null>;

/** Self-hosted: the request is already bound to its one local workspace. */
const runInCurrentContext: BusabaseMcpPlaybookSpaceRunner = (_extra, fn) => fn();

export const createBusabaseMcpPlaybookProviders = ({
  withSpace = runInCurrentContext,
  limit = BUSABASE_MCP_PLAYBOOK_LIST_LIMIT,
}: {
  withSpace?: BusabaseMcpPlaybookSpaceRunner;
  limit?: number;
} = {}): McpDocumentProviders => ({
  listPrompts: async (extra) =>
    (await withSpace(extra, async () => {
      // Names come from the FULL list so a prompt's name does not depend on the cap.
      const prompts = await listPromptItems();
      const names = buildPlaybookPromptNames(prompts);
      return prompts
        .slice(0, limit)
        .map((prompt, index) => promptListing(prompt, names[index] as string));
    })) ?? [],

  getPrompt: async (name, args, extra) => {
    if (!name.startsWith(BUSABASE_MCP_PLAYBOOK_PROMPT_PREFIX)) return undefined;
    const resolved = await withSpace(extra, async () => {
      const prompts = await listPromptItems();
      const names = buildPlaybookPromptNames(prompts);
      const index = names.indexOf(name);
      const prompt = prompts[index];
      if (index < 0 || !prompt) return null;
      try {
        const rendered = await getPlaybook({
          kind: "prompt",
          nodeId: prompt.nodeId,
          key: prompt.key,
          ...(args.locale?.trim() ? { locale: args.locale.trim() } : {}),
        });
        return {
          description: promptListing(prompt, name).description,
          text: rendered.content,
        };
      } catch (error) {
        if (isNotFound(error)) return null;
        throw error;
      }
    });
    return resolved ?? undefined;
  },

  listResources: async (extra) =>
    (await withSpace(extra, async () => {
      const skills = await listSkillItems();
      return skills.slice(0, limit).map(
        (skill): McpResourceListing => ({
          uri: skillNodeUri(skill.nodeId),
          name: skill.name,
          ...(skill.description ? { description: skill.description } : {}),
          mimeType: "text/markdown",
        }),
      );
    })) ?? [],

  listResourceTemplates: async () => [
    {
      uriTemplate: BUSABASE_MCP_SKILL_NODE_URI_TEMPLATE,
      name: "busabase-skill-node",
      title: "Workspace skill",
      description:
        "A Skill node's SKILL.md, by node id (`nodeId` from playbooks_search) — the same content playbooks_get returns for a skill.",
      mimeType: "text/markdown",
    },
  ],

  readResource: async (uri, extra) => {
    if (!uri.startsWith(SKILL_NODE_URI_PREFIX)) return undefined;
    const rawId = uri.slice(SKILL_NODE_URI_PREFIX.length);
    let nodeId: string;
    try {
      nodeId = decodeURIComponent(rawId);
    } catch {
      return undefined;
    }
    if (!nodeId || nodeId.includes("/")) return undefined;
    const resolved = await withSpace(extra, async () => {
      try {
        const skill = await getPlaybook({ kind: "skill", nodeId });
        return { text: skill.content, mimeType: "text/markdown" };
      } catch (error) {
        if (isNotFound(error)) return null;
        throw error;
      }
    });
    return resolved ?? undefined;
  },
});
