import type { ToolKind } from "@agentclientprotocol/sdk";
import type { AcpBlock, AcpToolCallBlock } from "../reduce";

/**
 * Tool-run grouping — the rules that turn a flat block list into "Explored 3
 * files, ran 2 commands" collapsible groups, matching buda's chat.
 *
 * This is a **port**, not a shared import: `@acp-ui/core`'s purity rules
 * forbid depending on `@kaiui/core` (see `__tests__/purity.test.ts`), by
 * design — the two packages exist precisely so ACP does not route through
 * buda's AI-SDK-shaped stack. `@kaiui/core/group/tool-runs.ts` classifies a
 * tool by fuzzy-matching its *name* (`read_file`, `readFile`, "Read File" all
 * have to land in the same bucket) because the AI SDK's tool parts carry no
 * category of their own. ACP does not have that problem — `AcpToolCallBlock`
 * already carries a protocol-native `toolKind` enum — so the classifier here
 * is an exhaustive mapping, not a heuristic.
 */

export type ToolCategory = "explore" | "edit" | "run" | "search" | "other";

/**
 * ACP's own `ToolKind` vocabulary, folded into buda's five-bucket taxonomy so
 * the resulting summary reads the same way in both chats. `delete`/`move` join
 * `edit`, and `fetch` joins `explore`, exactly as `@kaiui/core`'s heuristic
 * already groups them for buda.
 */
const CATEGORY_BY_TOOL_KIND: Record<Exclude<ToolKind, "other">, ToolCategory> = {
  read: "explore",
  fetch: "explore",
  search: "search",
  edit: "edit",
  delete: "edit",
  move: "edit",
  execute: "run",
  think: "other",
  switch_mode: "other",
};

/** `null` — the agent sent no `kind` on the tool call — falls to `"other"`. */
export function getToolCategory(toolKind: ToolKind | null): ToolCategory {
  if (toolKind === null || toolKind === "other") return "other";
  return CATEGORY_BY_TOOL_KIND[toolKind];
}

export interface ToolRunSummary {
  explore: number;
  search: number;
  edit: number;
  run: number;
  other: number;
  /** Total tool calls, regardless of category. */
  total: number;
}

/**
 * Count a run's tools per category.
 *
 * Deliberately returns counts rather than a formatted title: the wording and
 * pluralization are localized, so the app owns the string and the core owns
 * the arithmetic — same split as `@kaiui/core`'s `summarizeToolRun`.
 */
export function summarizeToolRun(blocks: readonly AcpToolCallBlock[]): ToolRunSummary {
  const summary: ToolRunSummary = { explore: 0, search: 0, edit: 0, run: 0, other: 0, total: 0 };
  for (const block of blocks) {
    summary.total += 1;
    summary[getToolCategory(block.toolKind)] += 1;
  }
  return summary;
}

/**
 * True while any tool in the run is still awaiting execution — i.e. the group
 * should render as "working", not "done".
 */
export function hasActiveToolCall(blocks: readonly AcpToolCallBlock[]): boolean {
  return blocks.some((block) => block.status === "pending" || block.status === "in_progress");
}

export type AcpGroup =
  /** A non-tool-call block, or a lone tool call — rendered inline, never collapsed. */
  | { kind: "single"; block: AcpBlock }
  /** Two or more *consecutive* tool calls — rendered as one collapsible group. */
  | { kind: "run"; blocks: AcpToolCallBlock[] };

/**
 * Collapse consecutive `tool_call` blocks into runs, leaving everything else
 * inline.
 *
 * A run of exactly one tool call is emitted as `single`, matching what buda
 * renders today: a lone tool call shows as itself rather than a group with one
 * child. Any non-tool-call block flushes the pending run, so tool calls
 * separated by a message or permission card never merge across it.
 */
export function groupConsecutiveToolCalls(blocks: readonly AcpBlock[]): AcpGroup[] {
  const groups: AcpGroup[] = [];
  let pending: AcpToolCallBlock[] = [];

  const flush = () => {
    if (pending.length === 1) {
      groups.push({ kind: "single", block: pending[0] as AcpToolCallBlock });
    } else if (pending.length > 1) {
      groups.push({ kind: "run", blocks: pending });
    }
    pending = [];
  };

  for (const block of blocks) {
    if (block.kind === "tool_call") {
      pending.push(block);
      continue;
    }
    flush();
    groups.push({ kind: "single", block });
  }
  flush();

  return groups;
}
