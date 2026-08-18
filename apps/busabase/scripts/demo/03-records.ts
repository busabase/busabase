/**
 * 03-records: Records over the change-request workflow.
 *
 *   Part 1 — CR lifecycle smoke test on a throwaway record:
 *            create → approve → merge → read → history → update → merge → delete → merge.
 *            The record is always archived at the end, so it never pollutes the base.
 *   Part 2 — Persistent demo records: idempotently populate each base from DEMO_RECORDS
 *            with clean, seed-aligned names (no "[demo]" prefix, no duplicates on re-run).
 *
 * Content pulled from DEMO_RECORDS (same source as the DB seed).
 */

import { api, approveMerge, assert, BASE, makeRunner } from "./_client";
import { DEMO_PERSISTENT_RECORD_BASES, recordsForBase } from "./_data";

interface BaseVO {
  id: string;
  slug: string;
  name: string;
  fields: Array<{ id: string; slug: string }>;
}

interface RecordVO {
  id: string;
  baseId: string;
  status: string;
  headCommit: { payload: Record<string, unknown> };
}

interface ChangeRequestVO {
  id: string;
  status: string;
}

/** Create a record via CR → merge, but only if no record with the same identity value
 *  already exists in the base. Keeps re-runs from piling up duplicates. */
async function ensureRecord(
  baseId: string,
  rec: {
    identity: string;
    identityValue: string;
    fields: Record<string, unknown>;
    message?: string;
  },
): Promise<string | null> {
  const existing = await api<RecordVO[]>(
    "GET",
    `/records/search?baseId=${baseId}&fieldSlug=${rec.identity}&valueText=${encodeURIComponent(rec.identityValue)}`,
  );
  const found = existing.find(
    (r) => (r.headCommit?.payload as Record<string, unknown>)?.[rec.identity] === rec.identityValue,
  );
  if (found) return found.id; // already seeded by a prior run
  const cr = await api<ChangeRequestVO>("POST", `/bases/${baseId}/change-requests`, {
    fields: rec.fields,
    message: rec.message ?? "demo: seed record",
    submittedBy: "demo-script",
  });
  assert(cr.status === "in_review", `expected in_review, got ${cr.status}`);
  const result = await approveMerge(cr.id);
  assert(result.changeRequest.status === "merged", "expected merged");
  return result.record ? (result.record as RecordVO).id : null;
}

