import type {
  AgentSessionsPageVO,
  AgentSessionVO,
  ListAgentSessionsPagedInput,
} from "busabase-contract/domains/agents/types";

export interface AgentSessionCursor {
  lastActivityAt: string;
  id: string;
}

const compareSessionKeys = (left: AgentSessionCursor, right: AgentSessionCursor) =>
  right.lastActivityAt.localeCompare(left.lastActivityAt) || right.id.localeCompare(left.id);

const encodeCursor = ({ lastActivityAt, id }: AgentSessionCursor) =>
  Buffer.from(JSON.stringify({ lastActivityAt, id }), "utf8").toString("base64url");

export const decodeAgentSessionCursor = (cursor: string): AgentSessionCursor => {
  try {
    const value = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as unknown;
    if (
      typeof value !== "object" ||
      value === null ||
      typeof (value as AgentSessionCursor).lastActivityAt !== "string" ||
      typeof (value as AgentSessionCursor).id !== "string" ||
      !Number.isFinite(Date.parse((value as AgentSessionCursor).lastActivityAt)) ||
      !(value as AgentSessionCursor).id
    ) {
      throw new Error("invalid shape");
    }
    return value as AgentSessionCursor;
  } catch {
    throw new Error("Invalid agent session cursor. Refresh and try again.");
  }
};

export const isAgentSessionAfterCursor = (
  session: AgentSessionVO,
  cursor: AgentSessionCursor | null,
) => !cursor || compareSessionKeys(session, cursor) > 0;

/**
 * Keyset-page the merged live + persisted session view. The manager owns that
 * merge, so pagination happens after live state has replaced any stale row.
 */
export function paginateAgentSessions(
  sessions: readonly AgentSessionVO[],
  input: ListAgentSessionsPagedInput,
): AgentSessionsPageVO {
  const cursor = input.cursor ? decodeAgentSessionCursor(input.cursor) : null;
  const candidates = sessions
    .filter((session) => session.slug === input.slug)
    .sort(compareSessionKeys)
    .filter((session) => isAgentSessionAfterCursor(session, cursor));
  const page = candidates.slice(0, input.limit + 1);
  const hasMore = page.length > input.limit;
  const items = hasMore ? page.slice(0, input.limit) : page;
  const last = items.at(-1);

  return {
    items,
    nextCursor: hasMore && last ? encodeCursor(last) : null,
  };
}
