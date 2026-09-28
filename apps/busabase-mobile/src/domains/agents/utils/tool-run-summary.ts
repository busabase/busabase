import { summarizeToolRun } from "@acp-ui/core/group";
import type { AcpToolCallBlock } from "@acp-ui/core/reduce";
import type { CoreMessages } from "~/i18n/messages";
import { fmt } from "~/i18n/messages";

/**
 * "Explored 3 files, ran 2 commands" from a tool run's category counts.
 *
 * `@acp-ui/core`'s `summarizeToolRun` returns counts, not a string, on
 * purpose (see its own doc comment): wording and pluralization are a binding
 * layer's job. Mirrors `@acp-ui/web`'s `formatToolRunTitle` — same split,
 * different renderer — using the exact strings shared with core's own
 * `agents.tools*` keys so a run reads identically on web and the phone.
 */
export const toolRunSummary = (
  blocks: readonly AcpToolCallBlock[],
  t: Pick<
    CoreMessages["agents"],
    "toolsExplored" | "toolsSearched" | "toolsEdited" | "toolsRan" | "toolsUsed"
  >,
): string => {
  const { explore, search, edit, run, other, total } = summarizeToolRun(blocks);
  const plural = (count: number) => (count === 1 ? "" : "s");
  const parts: string[] = [];
  if (explore > 0) parts.push(fmt(t.toolsExplored, { count: explore, plural: plural(explore) }));
  if (search > 0) parts.push(fmt(t.toolsSearched, { count: search, plural: plural(search) }));
  if (edit > 0) parts.push(fmt(t.toolsEdited, { count: edit, plural: plural(edit) }));
  if (run > 0) parts.push(fmt(t.toolsRan, { count: run, plural: plural(run) }));
  if (other > 0) parts.push(fmt(t.toolsUsed, { count: other, plural: plural(other) }));
  return parts.length > 0
    ? parts.join(", ")
    : fmt(t.toolsUsed, { count: total, plural: plural(total) });
};