export async function run() {
  const { step, summary } = makeRunner("03-records");
  console.log(`\n📝  Records  →  ${BASE}\n`);

  const bases = await api<BaseVO[]>("GET", "/bases");
  const blogBase = bases.find((b) => b.slug === "blog");

  // ── Part 1: CR lifecycle smoke test (throwaway record, always cleaned up) ──

  let recordId = "";
  if (blogBase) {
    await step("POST /bases/{id}/change-requests — create throwaway record", async () => {
      // Every REQUIRED field on the blog base, not just title+body: the base has
      // gained required `status`/`path`/`slug`/`locale`/`schema-version` since this
      // step was written, so a two-field payload is a 400 and every step below it
      // was cascading off an empty recordId.
      const stamp = Date.now();
      const cr = await api<ChangeRequestVO>("POST", `/bases/${blogBase.id}/change-requests`, {
        fields: {
          title: `CR lifecycle smoke test ${stamp}`,
          body: "Throwaway record exercising the create→update→delete CR flow.",
          status: "draft",
          path: `/blog/cr-lifecycle-smoke-${stamp}`,
          slug: `cr-lifecycle-smoke-${stamp}`,
          locale: "en",
          "schema-version": 1,
        },
        message: "demo: lifecycle smoke test",
        submittedBy: "demo-script",
        // The assertion below is `in_review`, and this endpoint's permission-aware
        // default would merge immediately for this write-capable script.
        autoMerge: false,
      });
      assert(cr.id.startsWith("crq"), `unexpected CR id: ${cr.id}`);
      assert(cr.status === "in_review", `expected in_review, got ${cr.status}`);
      recordId = cr.id;
    });

    await step("approve+merge create CR", async () => {
      const result = await approveMerge(recordId);
      assert(result.changeRequest.status === "merged", "expected merged");
      assert(!!result.record, "expected a record");
      recordId = (result.record as RecordVO).id;
    });

    await step("GET /records/get — read the created record", async () => {
      const rec = await api<RecordVO>("GET", `/records/get?recordId=${recordId}`);
      assert(rec.id === recordId, "id mismatch");
      assert(rec.status === "active", `expected active, got ${rec.status}`);
    });

    await step("GET /records/{id}/change-requests — record CR history", async () => {
      const crs = await api<ChangeRequestVO[]>("GET", `/records/${recordId}/change-requests`);
      assert(Array.isArray(crs) && crs.length >= 1, "expected CR history");
    });

    await step("POST /records/{id}/change-requests — update (full required set)", async () => {
      // The update / delete / restore trio used to be PUT, DELETE and a POST on a
      // `/restore/` sub-path; they are one POST with an `operation` discriminator
      // now. This step still used the removed PUT verb and had been 404ing since.
      // An update CR validates the full required field set — blog's `body` is required.
      const stamp = Date.now();
      const cr = await api<ChangeRequestVO>("POST", `/records/${recordId}/change-requests`, {
        operation: "update",
        fields: {
          title: `CR lifecycle smoke test (updated) ${stamp}`,
          body: "Updated via the change-request workflow.",
          status: "draft",
          path: `/blog/cr-lifecycle-smoke-updated-${stamp}`,
          slug: `cr-lifecycle-smoke-updated-${stamp}`,
          locale: "en",
          "schema-version": 1,
        },
        message: "demo: update title",
        author: "demo-script",
        // `operation: "update"` is the one record branch that takes autoMerge, and
        // this step asserts the pending CR before merging it itself.
        autoMerge: false,
      });
      assert(cr.status === "in_review", `expected in_review, got ${cr.status}`);
      const result = await approveMerge(cr.id);
      assert(result.changeRequest.status === "merged", "expected merged");
    });

    await step("GET /records/get — verify update applied", async () => {
      const rec = await api<RecordVO>("GET", `/records/get?recordId=${recordId}`);
      assert(String(rec.headCommit.payload.title).includes("(updated)"), "title not updated");
    });

    await step("POST /records/{id}/change-requests — delete (archive)", async () => {
      // Same consolidation as the update above: the old DELETE verb is gone.
      // `delete` deliberately has no `autoMerge` — archiving user content always
      // requires review — so nothing to pin here.
      const cr = await api<ChangeRequestVO>("POST", `/records/${recordId}/change-requests`, {
        operation: "delete",
        message: "demo: clean up smoke-test record",
        submittedBy: "demo-script",
        deleteMode: "archive",
      });
      assert(cr.status === "in_review", `expected in_review, got ${cr.status}`);
      const result = await approveMerge(cr.id);
      assert(result.changeRequest.status === "merged", "expected merged");
    });

    await step("GET /records/get — record now archived", async () => {
      const rec = await api<RecordVO>("GET", `/records/get?recordId=${recordId}`);
      assert(rec.status === "archived", `expected archived, got ${rec.status}`);
    });
  }

  // ── List + search smoke checks ──

  await step("GET /records — list is a keyset page", async () => {
    // `/records` is keyset-paginated: `{ records, nextCursor }`, not a bare array.
    // This step asserted `Array.isArray` on the envelope and had been red ever
    // since the endpoint gained pagination.
    const page = await api<{ records: RecordVO[]; nextCursor: string | null }>("GET", "/records");
    assert(Array.isArray(page.records), "expected a records array on the page");
    assert(
      page.nextCursor === null || typeof page.nextCursor === "string",
      "expected nextCursor to be a string or null",
    );
  });

  if (blogBase) {
    await step("GET /records/search — search by title field", async () => {
      const records = await api<RecordVO[]>(
        "GET",
        `/records/search?baseId=${blogBase.id}&fieldSlug=title&valueText=AI`,
      );
      assert(Array.isArray(records), "expected array");
    });
  }

  // ── Part 2: persistent demo records — clean, seed-aligned names, idempotent ──

  // idMap: seed record id → real record id, so relation fields point at live targets.
  const idMap = new Map<string, string>();
  for (const slug of DEMO_PERSISTENT_RECORD_BASES) {
    const base = bases.find((b) => b.slug === slug);
    if (!base) continue;
    for (const rec of recordsForBase(slug)) {
      await step(`ensure ${slug} record "${rec.identityValue}" (idempotent)`, async () => {
        const fields = { ...rec.fields };
        // Remap relation fields from seed target ids to the real ids created above;
        // drop any target not (yet) created so the relation stays valid, not dangling.
        for (const relSlug of rec.relationSlugs) {
          const targets = fields[relSlug];
          if (Array.isArray(targets)) {
            fields[relSlug] = targets
              .map((t) => (typeof t === "string" ? idMap.get(t) : undefined))
              .filter((v): v is string => Boolean(v));
          }
        }
        // Best-effort: a single record the server rejects (e.g. an instance-specific 500
        // on one odd payload) shouldn't fail the whole populate — log it and move on.
        try {
          const realId = await ensureRecord(base.id, { ...rec, fields });
          if (realId) idMap.set(rec.seedId, realId);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          process.stdout.write(
            `     ⚠️  skipped "${rec.identityValue}": ${msg.split("\n")[0].slice(0, 100)}\n`,
          );
        }
      });
    }
  }

  return summary();
}

if (process.argv[1]?.endsWith("03-records.ts")) {
  run().then(({ fail }) => {
    if (fail > 0) process.exit(1);
  });
}
