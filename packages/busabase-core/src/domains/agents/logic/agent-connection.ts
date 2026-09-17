import { closeAgentSessions, listLiveAgentSessionIds } from "./agent-session-manager";
import {
  deleteSessionsBySlug,
  endSessionsBySlug,
  loadSessions,
  normalizeLegacyBudaSessions,
} from "./agent-session-store";
import { disconnectBuda, getOwnedBudaConnectionIdentity } from "./buda-connection";

const isBudaConnection = (slug: string) => slug === "buda" || slug.startsWith("buda:");

export async function disconnectAgentConnection(
  slug: string,
): Promise<{ ok: true; endedSessionCount: number }> {
  const identity = isBudaConnection(slug) ? await getOwnedBudaConnectionIdentity(slug) : null;
  if (identity?.legacy) await normalizeLegacyBudaSessions(identity.canonicalSlug);
  const sessionSlug = identity?.canonicalSlug ?? slug;
  const connectedSessions = (await loadSessions()).filter(
    (session) => session.slug === sessionSlug,
  );
  const endedSessionIds = await endSessionsBySlug(sessionSlug);
  await closeAgentSessions(connectedSessions.map((session) => session.id));

  if (isBudaConnection(slug)) {
    const disconnected = await disconnectBuda(slug);
    if (!disconnected) throw new Error("Agent connection not found.");
  }

  if (!isBudaConnection(slug) && connectedSessions.length === 0) {
    throw new Error("Agent connection not found.");
  }

  return { ok: true, endedSessionCount: endedSessionIds.length };
}

export async function deleteAgentHistory(
  slug: string,
): Promise<{ ok: true; deletedSessionCount: number }> {
  const identity = isBudaConnection(slug) ? await getOwnedBudaConnectionIdentity(slug) : null;
  if (identity?.legacy) await normalizeLegacyBudaSessions(identity.canonicalSlug);
  const sessionSlug = identity?.canonicalSlug ?? slug;
  const sessionIds = new Set(
    (await loadSessions())
      .filter((session) => session.slug === sessionSlug)
      .map((session) => session.id),
  );
  for (const sessionId of listLiveAgentSessionIds(sessionSlug)) {
    sessionIds.add(sessionId);
  }
  await endSessionsBySlug(sessionSlug);
  const deletedSessionCount = await deleteSessionsBySlug(sessionSlug);
  await closeAgentSessions([...sessionIds]);
  return { ok: true, deletedSessionCount };
}
