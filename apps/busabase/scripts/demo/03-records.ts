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
  headCommit: { fields: Record<string, unknown> };
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
    (r) => (r.headCommit?.fields as Record<string, unknown>)?.[rec.identity] === rec.identityValue,
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
      const cr = await api<ChangeRequestVO>("POST", `/bases/${blogBase.id}/change-requests`, {
        fields: {
          title: `CR lifecycle smoke test ${Date.now()}`,
          body: "Throwaway record exercising the create→update→delete CR flow.",
        },
        message: "demo: lifecycle smoke test",
        submittedBy: "demo-script",
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

    await step("GET /records/{id} — read the created record", async () => {
      const rec = await api<RecordVO>("GET", `/records/${recordId}`);
      assert(rec.id === recordId, "id mismatch");
      assert(rec.status === "active", `expected active, got ${rec.status}`);
    });

    await step("GET /records/{id}/change-requests — record CR history", async () => {
      const crs = await api<ChangeRequestVO[]>("GET", `/records/${recordId}/change-requests`);
      assert(Array.isArray(crs) && crs.length >= 1, "expected CR history");
    });

    await step("PUT /records/{id}/change-requests — update (full required set)", async () => {
      // An update CR validates the full required field set — blog's `body` is required.
      const cr = await api<ChangeRequestVO>("PUT", `/records/${recordId}/change-requests`, {
        fields: {
          title: `CR lifecycle smoke test (updated) ${Date.now()}`,
          body: "Updated via the change-request workflow.",
        },
        message: "demo: update title",
        author: "demo-script",
      });
      assert(cr.status === "in_review", `expected in_review, got ${cr.status}`);
      const result = await approveMerge(cr.id);
      assert(result.changeRequest.status === "merged", "expected merged");
    });

    await step("GET /records/{id} — verify update applied", async () => {
      const rec = await api<RecordVO>("GET", `/records/${recordId}`);
      assert(String(rec.headCommit.fields.title).includes("(updated)"), "title not updated");
    });

    await step("DELETE /records/{id}/change-requests — delete (archive)", async () => {
      const cr = await api<ChangeRequestVO>("DELETE", `/records/${recordId}/change-requests`, {
        message: "demo: clean up smoke-test record",
        submittedBy: "demo-script",
        deleteMode: "archive",
      });
      assert(cr.status === "in_review", `expected in_review, got ${cr.status}`);
      const result = await approveMerge(cr.id);
      assert(result.changeRequest.status === "merged", "expected merged");
    });

    await step("GET /records/{id} — record now archived", async () => {
      const rec = await api<RecordVO>("GET", `/records/${recordId}`);
      assert(rec.status === "archived", `expected archived, got ${rec.status}`);
    });
  }

  // ── List + search smoke checks ──

  await step("GET /records — list returns array", async () => {
    const records = await api<RecordVO[]>("GET", "/records");
    assert(Array.isArray(records), "expected array");
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
