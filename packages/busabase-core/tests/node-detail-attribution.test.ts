import { createRouterClient } from "@orpc/server";
import { NodeDetailVOSchema } from "busabase-contract/contract/node-detail-schemas";
import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it, vi } from "vitest";
import {
  type BusabaseContext,
  LOCAL_SPACE_ID,
  runWithAnonymousContext,
  runWithBusabaseContext,
} from "../src/context";
import { busabaseNodes } from "../src/db/schema";
import { setNodeShare } from "../src/logic/node-share";
import { busabaseRouter } from "../src/router";
import { seedScenario } from "./helpers/seed-scenario";

type Client = ReturnType<typeof createRouterClient<typeof busabaseRouter, Record<never, never>>>;

const resolveUsers = vi.fn(
  async (ids: string[]) =>
    new Map(
      ids.map((id) => [
        id,
        { id, name: id === "alice" ? "Alice" : "Bob", email: null, image: null },
      ]),
    ),
);
const as = <T>(actorId: string, fn: () => Promise<T>, extra: Partial<BusabaseContext> = {}) =>
  runWithBusabaseContext(
    { spaceId: LOCAL_SPACE_ID, actorId, isSpaceManager: true, resolveUsers, ...extra },
    fn,
  );

describe("Node Info attribution against a real database", () => {
  let raw: Client;
  let db: Awaited<ReturnType<typeof seedScenario>>["db"];
  let docId = "";

  const read = () => as("alice", () => raw.nodes.get({ nodeId: docId }));
  const rename = (actorId: string, name: string, autoMerge = true) =>
    as(actorId, () =>
      raw.nodes.createChangeRequest({
        autoMerge,
        operations: [{ kind: "rename", nodeId: docId, name }],
      }),
    );

  beforeAll(async () => {
    ({ db } = await seedScenario("node-detail-attribution"));
    raw = createRouterClient(busabaseRouter);
    const doc = await as("alice", () =>
      raw.docs.create({ name: "Handbook", slug: "attributed-handbook", autoMerge: true }),
    );
    if ("status" in doc) throw new Error("expected a created document");
    docId = doc.node.id;
  });

  it("returns resolved creator and editor identities through the real output contract", async () => {
    const detail = NodeDetailVOSchema.parse(await read());
    expect(detail.attribution).toMatchObject({
      createdBy: "alice",
      createdByUser: { id: "alice", name: "Alice" },
      updatedBy: "alice",
      updatedByUser: { id: "alice", name: "Alice" },
    });
  });

  it("keeps the creator when another person edits the document body", async () => {
    await as("bob", () =>
      raw.nodes.updateContent({ nodeId: docId, content: { kind: "doc", body: "Updated by Bob" } }),
    );
    const detail = await read();
    expect(detail.attribution).toMatchObject({ createdBy: "alice", updatedBy: "bob" });
    expect(detail.type === "doc" && detail.body).toBe("Updated by Bob");
  });

  it("ignores pending and rejected changes", async () => {
    await rename("alice", "Pending name", false);
    const rejected = await rename("alice", "Rejected name", false);
    await as("bob", () =>
      raw.changeRequests.review({ changeRequestIds: [rejected.id], verdict: "rejected" }),
    );
    expect((await read()).attribution?.updatedBy).toBe("bob");
  });

  it("uses merge order and the editor, rather than submission order or the reviewer", async () => {
    const earlier = await rename("alice", "Earlier proposal applied last", false);
    await rename("bob", "Later proposal applied first");
    await as("bob", async () => {
      await raw.changeRequests.review({ changeRequestIds: [earlier.id], verdict: "approved" });
      const result = await raw.changeRequests.merge({ changeRequestIds: [earlier.id] });
      expect(result.results[0]?.ok).toBe(true);
    });
    const detail = await read();
    expect(detail.node.name).toBe("Earlier proposal applied last");
    expect(detail.attribution?.updatedBy).toBe("alice");
  });

  it("does not attribute a failed merge to its proposer", async () => {
    const conflicting = await as("bob", () =>
      raw.nodes.createChangeRequest({
        autoMerge: false,
        operations: [{ kind: "rename", nodeId: docId, slug: "attribution-taken" }],
      }),
    );
    // Another writer claims the proposed slug after submission, before merge.
    await as("alice", () =>
      raw.docs.create({ name: "Taken", slug: "attribution-taken", autoMerge: true }),
    );
    await as("alice", async () => {
      await raw.changeRequests.review({ changeRequestIds: [conflicting.id], verdict: "approved" });
      const result = await raw.changeRequests.merge({ changeRequestIds: [conflicting.id] });
      expect(result.results[0]?.ok).toBe(false);
    });
    expect((await read()).attribution?.updatedBy).toBe("alice");
  });

  it("includes direct metadata, settings, and scenario edits", async () => {
    await as("bob", () =>
      raw.nodes.updateMetadata({ nodeId: docId, metadata: { note: "edited" } }),
    );
    expect((await read()).attribution?.updatedBy).toBe("bob");
    await as("alice", () => raw.nodes.updateSettings({ nodeId: docId, settings: {} }));
    expect((await read()).attribution?.updatedBy).toBe("alice");
    await as("bob", () => raw.nodes.updateAgentPrompts({ nodeId: docId, agentPrompts: [] }));
    expect((await read()).attribution?.updatedBy).toBe("bob");
  });

  it("does not confuse records inside a Base with edits to the Base node", async () => {
    const base = await as("alice", () =>
      raw.bases.create({
        name: "Roadmap",
        slug: "attribution-roadmap",
        fields: [{ name: "Title", slug: "title", type: "text" }],
        autoMerge: true,
      }),
    );
    if ("status" in base) throw new Error("expected a created Base");
    await as("bob", () =>
      raw.bases.createChangeRequest({
        baseId: base.id,
        fields: { title: "Bob's row" },
        autoMerge: true,
      }),
    );
    const detail = await as("alice", () => raw.nodes.get({ nodeId: base.nodeId }));
    expect(detail.attribution).toMatchObject({ createdBy: "alice", updatedBy: "alice" });
  });

  it("does not resolve or disclose member identities across spaces or public links", async () => {
    resolveUsers.mockClear();
    await expect(
      as("alice", () => raw.nodes.get({ nodeId: docId }), { spaceId: "other-space" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(resolveUsers).not.toHaveBeenCalled();

    await as("alice", () => setNodeShare(docId, { scope: "public", capability: "read" }));
    resolveUsers.mockClear();
    const detail = await runWithAnonymousContext({ spaceId: LOCAL_SPACE_ID, resolveUsers }, () =>
      raw.nodes.get({ nodeId: docId }),
    );
    expect(detail.attribution).toBeUndefined();
    expect(resolveUsers).not.toHaveBeenCalled();
  });

  it("keeps missing historical identities unknown instead of assigning an earlier editor", async () => {
    await db
      .update(busabaseNodes)
      .set({ createdBy: null, updatedAt: new Date(Date.now() + 1000) })
      .where(eq(busabaseNodes.id, docId));
    expect((await read()).attribution).toEqual({
      createdBy: null,
      createdByUser: null,
      updatedBy: null,
      updatedByUser: null,
    });
  });
});
