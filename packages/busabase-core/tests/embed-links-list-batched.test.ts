import { createRouterClient } from "@orpc/server";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { LOCAL_SPACE_ID, runWithBusabaseContext } from "../src/context";
import { busabaseEmbedLinks, busabaseNodes } from "../src/db/schema";
import { ROOT_NODE_ID } from "../src/logic/kernel";
import { busabaseRouter } from "../src/router";
import { seedScenario } from "./helpers/seed-scenario";

/**
 * `embedLinks.list` resolves every distinct target in batches instead of one
 * link at a time. The paged audit listing still resolves each target through
 * the original single-target resolver, so for any set of links the two must
 * agree link for link: same ids, same order, same target names and node types,
 * and the same links dropped because their target is gone or not manageable.
 */
describe("embedLinks.list — batched target resolution", () => {
  it("returns exactly what the single-target resolver returns, for every target kind and actor", async () => {
    const { db } = await seedScenario("embed-links-list-batched");
    const client = createRouterClient(busabaseRouter);

    const doc = async (slug: string) => {
      const created = await client.docs.create({
        autoMerge: true,
        slug,
        name: `Doc ${slug}`,
        body: `# ${slug}`,
      });
      if (!("node" in created)) throw new Error("expected a materialized Doc");
      return created.node.id;
    };
    const sharedDoc = await doc("batched-shared");
    const archivedDoc = await doc("batched-archived");
    const privateDoc = await doc("batched-private");
    const grantedDoc = await doc("batched-granted");

    const base = await client.bases.create({
      autoMerge: true,
      slug: "batched-records",
      name: "Batched records",
      fields: [{ slug: "title", name: "Title", type: "text" }],
    });
    if (!base.materialized) throw new Error("expected a materialized Base");
    const privateBase = await client.bases.create({
      autoMerge: true,
      slug: "batched-private-records",
      name: "Private records",
      fields: [{ slug: "title", name: "Title", type: "text" }],
    });
    if (!privateBase.materialized) throw new Error("expected a materialized Base");
    const record = async (baseId: string, title: string) => {
      const created = await client.bases.createChangeRequest({
        baseId,
        fields: { title },
        autoMerge: true,
      });
      if (!created.materialized) throw new Error("expected a materialized record");
      return created.id;
    };
    const liveRecord = await record(base.id, "Live");
    const archivedRecord = await record(base.id, "Archived");
    const hiddenRecord = await record(privateBase.id, "Hidden");

    const pendingCreate = await client.nodes.createChangeRequest({
      autoMerge: false,
      operations: [
        {
          kind: "create",
          parentNodeId: ROOT_NODE_ID,
          nodeType: "doc",
          slug: "batched-pending",
          name: "Batched pending",
        },
      ],
    });
    const pendingEdit = await client.nodes.updateContent({
      nodeId: privateDoc,
      content: { kind: "doc", body: "# Pending private edit" },
      autoMerge: false,
    });

    const node = (typeId: string) => client.embedLinks.create({ type: "node", typeId });
    const recordLink = (typeId: string) =>
      client.embedLinks.create({ type: "record-detail", typeId });
    const links = [
      await node(sharedDoc),
      await node(sharedDoc), // the same target twice
      await node(archivedDoc),
      await node(privateDoc),
      await node(grantedDoc),
      await node(base.nodeId),
      await recordLink(liveRecord),
      await recordLink(liveRecord),
      await recordLink(archivedRecord),
      await recordLink(hiddenRecord),
      await client.changeRequests.createPreviewLink({ changeRequestId: pendingCreate.id }),
      await client.changeRequests.createPreviewLink({ changeRequestId: pendingEdit.id }),
    ];
    // Targets that stopped resolving after the link was made.
    await client.records.changeRequest({
      operation: "delete",
      recordId: archivedRecord,
      autoMerge: true,
    });
    await db
      .update(busabaseNodes)
      .set({ archivedAt: new Date() })
      .where(eq(busabaseNodes.id, archivedDoc));
    await client.nodes.updateVisibility({ nodeId: privateDoc, visibility: "private" });
    await client.nodes.updateVisibility({ nodeId: privateBase.nodeId, visibility: "private" });
    await client.nodes.principals.add({
      nodeId: grantedDoc,
      principalType: "user",
      principalId: "batched-member",
      role: "manage",
    });
    // Rows whose target never resolves, plus one from another space.
    const now = Date.now();
    const raw = (id: string, overrides: Partial<typeof busabaseEmbedLinks.$inferInsert>) => ({
      id,
      spaceId: LOCAL_SPACE_ID,
      type: "record-detail" as const,
      typeId: "rec_does_not_exist",
      secretHash: id.padEnd(64, "0"),
      createdBy: "local-admin",
      createdByApiKeyId: "local",
      frameMode: "anywhere",
      allowedOrigins: [],
      expiresAt: new Date(now + 60_000),
      createdAt: new Date(now),
      updatedAt: new Date(now),
      ...overrides,
    });
    await db.insert(busabaseEmbedLinks).values([
      raw("emb_batched_missing_record", {}),
      raw("emb_batched_missing_node", { type: "node", typeId: "nod_does_not_exist" }),
      raw("emb_batched_missing_cr", { type: "change-request", typeId: "cr_does_not_exist" }),
      raw("emb_batched_other_space", { spaceId: "other-space", type: "node", typeId: sharedDoc }),
      raw("emb_batched_expired", {
        type: "node",
        typeId: sharedDoc,
        expiresAt: new Date(now - 60_000),
      }),
    ]);
    // Distinct creation times, so "newest first" is one order and not a tie the
    // two listings may break differently.
    const allIds = [
      ...links.map((link) => link.id),
      "emb_batched_missing_record",
      "emb_batched_missing_node",
      "emb_batched_missing_cr",
      "emb_batched_expired",
    ];
    for (const [index, id] of allIds.entries()) {
      await db
        .update(busabaseEmbedLinks)
        .set({ createdAt: new Date(now - index * 1000) })
        .where(eq(busabaseEmbedLinks.id, id));
    }

    const reference = async () => {
      const items = [];
      let cursor: string | undefined;
      do {
        const page = await client.embedLinks.listPaged({ status: "all", limit: 100, cursor });
        items.push(...page.items);
        cursor = page.nextCursor ?? undefined;
      } while (cursor);
      return items;
    };
    const actors = {
      manager: undefined,
      member: {
        spaceId: LOCAL_SPACE_ID,
        actorId: "batched-member",
        isSpaceManager: false,
        permissionLevel: "manage" as const,
      },
      writer: {
        spaceId: LOCAL_SPACE_ID,
        actorId: "batched-writer",
        isSpaceManager: false,
        permissionLevel: "write" as const,
        credentialPermissionCeiling: "write" as const,
      },
      otherSpace: { spaceId: "other-space", actorId: "local-admin", isSpaceManager: true },
    };
    const results: Record<string, string[]> = {};
    for (const [name, context] of Object.entries(actors)) {
      const run = <T>(fn: () => Promise<T>) =>
        context ? runWithBusabaseContext(context, fn) : fn();
      const listed = await run(() => client.embedLinks.list({}));
      expect(listed, name).toEqual(await run(reference));
      results[name] = listed.map((link) => link.id);
    }

    // The comparison above is only meaningful if the fixture exercised every
    // outcome: kept, deduplicated, archived, hidden, missing, other space.
    const id = (index: number) => links[index]?.id;
    expect(results.manager).toEqual(
      [
        id(0),
        id(1),
        id(3),
        id(4),
        id(5),
        id(6),
        id(7),
        id(8),
        id(9),
        id(10),
        id(11),
        "emb_batched_expired",
      ].filter(Boolean),
    );
    expect(results.member).toEqual(
      [id(0), id(1), id(4), id(5), id(6), id(7), id(8), id(10), "emb_batched_expired"].filter(
        Boolean,
      ),
    );
    expect(results.writer).toEqual([]);
    expect(results.otherSpace).toEqual([]);
    const managerList = await client.embedLinks.list({});
    expect(managerList.find((link) => link.id === id(0))).toMatchObject({
      targetName: "Doc batched-shared",
      nodeType: "doc",
    });
    expect(managerList.find((link) => link.id === id(6))).toMatchObject({
      targetName: liveRecord,
      nodeType: null,
    });
    expect(managerList.find((link) => link.id === id(10))).toMatchObject({
      targetName: pendingCreate.id,
      nodeType: null,
    });
  });
});
