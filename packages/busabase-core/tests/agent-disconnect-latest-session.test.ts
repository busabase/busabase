/**
 * Disconnecting an agent ends all of its sessions in one statement, which gives
 * every one the same `lastActivityAt` (it is also their retention clock, so it
 * must move). The disconnected card is named after the "latest" session; with
 * all of them tied, which one that was depended on row order, and the card's
 * name flipped between runs (Cloud ACP acceptance, PR #8426).
 */
import { describe, expect, it } from "vitest";
import { LOCAL_SPACE_ID, runWithBusabaseContext } from "../src/context";
import { busabaseAgentSessions } from "../src/db/schema";
import { listAgentConnections } from "../src/domains/agents/logic/agent-connection-list";
import { listAgentSessions } from "../src/domains/agents/logic/agent-session-manager";
import { endSessionsBySlug, loadSessions } from "../src/domains/agents/logic/agent-session-store";
import { seedScenario } from "./helpers/seed-scenario";

const minutesAgo = (minutes: number) => new Date(Date.now() - minutes * 60 * 1000);

const inSpace = <T>(fn: () => Promise<T>) =>
  runWithBusabaseContext({ spaceId: LOCAL_SPACE_ID, isSpaceManager: true }, fn);

describe("disconnecting an agent", () => {
  // Both physical orders: with tied timestamps, row order is whatever the table
  // happens to return, so passing on one of them proves nothing.
  it.each([
    ["inserted newest first", "newest-first"],
    ["inserted oldest first", "oldest-first"],
  ])(
    "keeps the most recent conversation first when %s",
    async (_label, order) => {
      const { db } = await seedScenario(`agent-disconnect-${order}`);
      const slug = "buda:agt_tie";
      const sessions = [
        { id: "ags_tie_new", agentName: "agt_tie", createdAt: minutesAgo(5) },
        { id: "ags_tie_mid", agentName: "Tie Agent", createdAt: minutesAgo(30) },
        { id: "ags_tie_old", agentName: "Tie Agent", createdAt: minutesAgo(60) },
      ];
      if (order === "oldest-first") sessions.reverse();
      for (const session of sessions) {
        await db.insert(busabaseAgentSessions).values({
          ...session,
          spaceId: LOCAL_SPACE_ID,
          slug,
          transport: "remote-websocket",
          status: "idle",
          lastActivityAt: session.createdAt,
        });
      }

      await inSpace(async () => {
        expect(await endSessionsBySlug(slug)).toHaveLength(3);

        const stored = await loadSessions();
        const tied = stored.filter((session) => session.slug === slug);
        expect(new Set(tied.map((session) => session.lastActivityAt)).size).toBe(1);
        expect(tied.map((session) => session.id)).toEqual([
          "ags_tie_new",
          "ags_tie_mid",
          "ags_tie_old",
        ]);

        const listed = (await listAgentSessions()).filter((session) => session.slug === slug);
        expect(listed[0]?.id).toBe("ags_tie_new");

        const card = (await listAgentConnections()).find((connection) => connection.slug === slug);
        expect(card?.agentName).toBe("agt_tie");
        expect(card?.connected).toBe(false);
      });
    },
    120_000,
  );
});
