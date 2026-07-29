/**
 * 04-views: View lifecycle — create CR → approve → merge → update → delete, plus
 * the one-call `autoMerge` branch. Uses the blog base (seeded by DEMO_BASES) and
 * exercises all 3 view operations on both branches of the `materialized` union.
 */

import { api, approveMerge, assert, BASE, makeRunner } from "./_client";

interface BaseVO {
  id: string;
  slug: string;
}

interface ViewVO {
  id: string;
  slug: string;
  name: string;
  status: string;
  config: {
    filters: Array<{ fieldSlug: string; operator: string; value?: unknown }>;
    sorts: Array<{ fieldSlug: string; direction: string }>;
  };
}

interface ChangeRequestVO {
  id: string;
  status: string;
}

export async function run() {
  const { step, summary } = makeRunner("04-views");
  console.log(`\n👁️  Views  →  ${BASE}\n`);

  const bases = await api<BaseVO[]>("GET", "/bases");
  const blogBase = bases.find((b) => b.slug === "blog");

  if (!blogBase) {
    console.log("  ⚠️  blog base not found — skipping view tests");
    return summary();
  }

  let viewId = "";
  let viewSlug = "";
  let existingViews: ViewVO[] = [];

  await step("GET /bases/{id}/views — list existing views", async () => {
    existingViews = await api<ViewVO[]>("GET", `/bases/${blogBase.id}/views`);
    assert(Array.isArray(existingViews), "expected array");
  });

  // ── Create a new view via CR ────────────────────────────────────────────────

  await step("POST /views/change-requests — create 'Demo High Priority' view", async () => {
    // Unique per run: an archived view keeps holding its (baseId, slug) slot until
    // the partial-index migration is applied, so re-using a fixed slug would collide.
    // A fresh throwaway slug each run tests the full create→update→delete lifecycle.
    viewSlug = `demo-high-priority-${Date.now()}`;
    const cr = await api<ChangeRequestVO>("POST", "/views/change-requests", {
      operation: "create",
      baseId: blogBase.id,
      slug: viewSlug,
      name: "Demo High Priority",
      description: "Demo-script view filtering high-priority drafts.",
      config: {
        filters: [
          { fieldSlug: "status", operator: "equals", value: "drafting" },
          { fieldSlug: "ready", operator: "is_true" },
        ],
        sorts: [{ fieldSlug: "priority", direction: "asc" }],
      },
      message: "demo: create high-priority view",
      submittedBy: "demo-script",
      // Pin the review-first branch — this step asserts the pending CR that a
      // write-capable actor would otherwise have had merged already.
      autoMerge: false,
    });
    assert(cr.status === "in_review", `expected in_review, got ${cr.status}`);

    const result = await approveMerge(cr.id);
    assert(result.changeRequest.status === "merged", "expected merged");
  });

  await step("GET /bases/{id}/views — demo view appears after merge", async () => {
    const views = await api<ViewVO[]>("GET", `/bases/${blogBase.id}/views`);
    const v = views.find((v) => v.slug === viewSlug);
    assert(!!v, `view "${viewSlug}" not found after create+merge`);
    assert(v.status === "active", `expected active, got ${v.status}`);
    viewId = v.id;
  });

  // ── Update the view ────────────────────────────────────────────────────────

  await step("POST /views/change-requests — update view config", async () => {
    if (!viewId) return;
    const cr = await api<ChangeRequestVO>("POST", "/views/change-requests", {
      operation: "update",
      viewId,
      name: "Demo High Priority (updated)",
      config: {
        filters: [
          { fieldSlug: "status", operator: "equals", value: "drafting" },
          { fieldSlug: "ready", operator: "is_true" },
          { fieldSlug: "priority", operator: "equals", value: "1" },
        ],
        sorts: [],
      },
      message: "demo: tighten filter",
      // Pin the review-first branch — this step asserts the pending CR that a
      // write-capable actor would otherwise have had merged already.
      autoMerge: false,
    });
    assert(cr.status === "in_review", `expected in_review, got ${cr.status}`);

    const result = await approveMerge(cr.id);
    assert(result.changeRequest.status === "merged", "expected merged");
    const view = result.view as ViewVO | null;
    if (view) {
      assert(
        view.config.filters.length === 3,
        `expected 3 filters, got ${view.config.filters.length}`,
      );
    }
  });

  // ── Verify seeded views still present ─────────────────────────────────────

  await step("GET /bases/{id}/views — seeded views still intact", async () => {
    const views = await api<ViewVO[]>("GET", `/bases/${blogBase.id}/views`);
    const seededSlugs = existingViews.filter((v) => v.status === "active").map((v) => v.slug);
    for (const slug of seededSlugs) {
      const still = views.find((v) => v.slug === slug && v.status === "active");
      assert(!!still, `seeded view "${slug}" gone after demo ops`);
    }
  });

  // ── Delete the demo view ──────────────────────────────────────────────────

  await step("POST /views/change-requests — delete demo view", async () => {
    if (!viewId) return;
    const cr = await api<ChangeRequestVO>("POST", "/views/change-requests", {
      operation: "delete",
      viewId,
      message: "demo: clean up demo view",
      // Pin the review-first branch — this step asserts the pending CR that a
      // write-capable actor would otherwise have had merged already.
      autoMerge: false,
    });
    assert(cr.status === "in_review", `expected in_review, got ${cr.status}`);

    const result = await approveMerge(cr.id);
    assert(result.changeRequest.status === "merged", "expected merged");
  });

  await step("GET /bases/{id}/views — demo view archived after delete", async () => {
    if (!viewId) return;
    const views = await api<ViewVO[]>("GET", `/bases/${blogBase.id}/views`);
    const v = views.find((v) => v.id === viewId);
    assert(!v || v.status === "archived", `demo view should be archived`);
  });

  // ── autoMerge: create + delete a view in one call each ────────────────────

  await step("POST /views/change-requests — autoMerge creates the view outright", async () => {
    const autoSlug = `demo-auto-merged-${Date.now()}`;
    const view = await api<ViewVO & { materialized?: boolean }>("POST", "/views/change-requests", {
      operation: "create",
      baseId: blogBase.id,
      slug: autoSlug,
      name: "Demo Auto Merged",
      description: "Demo-script view created without a review round-trip.",
      config: { filters: [], sorts: [] },
      message: "demo: create view with autoMerge",
      submittedBy: "demo-script",
      autoMerge: true,
    });
    assert(view.materialized === true, "expected the materialized branch");
    assert(view.status === "active", `expected active, got ${view.status}`);
    assert(view.slug === autoSlug, `expected slug ${autoSlug}, got ${view.slug}`);

    const views = await api<ViewVO[]>("GET", `/bases/${blogBase.id}/views`);
    assert(
      views.some((v) => v.slug === autoSlug && v.status === "active"),
      "auto-merged view should be listed as active with no separate merge call",
    );

    // Clean up in one call too, exercising autoMerge on the delete branch.
    const deleted = await api<ViewVO & { materialized?: boolean }>(
      "POST",
      "/views/change-requests",
      { operation: "delete", viewId: view.id, message: "demo: clean up", autoMerge: true },
    );
    assert(deleted.materialized === true, "expected the materialized branch on delete");
    assert(deleted.status === "archived", `expected archived, got ${deleted.status}`);
  });

  return summary();
}

if (process.argv[1]?.endsWith("04-views.ts")) {
  run().then(({ fail }) => {
    if (fail > 0) process.exit(1);
  });
}
