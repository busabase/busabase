import { createRouterClient } from "@orpc/server";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { busabaseNodes } from "../src/db/schema";
import { busabaseRouter } from "../src/router";
import { seedScenario } from "./helpers/seed-scenario";

type RawClient = ReturnType<typeof createRouterClient<typeof busabaseRouter, Record<never, never>>>;

/**
 * `busabase_nodes.created_by` is what the search author filter reads, and a node
 * that misses it is not "created by nobody" — it is invisible to the filter
 * forever, with nothing to indicate anything went wrong.
 *
 * There are TWO ways a node is born: merging a `node_create` change request
 * (covered once, in `mergeNodeCreate`), and the direct-materialization fast
 * paths inside `createBase` / `createDoc` / `createFileNode` /
 * `createFileTreeNode`, which never reach that function. Both classes are
 * exercised here on purpose — the fast paths are exactly the ones that shipped
 * authorless in the first draft of this change, and a test that only used
 * change requests would have passed while they were broken.
 */
describe("every node records who created it", () => {
  it("stamps a creator on the change-request merge path", async () => {
    const { db } = await seedScenario("created-by-merge");
    const raw: RawClient = createRouterClient(busabaseRouter);

    const cr = await raw.nodes.createChangeRequest({
      autoMerge: true,
      message: "create a folder and a doc",
      operations: [
        { kind: "create", ref: "f", nodeType: "folder", slug: "authored-folder", name: "Folder" },
        { kind: "create", parentNodeRef: "f", nodeType: "doc", slug: "authored-doc", name: "Doc" },
      ],
    });

    const ids = cr.mergeSummary?.mergedNodeIds ?? [];
    expect(ids.length).toBe(2);
    for (const nodeId of ids) {
      const [row] = await db
        .select({ createdBy: busabaseNodes.createdBy, name: busabaseNodes.name })
        .from(busabaseNodes)
        .where(eq(busabaseNodes.id, nodeId));
      expect(row?.createdBy, `${row?.name} has no creator`).toBeTruthy();
    }
  });

  it("stamps a creator on the direct fast path a Base takes", async () => {
    const { db } = await seedScenario("created-by-base");
    const raw: RawClient = createRouterClient(busabaseRouter);

    // `bases.create` with autoMerge skips `mergeNodeCreate` entirely.
    const base = await raw.bases.create({
      slug: "authored-base",
      name: "Authored Base",
      fields: [{ slug: "notes", name: "Notes", type: "longtext" }],
      autoMerge: true,
    });
    if (!("id" in base)) throw new Error("Expected a materialized BaseVO");

    const [row] = await db
      .select({ createdBy: busabaseNodes.createdBy })
      .from(busabaseNodes)
      .where(eq(busabaseNodes.id, base.nodeId));
    expect(row?.createdBy, "a Base created through the fast path has no creator").toBeTruthy();
  });

  it("lets the author filter actually find what that creator made", async () => {
    await seedScenario("created-by-filter");
    const raw: RawClient = createRouterClient(busabaseRouter);

    await raw.nodes.createChangeRequest({
      autoMerge: true,
      message: "seed",
      operations: [{ kind: "create", nodeType: "doc", slug: "authored", name: "Authored" }],
    });
    const [node] = await raw.nodes.searchByName({ query: "authored" });
    await raw.nodes.updateContent({
      nodeId: node?.id ?? "",
      content: { kind: "doc", body: "AUTHORMARKER lives here." },
    });

    const [row] = await raw.nodes.searchByName({ query: "authored" });
    expect(row).toBeTruthy();

    const mine = await raw.search({ query: "AUTHORMARKER", sources: ["nodes"] });
    expect(mine.results.length).toBeGreaterThan(0);
    const creator = "local-producer";

    const matched = await raw.search({
      query: "AUTHORMARKER",
      sources: ["nodes"],
      createdBy: creator,
    });
    expect(matched.results.length).toBe(mine.results.length);

    // An actor who made nothing matches nothing — NOT everything, which is what
    // an ignored filter would silently produce.
    const none = await raw.search({
      query: "AUTHORMARKER",
      sources: ["nodes"],
      createdBy: "someone-else-entirely",
    });
    expect(none.results.length).toBe(0);
  });
});
