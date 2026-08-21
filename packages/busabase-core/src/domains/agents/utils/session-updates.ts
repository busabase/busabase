/**
 * Write-side collapsing of an ACP session's event stream.
 *
 * The read-side helpers that used to live here (`updateToText`,
 * `collapseAgentEvents`, `buildAgentTimeline`) are now `@acp-ui/core`, shared
 * with acprouter. What remains is a persistence concern, not a UI one, which is
 * why it stayed behind.
 */
import type { AgentSessionEventVO } from "busabase-contract/domains/agents/types";

/**
 * Merge the token-level `agent_message_chunk` events of one turn into a single
 * event before they are written to the database.
 *
 * Agents stream at token granularity — one measured turn produced 26 events
 * for a three-line reply, 15 of them single-token chunks — so persisting the
 * raw stream would be an INSERT per token, against an embedded PGLite on the
 * desktop build. Every reader (the timeline, session history, audit) wants the
 * assembled message anyway, so the collapse belongs on the write side.
 *
 * `seq` is taken from the FIRST chunk of each run: replay is `seq > afterSeq`,
 * so a client that already saw the start of a message must not be handed the
 * whole assembled message again under a later `seq`.
 */
export function collapseForPersistence(events: AgentSessionEventVO[]): AgentSessionEventVO[] {
  const out: AgentSessionEventVO[] = [];
  for (const event of events) {
    const update = event.acpUpdate as { sessionUpdate?: unknown; content?: unknown } | undefined;
    const isChunk = event.kind === "acpUpdate" && update?.sessionUpdate === "agent_message_chunk";
    const previous = out.at(-1);
    const previousUpdate = previous?.acpUpdate as
      | { sessionUpdate?: unknown; content?: { text?: unknown } }
      | undefined;

    if (
      isChunk &&
      previous?.kind === "acpUpdate" &&
      previousUpdate?.sessionUpdate === "agent_message_chunk"
    ) {
      const text = (update?.content as { text?: unknown } | undefined)?.text;
      if (typeof text === "string" && typeof previousUpdate.content?.text === "string") {
        previousUpdate.content.text += text;
        continue;
      }
    }
    // Cloned so appending to `content.text` above never mutates the live
    // in-memory buffer the UI is still streaming from.
    out.push(isChunk ? structuredClone(event) : event);
  }
  return out;
}
