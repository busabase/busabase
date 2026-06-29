/**
 * Boundary P7 — conflict-CR escape hatch
 *
 * A 3-way merge conflict moves a CR to status="conflict". Before this change it
 * was a dead end: revise/close/merge all rejected the conflict status. Now:
 *  - the conflicting field list is persisted to mergeSummary (for the UI diff),
 *  - revising a conflict CR re-baselines + resets it to in_review (resolve), and
 *  - closing a conflict CR is allowed (abandon).
 */
import { createRouterClient } from "@orpc/server";
import { describe, expect, it } from "vitest";
import { busabaseRouter } from "../src/router";
import { seedScenario } from "./helpers/seed-scenario";

type RawClient = ReturnType<typeof createRouterClient<typeof busabaseRouter, Record<never, never>>>;

// Reproduce a 3-way merge conflict: two CRs edit the same field; the first
// merges (advancing the record), the second goes stale and conflicts on merge.
async function makeConflict(client: Awaited<ReturnType<typeof seedScenario>>["client"]) {
  const base = await client.bases.create({ name: "Conflict Base", slug: "conflict-base" });
  await client.bases.createField({ baseId: base.id, name: "Score", slug: "score", type: "number" });
  const record = await client.records.createChangeRequest({
    baseId: base.id,
    fields: { title: "R1", score: 10 },
    submittedBy: "alice",
    mergeImmediately: true,
  });
  const cr1 = await client.records.createChangeRequest({
    baseId: base.id,
    targetRecordId: record.id,
    fields: { score: 20 },
    submittedBy: "alice",
  });
  await client.changeRequests.approve({ changeRequestId: cr1.id });
  await client.changeRequests.merge({ changeRequestId: cr1.id });
  const cr2 = await client.records.createChangeRequest({
    baseId: base.id,
    targetRecordId: record.id,
    fields: { score: 30 },
    submittedBy: "bob",
  });
  await client.changeRequests.approve({ changeRequestId: cr2.id });
  await expect(client.changeRequests.merge({ changeRequestId: cr2.id })).rejects.toThrow();
  return { base, record, cr2Id: cr2.id };
}

describe("Boundary P7 — conflict-CR escape hatch", () => {
  it("Fix 1: conflict persists the conflicting field list to mergeSummary", async () => {
    const { client } = await seedScenario("p7-conflict-summary");
    const { cr2Id } = await makeConflict(client);

    const conflicted = await client.changeRequests.get({ changeRequestId: cr2Id });
    expect(conflicted?.status).toBe("conflict");
    const summary = conflicted?.mergeSummary as { conflict?: { fields?: string[] } } | undefined;
    expect(summary?.conflict?.fields).toContain("score");
  });

  it("Fix 2: revising a conflict CR re-baselines it and lets it merge clean", async () => {
    const { client } = await seedScenario("p7-conflict-revise");
    const raw: RawClient = createRouterClient(busabaseRouter);
    const { record, cr2Id } = await makeConflict(client);

    const conflicted = await client.changeRequests.get({ changeRequestId: cr2Id });
    const operationId = conflicted?.operations?.[0]?.id;
    expect(operationId).toBeTruthy();

    // Revise with the intended resolution → resets to in_review, clears summary.
    const revised = await raw.operations.revise({
      operationId: operationId as string,
      fields: { score: 30 },
      author: "bob",
      message: "resolve conflict",
    });
    expect(revised.status).toBe("in_review");
    expect(revised.mergeSummary).toEqual({});

    // Re-approve + merge now succeeds.
    await raw.changeRequests.review({ changeRequestId: cr2Id, verdict: "approved" });
    await raw.changeRequests.merge({ changeRequestId: cr2Id });

    const merged = await client.changeRequests.get({ changeRequestId: cr2Id });
    expect(merged?.status).toBe("merged");

    const fresh = await raw.records.get({ recordId: record.id });
    expect(fresh.headCommit.fields.score).toBe(30);
  });

  it("Fix 3: a conflict CR can be closed (abandoned)", async () => {
    const { client } = await seedScenario("p7-conflict-close");
    const raw: RawClient = createRouterClient(busabaseRouter);
    const { cr2Id } = await makeConflict(client);

    const closed = await raw.changeRequests.close({ changeRequestId: cr2Id, reason: "give up" });
    expect(closed.status).toBe("rejected");
  });
});
