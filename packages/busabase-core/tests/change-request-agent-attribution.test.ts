/**
 * Agent client attribution on change requests (`x-busabase-agent`) against a
 * real PGLite database.
 *
 * Both servers call `withRequestAttribution` once per `/api/v1` request inside
 * the resolved context; these tests do exactly that, then assert on BOTH the
 * stored row (what was recorded) and the VO (what a reader is shown).
 */
import { OpenAPIHandler } from "@orpc/openapi/fetch";
import { createRouterClient } from "@orpc/server";
import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import {
  type BusabaseSourceProvenance,
  LOCAL_SPACE_ID,
  runWithBusabaseContext,
  runWithLocalContext,
} from "../src/context";
import { getDb } from "../src/db";
import { busabaseChangeRequests } from "../src/db/schema";
import { withRequestAttribution } from "../src/logic/request-attribution";
import { busabaseRouter } from "../src/router";
import { seedScenario } from "./helpers/seed-scenario";

type RawClient = ReturnType<typeof createRouterClient<typeof busabaseRouter, Record<never, never>>>;

const API = "http://busabase.test/api/v1";

/** What Cloud's API-key transport puts in the context (see busabase-cloud openapi/provenance.ts). */
const CLOUD_PROVENANCE: BusabaseSourceProvenance = {
  owner: { id: "alice", name: "Alice", email: "alice@example.com", image: null },
  apiKey: { id: "key_1", name: "Kelly Agent" },
  channel: "cli",
};

const asCloudKey = <T>(headers: Record<string, string>, fn: () => Promise<T>, method = "POST") =>
  runWithBusabaseContext(
    {
      spaceId: LOCAL_SPACE_ID,
      actorId: "alice",
      isSpaceManager: true,
      sourceProvenance: CLOUD_PROVENANCE,
    },
    () => withRequestAttribution({ method, headers: new Headers(headers) }, fn),
  );

const storedProvenance = async (changeRequestId: string) => {
  const db = await getDb();
  const [row] = await db
    .select({ sourceMeta: busabaseChangeRequests.sourceMeta })
    .from(busabaseChangeRequests)
    .where(eq(busabaseChangeRequests.id, changeRequestId));
  if (!row) throw new Error(`change request ${changeRequestId} not found`);
  return (row.sourceMeta as Record<string, unknown>).provenance as
    | Record<string, unknown>
    | undefined;
};

describe("change request agent client attribution", () => {
  let raw: RawClient;
  let baseId = "";

  const createPending = async (title: string) => {
    const cr = await raw.bases.createChangeRequest({ baseId, fields: { title }, autoMerge: false });
    if (cr.materialized) throw new Error("expected a pending change request");
    return cr;
  };

  beforeAll(async () => {
    await seedScenario("agent-attribution");
    raw = createRouterClient(busabaseRouter);
    await asCloudKey({}, async () => {
      const cr = await raw.nodes.createChangeRequest({
        autoMerge: true,
        operations: [
          {
            kind: "create",
            nodeType: "base",
            slug: "test",
            name: "Test",
            fields: [{ slug: "title", name: "Title", type: "text" }],
          },
        ],
      });
      expect(cr.status).toBe("merged");
      const tree = await raw.nodes.list();
      const flat = (nodes: typeof tree): typeof tree =>
        nodes.flatMap((node) => [node, ...flat(node.children)]);
      baseId = flat(tree).find((node) => node.slug === "test")?.id ?? "";
    });
    expect(baseId).toBeTruthy();
  });

  describe("Cloud (API key provenance)", () => {
    it("records the normalized agent next to the key and returns it", async () => {
      const cr = await asCloudKey({ "x-busabase-agent": "codex" }, () => createPending("A"));
      expect((await storedProvenance(cr.id))?.agent).toEqual({ id: "codex", name: "Codex" });
      expect(cr.sourceAttribution).toEqual({
        displayName: "Kelly Agent",
        ownerName: "Alice",
        channel: "cli",
        agent: { id: "codex", name: "Codex" },
      });
    });

    it("stores the normalized form of an AI_AGENT-style value, never the raw one", async () => {
      const cr = await asCloudKey({ "x-busabase-agent": "claude-code_2-1-304_agent" }, () =>
        createPending("B"),
      );
      expect((await storedProvenance(cr.id))?.agent).toEqual({
        id: "claude-code",
        name: "Claude Code",
      });
    });

    it("without the header (or with garbage) the attribution keeps its exact old shape", async () => {
      for (const headers of [{}, { "x-busabase-agent": "  !!! " }]) {
        const cr = await asCloudKey(headers, () => createPending("C"));
        expect(await storedProvenance(cr.id)).not.toHaveProperty("agent");
        expect(cr.sourceAttribution).toEqual({
          displayName: "Kelly Agent",
          ownerName: "Alice",
          channel: "cli",
        });
      }
    });

    it("reads are not touched", async () => {
      await expect(
        asCloudKey({ "x-busabase-agent": "codex" }, async () => "ok", "GET"),
      ).resolves.toBe("ok");
    });
  });

  describe("open-source local host (through the real OpenAPI handler)", () => {
    const handler = new OpenAPIHandler(busabaseRouter);
    const call = async (
      method: string,
      path: string,
      headers: Record<string, string>,
      body?: unknown,
    ) => {
      const req = new Request(`${API}${path}`, {
        method,
        headers: { "content-type": "application/json", ...headers },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      // Exactly what apps/busabase's /api/v1 route does.
      return runWithLocalContext({ localUserName: "Local" }, () =>
        withRequestAttribution(req, async () => {
          const result = await handler.handle(req, { context: {} });
          if (!result.matched) throw new Error("route not matched");
          return (await result.response.json()) as Record<string, unknown>;
        }),
      );
    };
    const post = (headers: Record<string, string>) =>
      call("POST", `/bases/${baseId}/change-requests`, headers, {
        fields: { title: "Local" },
        autoMerge: false,
      }) as Promise<{ id: string; sourceAttribution: unknown }>;

    it("without the header: no provenance at all, attribution null (unchanged)", async () => {
      const cr = await post({ "x-busabase-channel": "sdk" });
      expect(await storedProvenance(cr.id)).toBeUndefined();
      expect(cr.sourceAttribution).toBeNull();
    });

    it("with the header: only the agent (+ declared channel) is recorded", async () => {
      const viaCli = await post({ "x-busabase-agent": "codex", "x-busabase-channel": "cli" });
      expect(await storedProvenance(viaCli.id)).toEqual({
        channel: "cli",
        agent: { id: "codex", name: "Codex" },
      });
      expect(viaCli.sourceAttribution).toEqual({
        displayName: null,
        ownerName: null,
        channel: "cli",
        agent: { id: "codex", name: "Codex" },
      });

      // Plain curl naming only its agent: no channel claimed.
      const bare = await post({ "x-busabase-agent": "codex" });
      expect(bare.sourceAttribution).toEqual({
        displayName: null,
        ownerName: null,
        channel: null,
        agent: { id: "codex", name: "Codex" },
      });
    });

    it("flows out of GET /change-requests", async () => {
      const cr = await post({ "x-busabase-agent": "opencode" });
      const list = (await call("GET", `/change-requests?limit=50`, {})) as {
        changeRequests: Array<{ id: string; sourceAttribution: unknown }>;
      };
      const listed = list.changeRequests.find((item) => item.id === cr.id);
      expect(listed?.sourceAttribution).toEqual({
        displayName: null,
        ownerName: null,
        channel: null,
        agent: { id: "opencode", name: "OpenCode" },
      });
    });
  });
});
