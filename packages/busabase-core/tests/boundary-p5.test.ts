/**
 * Boundary P5 — cross-entity data-integrity fixes
 *
 * P0 #2: CR merge refuses to mutate an archived target record (and scopes
 *        target records to the CR's own base).
 * P0 #3: comment subject resolution is space-scoped (no cross-tenant comments).
 *
 * (Base slug reuse after archive is intentionally NOT here — it requires the
 *  node-lifecycle follow-up so busabase_nodes also releases the slug.)
 */
import { describe, expect, it } from "vitest";
import { LOCAL_SPACE_ID, runWithBusabaseContext } from "../src/context";
import { createComment } from "../src/logic/audit";
import { seedScenario } from "./helpers/seed-scenario";

describe("Boundary P5 — oRPC", () => {
  // ── P0 #2: cannot update an archived record via a merged CR ───────────────
  it("Fix 2: merging an update CR that targets an archived record is rejected", async () => {
    const { client } = await seedScenario("p5-archived-record-guard");

    const base = await client.bases.create({ name: "Guard Base", slug: "guard-base" });
    const record = await client.records.createChangeRequest({
      baseId: base.id,
      fields: { title: "R1" },
      submittedBy: "alice",
      mergeImmediately: true,
    });

    // Author an update CR while the record is still active (so the
    // create-time guard passes), but do NOT merge yet.
    const updateCr = await client.records.createChangeRequest({
      baseId: base.id,
      targetRecordId: record.id,
      fields: { title: "R1 edited" },
      submittedBy: "alice",
      mergeImmediately: false,
    });

    // Now archive the record out from under the open CR.
    await client.records.createDeleteChangeRequest({
      recordId: record.id,
      submittedBy: "alice",
      mergeImmediately: true,
    });

    // Merging the stale update CR must be rejected by the merge-time guard.
    await client.changeRequests.approve({ changeRequestId: updateCr.id });
    await expect(client.changeRequests.merge({ changeRequestId: updateCr.id })).rejects.toThrow(
      /archived record/i,
    );
  });

  // ── P0 #3: comment subject resolution is space-scoped ─────────────────────
  it("Fix 3: cannot comment on a record that belongs to another space", async () => {
    const { client } = await seedScenario("p5-comment-space-scope");

    // Record lives in the default LOCAL_SPACE_ID space.
    const base = await client.bases.create({ name: "Comment Base", slug: "comment-base" });
    const record = await client.records.createChangeRequest({
      baseId: base.id,
      fields: { title: "Secret" },
      submittedBy: "alice",
      mergeImmediately: true,
    });

    // Same-space comment succeeds.
    const ok = await runWithBusabaseContext({ spaceId: LOCAL_SPACE_ID }, () =>
      createComment({
        subjectType: "record",
        subjectId: record.id,
        body: "looks good",
        authorId: "alice",
      }),
    );
    expect(ok.id).toBeTruthy();

    // A different space cannot resolve (and therefore cannot comment on) the record.
    await expect(
      runWithBusabaseContext({ spaceId: "other-space" }, () =>
        createComment({
          subjectType: "record",
          subjectId: record.id,
          body: "leaked",
          authorId: "mallory",
        }),
      ),
    ).rejects.toThrow(/Record not found/i);
  });
});
