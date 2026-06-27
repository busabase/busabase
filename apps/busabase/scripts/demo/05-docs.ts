/**
 * 05-docs: Doc lifecycle — create, direct body update, CR-based update.
 * POST /docs → GET /docs → POST /docs/{id}/body → POST /docs/{id}/change-requests → approve → merge
 */

import { api, approveMerge, assert, BASE, makeRunner } from "./_client";

interface NodeVO {
  id: string;
  slug: string;
  name: string;
  type: string;
}

interface DocVO {
  node: NodeVO;
  storagePrefix: string;
  body: string;
}

interface ChangeRequestVO {
  id: string;
  status: string;
}

const DEMO_DOCS = [
  {
    slug: "demo-engineering-notes",
    name: "Engineering Notes",
    description: "Demo doc created via OpenAPI to test the Doc domain.",
    body: "# Engineering Notes\n\nThis document was created by the demo script to verify the Doc OpenAPI endpoints.\n\n## Topics\n\n- Architecture decisions\n- Runbook links\n- On-call notes\n",
  },
  {
    slug: "demo-product-roadmap",
    name: "Product Roadmap",
    description: "Demo roadmap doc.",
    body: "# Product Roadmap\n\nQ3 2026 priorities created by demo script.\n",
  },
];

export async function run() {
  const { step, summary } = makeRunner("05-docs");
  console.log(`\n📄  Docs  →  ${BASE}\n`);

  let docId = "";

  // ── Create docs ───────────────────────────────────────────────────────────

  for (const def of DEMO_DOCS) {
    await step(`POST /docs — create "${def.name}"`, async () => {
      const doc = await api<DocVO>("POST", "/docs", {
        slug: def.slug,
        name: def.name,
        description: def.description,
        body: def.body,
      });
      assert(doc.node.slug === def.slug, `slug mismatch: ${doc.node.slug}`);
      assert(doc.node.type === "doc", `expected type=doc, got ${doc.node.type}`);
      if (def === DEMO_DOCS[0]) docId = doc.node.id;
    });
  }

  // ── List docs ─────────────────────────────────────────────────────────────

  await step("GET /docs — all demo doc slugs present", async () => {
    const docs = await api<DocVO[]>("GET", "/docs");
    assert(Array.isArray(docs), "expected array");
    const slugs = new Set(docs.map((d) => d.node.slug));
    for (const def of DEMO_DOCS) {
      assert(slugs.has(def.slug), `slug "${def.slug}" not found in /docs`);
    }
  });

  // ── GET /docs/{id} ────────────────────────────────────────────────────────

  await step("GET /docs/{id} — doc detail includes body", async () => {
    if (!docId) return;
    const doc = await api<DocVO>("GET", `/docs/${docId}`);
    assert(doc.node.id === docId, "id mismatch");
    assert(typeof doc.body === "string", "expected body string");
    assert(doc.body.includes("Engineering Notes"), "expected body content");
  });

  // ── Direct body update ────────────────────────────────────────────────────

  await step("POST /docs/{id}/body — direct update (no CR needed)", async () => {
    if (!docId) return;
    const updatedBody =
      "# Engineering Notes\n\nUpdated directly (no CR) by demo-05-docs at " +
      new Date().toISOString() +
      ".\n";
    const doc = await api<DocVO>("POST", `/docs/${docId}/body`, { body: updatedBody });
    assert(doc.body.includes("Updated directly"), "body not updated");
  });

  await step("GET /docs/{id} — verify direct body update persisted", async () => {
    if (!docId) return;
    const doc = await api<DocVO>("GET", `/docs/${docId}`);
    assert(doc.body.includes("Updated directly"), "expected updated body");
  });

  // ── CR-based update ───────────────────────────────────────────────────────

  let crId = "";
  const crBody =
    "# Engineering Notes\n\nThis version went through the approval workflow.\n\n## Approved Changes\n\n- Added approval-workflow content\n";

  await step("POST /docs/{id}/change-requests — propose body update via CR", async () => {
    if (!docId) return;
    const cr = await api<ChangeRequestVO>("POST", `/docs/${docId}/change-requests`, {
      body: crBody,
      message: "demo: update engineering notes via CR",
      submittedBy: "demo-script",
    });
    assert(cr.status === "in_review", `expected in_review, got ${cr.status}`);
    crId = cr.id;
  });

  await step("approve+merge doc CR", async () => {
    if (!crId) return;
    const result = await approveMerge(crId);
    assert(
      result.changeRequest.status === "merged",
      `expected merged, got ${result.changeRequest.status}`,
    );
  });

  await step("GET /docs/{id} — verify CR body after merge", async () => {
    if (!docId) return;
    const doc = await api<DocVO>("GET", `/docs/${docId}`);
    assert(
      doc.body.includes("approval workflow"),
      `expected CR body, got: ${doc.body.slice(0, 80)}`,
    );
  });

  // ── GET /docs by slug ─────────────────────────────────────────────────────

  await step("GET /docs/{slug} — lookup by slug works", async () => {
    const doc = await api<DocVO>("GET", `/docs/${DEMO_DOCS[1].slug}`);
    assert(doc.node.slug === DEMO_DOCS[1].slug, "slug lookup failed");
  });

  return summary();
}

if (process.argv[1]?.endsWith("05-docs.ts")) {
  run().then(({ fail }) => {
    if (fail > 0) process.exit(1);
  });
}
