import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import type { AgentSessionEventVO } from "busabase-contract/domains/agents/types";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import * as schema from "../../../db/schema";

const fixture = vi.hoisted(() => ({
  db: undefined as unknown,
  spaceId: "fidelity-space",
  actorId: null as string | null,
}));
vi.mock("../../../db", () => ({ getDb: async () => fixture.db }));
vi.mock("../../../context", () => ({
  getContextSpaceId: () => fixture.spaceId,
  getContextActorId: () => fixture.actorId,
}));
const {
  persistSessionCreated,
  persistSessionEvents,
  persistSessionModelOption,
  loadSessionEvents,
  loadSessionRuntime,
  acquireSessionLease,
} = await import("./agent-session-store");

describe("ACP event journal — real PGlite", () => {
  let client: PGlite;
  beforeAll(async () => {
    client = new PGlite({ extensions: { pg_trgm } });
    const db = drizzle({ client, schema });
    fixture.db = db;
    await migrate(db, {
      migrationsFolder: path.resolve(
        import.meta.dirname,
        "../../../../../../apps/busabase/src/db/migrations",
      ),
    });
    await persistSessionCreated({
      id: "fidelity-session",
      slug: "buda:test",
      agentName: "Test",
      transport: "remote-websocket",
      status: "idle",
      createdAt: new Date().toISOString(),
      lastActivityAt: new Date().toISOString(),
      error: null,
      modelOption: null,
    });
  });
  afterAll(async () => {
    await client?.close();
  });

  it("restores rich updates, extension identity, questions and decisions with a durable source cursor", async () => {
    const at = new Date().toISOString();
    const events: AgentSessionEventVO[] = [
      {
        sessionId: "fidelity-session",
        seq: 1,
        at,
        kind: "acpUpdate",
        acpUpdate: {
          sessionUpdate: "tool_call",
          toolCallId: "read",
          title: "Read report",
          content: [{ type: "content", content: { type: "text", text: "exact output" } }],
          locations: [{ path: "/agent/report.md", line: 2 }],
          _meta: { "buda.im": { seq: 10 } },
        },
      },
      {
        sessionId: "fidelity-session",
        seq: 2,
        at,
        kind: "acpExtension",
        acpExtension: {
          method: "_buda.im/session_event",
          params: {
            sessionId: "inner",
            event: { version: 1, type: "step_finished", turnId: "turn", stepId: "step", at },
            _meta: { "buda.im": { seq: 11 } },
          },
        },
      },
      {
        sessionId: "fidelity-session",
        seq: 3,
        at,
        kind: "inputRequest",
        inputRequest: {
          requestId: "question",
          message: "Continue?",
          requestedSchema: { type: "object", properties: { answer: { type: "boolean" } } },
        },
      },
      {
        sessionId: "fidelity-session",
        seq: 4,
        at,
        kind: "inputResolved",
        inputRequestId: "question",
        inputResponse: { action: "accept", content: { answer: false } },
      },
      { sessionId: "fidelity-session", seq: 5, at, kind: "status", status: "idle" },
    ];
    expect(await persistSessionEvents(events)).toBe(true);
    const restored = await loadSessionEvents("fidelity-session", -1);
    expect(restored).toMatchObject(events);
    expect(await loadSessionRuntime("fidelity-session")).toMatchObject({
      lastEventSeq: 5,
      upstreamSeq: 11,
    });
    expect(await loadSessionEvents("fidelity-session", 3)).toMatchObject(events.slice(3));
  });

  it("round-trips per-model thinking defaults and the separately confirmed level through real JSONB", async () => {
    const thinking = {
      id: "reasoning_effort",
      name: "Thinking",
      currentValue: "medium",
      options: [
        { value: "medium", name: "Medium" },
        { value: "high", name: "High" },
      ],
    };
    const modelOption = {
      id: "model",
      name: "Model",
      currentValue: "reasoner",
      options: [{ value: "reasoner", name: "Reasoner", thinking }],
    };
    for (const thinkingOption of [null, { ...thinking, currentValue: "high" }]) {
      expect(
        await persistSessionModelOption(
          "fidelity-session",
          modelOption,
          undefined,
          undefined,
          thinkingOption,
        ),
      ).toBe(true);
      const restored = await loadSessionRuntime("fidelity-session");
      expect(restored?.session.modelOption).toEqual(modelOption);
      expect(restored?.session.thinkingOption).toEqual(thinkingOption);
    }
  });

  it("does not acknowledge or append an event when its turn owner fence is stale", async () => {
    const lease = await acquireSessionLease("fidelity-session", "owner");
    expect(lease).not.toBeNull();
    if (!lease) throw new Error("Expected lease");
    const accepted = await persistSessionEvents(
      [
        {
          sessionId: "fidelity-session",
          seq: 6,
          at: new Date().toISOString(),
          kind: "acpUpdate",
          acpUpdate: {
            sessionUpdate: "agent_message_chunk",
            content: { type: "text", text: "stale" },
            _meta: { "buda.im": { seq: 12 } },
          },
        },
      ],
      { ownerId: "superseded", fencingToken: lease.fencingToken },
    );
    expect(accepted).toBe(false);
    expect(await loadSessionRuntime("fidelity-session")).toMatchObject({
      lastEventSeq: 5,
      upstreamSeq: 11,
    });
  });

  it("keeps another workspace from reading the resource and answer history", async () => {
    fixture.spaceId = "other-space";
    expect(await loadSessionRuntime("fidelity-session")).toBeNull();
    expect(await loadSessionEvents("fidelity-session", -1)).toEqual([]);
    fixture.spaceId = "fidelity-space";
  });
});
