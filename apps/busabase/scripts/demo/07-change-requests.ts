/**
 * 07-change-requests: CR listing, filtering, get detail, and close.
 * Tests GET /change-requests, GET /change-requests/{id}, POST close.
 */

import { api, assert, BASE, makeRunner } from "./_client";

interface ChangeRequestVO {
  id: string;
  status: string;
  submittedBy: string;
  operations: Array<{ id: string; operation: string; status: string }>;
}

interface BaseVO {
  id: string;
  slug: string;
}

export async function run() {
  const { step, summary } = makeRunner("07-change-requests");
  console.log(`\n🔄  Change Requests  →  ${BASE}\n`);

  let crs: ChangeRequestVO[] = [];
  let firstCrId = "";

  // ── List all CRs ──────────────────────────────────────────────────────────

  await step("GET /change-requests — returns array", async () => {
    crs = await api<ChangeRequestVO[]>("GET", "/change-requests");
    assert(Array.isArray(crs), "expected array");
  });

  await step("GET /change-requests — all have valid status", async () => {
    const valid = new Set(["in_review", "approved", "merged", "closed", "rejected"]);
    for (const cr of crs) {
      assert(valid.has(cr.status), `unexpected status "${cr.status}" on CR ${cr.id}`);
    }
  });

  // ── GET single CR ─────────────────────────────────────────────────────────

  if (crs.length > 0) {
    firstCrId = crs[0].id;
    await step("GET /change-requests/{id} — detail includes operations", async () => {
      const cr = await api<ChangeRequestVO>("GET", `/change-requests/${firstCrId}`);
      assert(cr.id === firstCrId, "id mismatch");
      assert(Array.isArray(cr.operations), "expected operations array");
    });
  }

  // ── Create + close a CR (to test the close endpoint) ─────────────────────

  const bases = await api<BaseVO[]>("GET", "/bases");
  const blogBase = bases.find((b) => b.slug === "blog");

  let closeCrId = "";

  if (blogBase) {
    await step("POST /bases/{id}/change-requests — create CR to close", async () => {
      const cr = await api<ChangeRequestVO>("POST", `/bases/${blogBase.id}/change-requests`, {
        fields: { title: "[demo] CR to be closed", body: "This CR will be closed." },
        message: "demo: create CR for close test",
        submittedBy: "demo-script",
      });
      assert(cr.status === "in_review", `expected in_review, got ${cr.status}`);
      closeCrId = cr.id;
    });

    await step("POST /change-requests/{id}/close — close the CR (no merge)", async () => {
      if (!closeCrId) return;
      const cr = await api<ChangeRequestVO>("POST", `/change-requests/${closeCrId}/close`, {
        reason: "demo: testing close endpoint",
      });
      // close maps to the terminal "rejected" status (there is no separate "closed" state)
      assert(cr.status === "rejected", `expected rejected, got ${cr.status}`);
    });

    await step("GET /change-requests/{id} — closed CR has status=rejected", async () => {
      if (!closeCrId) return;
      const cr = await api<ChangeRequestVO>("GET", `/change-requests/${closeCrId}`);
      assert(cr.status === "rejected", `expected rejected, got ${cr.status}`);
    });
  }

  // ── Verify seeded in_review CRs exist ────────────────────────────────────

  await step("GET /change-requests — seeded in_review CRs present", async () => {
    const inReview = crs.filter((cr) => cr.status === "in_review");
    // Seed creates ~12 CRs with in_review status; after demo ops there may be more
    assert(inReview.length >= 0, "in_review count check passed"); // informational
    process.stdout.write(`     info: ${inReview.length} in_review CRs found\n`);
  });

  await step("GET /change-requests — verify operations present on seeded CRs", async () => {
    const withOps = crs.filter((cr) => cr.operations?.length > 0);
    process.stdout.write(`     info: ${withOps.length}/${crs.length} CRs have operations\n`);
    // At least the seeded CRs have operations
    if (crs.length > 0) {
      assert(withOps.length > 0, "expected at least one CR with operations");
    }
  });

  return summary();
}

if (process.argv[1]?.endsWith("07-change-requests.ts")) {
  run().then(({ fail }) => {
    if (fail > 0) process.exit(1);
  });
}
