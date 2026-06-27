/**
 * 03-records: Full record lifecycle via change-request workflow.
 * create → approve → merge → read → update → approve → merge → delete → approve → merge
 * Content pulled from DEMO_RECORDS (same source as DB seed).
 */

import { api, approveMerge, assert, BASE, makeRunner } from "./_client";
import { DEMO_BLOG_RECORDS, DEMO_COMPANY_RECORDS } from "./_data";

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

export async function run() {
  const { step, summary } = makeRunner("03-records");
  console.log(`\n📝  Records  →  ${BASE}\n`);

  const bases = await api<BaseVO[]>("GET", "/bases");
  const blogBase = bases.find((b) => b.slug === "blog");
  const companiesBase = bases.find((b) => b.slug === "companies");

  let blogRecordId = "";
  let companyRecordId = "";

  // ── Blog record: create → approve → merge ────────────────────────────────

  if (blogBase && DEMO_BLOG_RECORDS.length > 0) {
    const blogPayload = DEMO_BLOG_RECORDS[0];
    // Strip relation fields (they need real target IDs)
    const safeFields = Object.fromEntries(
      Object.entries(blogPayload.fields).filter(
        ([k]) => !["related_social", "ai_summary", "ai_tags"].includes(k),
      ),
    );

    await step("POST /bases/{id}/change-requests — create blog record", async () => {
      const cr = await api<ChangeRequestVO>("POST", `/bases/${blogBase.id}/change-requests`, {
        fields: { ...safeFields, title: `[demo] ${safeFields.title}` },
        message: blogPayload.message,
        submittedBy: "demo-script",
      });
      assert(cr.id.startsWith("qdf_"), `unexpected CR id: ${cr.id}`);
      assert(cr.status === "in_review", `expected in_review, got ${cr.status}`);
      blogRecordId = cr.id; // temp — we use the CR id to drive approval
    });

    await step("POST /change-requests/{id}/reviews — approve blog CR", async () => {
      await api("POST", `/change-requests/${blogRecordId}/reviews`, {
        verdict: "approved",
        reason: "LGTM from demo-script",
      });
    });

    await step("POST /change-requests/{id}/merge — merge blog CR", async () => {
      const result = await api<{
        changeRequest: { id: string; status: string };
        record: RecordVO | null;
      }>("POST", `/change-requests/${blogRecordId}/merge`, {});
      assert(
        result.changeRequest.status === "merged",
        `unexpected status: ${result.changeRequest.status}`,
      );
      if (result.record) {
        blogRecordId = result.record.id;
      }
    });
  }

  // ── GET /records — list blog records ────────────────────────────────────

  await step("GET /records — list returns records array", async () => {
    const records = await api<RecordVO[]>("GET", "/records");
    assert(Array.isArray(records), "expected array");
  });

  if (blogBase) {
    await step("GET /records — blog base filter works", async () => {
      const records = await api<RecordVO[]>("GET", `/records?baseId=${blogBase.id}`);
      assert(Array.isArray(records), "expected array");
    });
  }

  // ── GET /records/{id} — get single record ───────────────────────────────

  if (blogRecordId && !blogRecordId.startsWith("qdf_")) {
    let updateCrId = "";

    await step("GET /records/{id} — get the created blog record", async () => {
      const rec = await api<RecordVO>("GET", `/records/${blogRecordId}`);
      assert(rec.id === blogRecordId, "id mismatch");
      assert(rec.status === "active", `expected active, got ${rec.status}`);
    });

    await step("GET /records/{id}/change-requests — list record CR history", async () => {
      const crs = await api<ChangeRequestVO[]>("GET", `/records/${blogRecordId}/change-requests`);
      assert(Array.isArray(crs), "expected array");
      assert(crs.length >= 1, "expected at least 1 CR in history");
    });

    // ── Update record ──────────────────────────────────────────────────────

    await step("POST /records/{id}/update-change-request — propose update", async () => {
      const cr = await api<ChangeRequestVO>(
        "POST",
        `/records/${blogRecordId}/update-change-request`,
        {
          fields: { title: "[demo updated] AI agents in 2026" },
          message: "demo: update title",
        },
      );
      assert(cr.status === "in_review", `expected in_review, got ${cr.status}`);
      updateCrId = cr.id;
    });

    await step("approve+merge update CR", async () => {
      const result = await approveMerge(updateCrId);
      assert(result.changeRequest.status === "merged", "expected merged");
    });

    await step("GET /records/{id} — verify title updated", async () => {
      const rec = await api<RecordVO>("GET", `/records/${blogRecordId}`);
      const title = rec.headCommit.fields.title as string;
      assert(title.includes("[demo updated]"), `title not updated: "${title}"`);
    });

    // ── Delete record ──────────────────────────────────────────────────────

    let deleteCrId = "";

    await step("POST /records/{id}/delete-change-request — propose delete", async () => {
      const cr = await api<ChangeRequestVO>(
        "POST",
        `/records/${blogRecordId}/delete-change-request`,
        {
          message: "demo: clean up demo record",
          deleteMode: "archive",
        },
      );
      assert(cr.status === "in_review", `expected in_review, got ${cr.status}`);
      deleteCrId = cr.id;
    });

    await step("approve+merge delete CR", async () => {
      const result = await approveMerge(deleteCrId);
      assert(result.changeRequest.status === "merged", "expected merged");
    });

    await step("GET /records/{id} — record is now archived", async () => {
      const rec = await api<RecordVO>("GET", `/records/${blogRecordId}`);
      assert(rec.status === "archived", `expected archived, got ${rec.status}`);
    });
  }

  // ── Companies: batch create via DEMO_COMPANY_RECORDS ──────────────────────

  if (companiesBase && DEMO_COMPANY_RECORDS.length > 0) {
    for (const company of DEMO_COMPANY_RECORDS.slice(0, 2)) {
      await step(`POST companies CR — create "${company.fields.name}"`, async () => {
        const safeFields = Object.fromEntries(
          Object.entries(company.fields).filter(([k]) => k !== "contacts"),
        );
        const cr = await api<ChangeRequestVO>(
          "POST",
          `/bases/${companiesBase.id}/change-requests`,
          {
            fields: { ...safeFields, name: `[demo] ${safeFields.name}` },
            message: company.message,
            submittedBy: "demo-script",
          },
        );
        assert(cr.status === "in_review", `expected in_review, got ${cr.status}`);
        const result = await approveMerge(cr.id);
        assert(result.changeRequest.status === "merged", "expected merged");
        companyRecordId = result.record ? (result.record as RecordVO).id : companyRecordId;
      });
    }
  }

  // ── GET /records/by-field-text ─────────────────────────────────────────────

  await step("GET /records/by-field-text — search by title field", async () => {
    if (!blogBase) return;
    const records = await api<RecordVO[]>(
      "GET",
      `/records/by-field-text?baseId=${blogBase.id}&fieldSlug=title&valueText=AI`,
    );
    assert(Array.isArray(records), "expected array");
  });

  return summary();
}

if (process.argv[1]?.endsWith("03-records.ts")) {
  run().then(({ fail }) => {
    if (fail > 0) process.exit(1);
  });
}
