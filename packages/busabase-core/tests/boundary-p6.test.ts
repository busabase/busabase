/**
 * Boundary P6 — node lifecycle: base archive frees its slug (node-level)
 *
 * P0 #1 (completed): archiving a base now also archives its node, so BOTH the
 * base and node partial unique indexes release the slug. A brand-new base may
 * then take the slug; restoring the original then moves it to the next free
 * slug (`dup-2`) instead of failing — an archived base cannot be renamed, so a
 * "rename it first" error left it stuck in the Trash.
 */
import { createRouterClient } from "@orpc/server";
import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { busabaseNodes } from "../src/db/schema";
import { busabaseRouter } from "../src/router";
import { seedScenario } from "./helpers/seed-scenario";

const flatten = (
  nodes: Array<{ id: string; slug: string; children: unknown[] }>,
): Array<{
  id: string;
  slug: string;
}> =>
  nodes.flatMap((n) => [
    { id: n.id, slug: n.slug },
    ...flatten(n.children as Array<{ id: string; slug: string; children: unknown[] }>),
  ]);

describe("Boundary P6 — node lifecycle", () => {
  // ── slug reuse after archive ──────────────────────────────────────────────
  it("Fix 1: a base slug can be reused after the original base is archived", async () => {
    const { client } = await seedScenario("p6-base-slug-reuse");

    const first = await client.bases.create({ name: "Tasks", slug: "tasks" });
    await client.bases.createArchiveChangeRequest({
      baseId: first.id,
      submittedBy: "alice",
      mergeImmediately: true,
    });

    // Slug is free again: a brand-new base takes "tasks".
    const second = await client.bases.create({ name: "Tasks v2", slug: "tasks" });
    expect(second.id).not.toBe(first.id);
    expect(second.slug).toBe("tasks");

    const active = await client.bases.list({});
    expect(active.map((b) => b.id)).toContain(second.id);
    expect(active.map((b) => b.id)).not.toContain(first.id);
  });

  // ── archived base node leaves the node tree ───────────────────────────────
  it("Fix 2: an archived base's node is excluded from the node tree", async () => {
    const { client } = await seedScenario("p6-node-tree-hides-archived");
    const raw = createRouterClient(busabaseRouter);

    const base = await client.bases.create({ name: "Hidden", slug: "hidden" });
    const beforeTree = flatten(await raw.nodes.list());
    expect(beforeTree.some((n) => n.slug === "hidden")).toBe(true);

    await client.bases.createArchiveChangeRequest({
      baseId: base.id,
      submittedBy: "alice",
      mergeImmediately: true,
    });

    const afterTree = flatten(await raw.nodes.list());
    expect(afterTree.some((n) => n.slug === "hidden")).toBe(false);
  });

  // ── archive → restore round-trip reclaims the node ────────────────────────
  it("Fix 3: restoring an archived base un-archives its node", async () => {
    const { client, db } = await seedScenario("p6-restore-roundtrip");
    const raw = createRouterClient(busabaseRouter);

    const base = await client.bases.create({ name: "Roundtrip", slug: "roundtrip" });
    await client.bases.createArchiveChangeRequest({
      baseId: base.id,
      submittedBy: "alice",
      mergeImmediately: true,
    });

    // Restore via the restore-change-request path (approve + merge).
    const restoreCr = await raw.bases.lifecycleChangeRequest({
      operation: "restore",
      baseId: base.id,
      submittedBy: "alice",
    });
    await raw.changeRequests.review({ changeRequestIds: [restoreCr.id], verdict: "approved" });
    await raw.changeRequests.merge({ changeRequestIds: [restoreCr.id] });

    const active = await client.bases.list({});
    expect(active.map((b) => b.id)).toContain(base.id);

    const [node] = await db
      .select({ archivedAt: busabaseNodes.archivedAt })
      .from(busabaseNodes)
      .where(and(eq(busabaseNodes.slug, "roundtrip")))
      .limit(1);
    expect(node?.archivedAt).toBeNull();
    // The slug was free, so the history records no slug change.
    const merged = await raw.changeRequests.get({ changeRequestId: restoreCr.id });
    expect(merged?.mergeSummary).not.toHaveProperty("slugChanges");
  });

  // ── restore-after-reuse takes the next free slug ──────────────────────────
  it("Fix 4: restoring a base whose slug was reused moves it to the next free slug", async () => {
    const { client, db } = await seedScenario("p6-restore-collision");
    const raw = createRouterClient(busabaseRouter);

    const first = await client.bases.create({ name: "Dup", slug: "dup" });
    await client.bases.createArchiveChangeRequest({
      baseId: first.id,
      submittedBy: "alice",
      mergeImmediately: true,
    });
    // A new active base grabs the freed slug.
    const second = await client.bases.create({ name: "Dup v2", slug: "dup" });

    const restoreCr = await raw.bases.lifecycleChangeRequest({
      operation: "restore",
      // review-first: the slug is resolved at MERGE time, so the proposal must
      // stay pending instead of being merged inside this same call.
      autoMerge: false,
      baseId: first.id,
      submittedBy: "alice",
    });
    await raw.changeRequests.review({ changeRequestIds: [restoreCr.id], verdict: "approved" });
    const mergeResult = await raw.changeRequests.merge({ changeRequestIds: [restoreCr.id] });
    expect(mergeResult.results[0]).toMatchObject({ ok: true });

    // Both bases are active; the one that held "dup" keeps it.
    const active = await client.bases.list({});
    expect(active.find((b) => b.id === second.id)?.slug).toBe("dup");
    const restored = active.find((b) => b.id === first.id);
    expect(restored).toMatchObject({ slug: "dup-2", name: "Dup" });

    // The base row and its node move together, or the next rename/restore of
    // either would hit the other table's unique index.
    const [node] = await db
      .select({ slug: busabaseNodes.slug, archivedAt: busabaseNodes.archivedAt })
      .from(busabaseNodes)
      .where(eq(busabaseNodes.id, restored?.nodeId ?? ""))
      .limit(1);
    expect(node).toEqual({ slug: "dup-2", archivedAt: null });

    // The change request's history says where the base came back.
    const merged = await raw.changeRequests.get({ changeRequestId: restoreCr.id });
    expect(merged?.mergeSummary.slugChanges).toEqual([
      { nodeId: restored?.nodeId, nodeType: "base", name: "Dup", fromSlug: "dup", toSlug: "dup-2" },
    ]);
  });

  // The reported case: delete "base1", create "base1" again, delete that too,
  // create a third — then restore both from the Trash with one click each.
  it("Fix 5: two archived bases with the same slug both come back from the Trash", async () => {
    const { client } = await seedScenario("p6-restore-twice");
    const raw = createRouterClient(busabaseRouter);

    const archiveBase = async (baseId: string) =>
      client.bases.createArchiveChangeRequest({
        baseId,
        submittedBy: "alice",
        mergeImmediately: true,
      });
    const oldest = await client.bases.create({ name: "base1", slug: "base1" });
    await archiveBase(oldest.id);
    const middle = await client.bases.create({ name: "base1", slug: "base1" });
    await archiveBase(middle.id);
    const current = await client.bases.create({ name: "base1", slug: "base1" });

    // The Trash page's restore button: a direct write that merges on the spot.
    const restoredTo = new Map<string, string | undefined>();
    for (const base of [oldest, middle]) {
      const cr = await raw.bases.lifecycleChangeRequest({
        operation: "restore",
        baseId: base.id,
        submittedBy: "alice",
      });
      expect(cr.status).toBe("merged");
      // An agent restoring over the API learns the new slug from the response.
      restoredTo.set(
        base.id,
        (cr.mergeSummary.slugChanges as Array<{ toSlug: string }> | undefined)?.[0]?.toSlug,
      );
    }
    expect(Object.fromEntries(restoredTo)).toEqual({
      [oldest.id]: "base1-2",
      [middle.id]: "base1-3",
    });

    const active = await client.bases.list({});
    const slugOf = (baseId: string) => active.find((b) => b.id === baseId)?.slug;
    expect(slugOf(current.id)).toBe("base1");
    expect(slugOf(oldest.id)).toBe("base1-2");
    expect(slugOf(middle.id)).toBe("base1-3");
    expect(await client.bases.list({ status: "archived" })).toEqual([]);
  });
});
