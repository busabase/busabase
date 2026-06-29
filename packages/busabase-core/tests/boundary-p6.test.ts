/**
 * Boundary P6 — node lifecycle: base archive frees its slug (node-level)
 *
 * P0 #1 (completed): archiving a base now also archives its node, so BOTH the
 * base and node partial unique indexes release the slug. A brand-new base may
 * then take the slug; restoring the original is blocked if the slug was reused.
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

    const active = await client.bases.list();
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
    const restoreCr = await raw.bases.restoreChangeRequest({
      baseId: base.id,
      submittedBy: "alice",
    });
    await raw.changeRequests.review({ changeRequestId: restoreCr.id, verdict: "approved" });
    await raw.changeRequests.merge({ changeRequestId: restoreCr.id });

    const active = await client.bases.list();
    expect(active.map((b) => b.id)).toContain(base.id);

    const [node] = await db
      .select({ archivedAt: busabaseNodes.archivedAt })
      .from(busabaseNodes)
      .where(and(eq(busabaseNodes.slug, "roundtrip")))
      .limit(1);
    expect(node?.archivedAt).toBeNull();
  });

  // ── restore-after-reuse collision is rejected ─────────────────────────────
  it("Fix 4: restoring a base whose slug was reused is rejected with CONFLICT", async () => {
    const { client } = await seedScenario("p6-restore-collision");
    const raw = createRouterClient(busabaseRouter);

    const first = await client.bases.create({ name: "Dup", slug: "dup" });
    await client.bases.createArchiveChangeRequest({
      baseId: first.id,
      submittedBy: "alice",
      mergeImmediately: true,
    });
    // A new active base grabs the freed slug.
    await client.bases.create({ name: "Dup v2", slug: "dup" });

    // Now restoring the original must fail (slug is taken).
    const restoreCr = await raw.bases.restoreChangeRequest({
      baseId: first.id,
      submittedBy: "alice",
    });
    await raw.changeRequests.review({ changeRequestId: restoreCr.id, verdict: "approved" });
    await expect(raw.changeRequests.merge({ changeRequestId: restoreCr.id })).rejects.toThrow(
      /slug .* is now used|Rename it first/i,
    );
  });
});
