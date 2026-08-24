import { closeAgentSessions } from "./agent-session-manager";
import { deleteSessionsBySlug, loadSessions } from "./agent-session-store";
import { disconnectBuda } from "./buda-connection";

const isBudaConnection = (slug: string) => slug === "buda" || slug.startsWith("buda:");

export async function disconnectAgentConnection(
  slug: string,
): Promise<{ ok: true; deletedSessionCount: number }> {
  const connectedSessions = (await loadSessions()).filter((session) => session.slug === slug);
  await closeAgentSessions(connectedSessions.map((session) => session.id));

  if (isBudaConnection(slug)) {
    await disconnectBuda(slug);
  }

  const deletedSessionCount = await deleteSessionsBySlug(slug);
  if (!isBudaConnection(slug) && deletedSessionCount === 0) {
    throw new Error("Agent connection not found.");
  }

  return { ok: true, deletedSessionCount };
}
