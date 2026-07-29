/**
 * 05-docs: Doc lifecycle — create, direct body update, CR-based update.
 * POST /docs → GET /nodes?types=doc → PUT /docs/{id}/body
 *   → POST /docs/{id}/change-requests → approve → merge
 *
 * `GET /docs` and `GET /docs/{nodeId}` were retired by the unified Node
 * surface. Listing Docs is now `GET /nodes?types=doc`, which returns FLAT
 * lightweight summaries and deliberately does NOT carry `body` (the retired
 * list read every Doc's body out of object storage). Reading one Doc — body
 * included — is `GET /nodes/{nodeId}`, whose `type: "doc"` variant is the exact
 * old `DocVO` plus a `type` discriminator. `POST /docs`, `PUT /docs/{id}/body`,
 * and `POST /docs/{id}/change-requests` are untouched.
 */

import { api, approveMerge, assert, BASE, makeRunner } from "./_client";
import { findFolderBySlug, moveNodeToFolder, needsMove } from "./_nodes";

interface NodeVO {
  id: string;
  slug: string;
  name: string;
  type: string;
  children?: NodeVO[];
}

/** What `POST /docs` and `PUT /docs/{id}/body` return (no `type` discriminator). */
interface DocVO {
  node: NodeVO;
  storagePrefix: string;
  body: string;
}

/** The `type: "doc"` variant of `NodeDetailVO` from `GET /nodes/{nodeId}`. */
interface DocDetailVO extends DocVO {
  type: "doc";
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
  const nodes = await api<import("./_client").NodeTreeVO[]>("GET", "/nodes");
  const docsFolder = findFolderBySlug(nodes, "docs");
  assert(!!docsFolder, "Docs folder not found; run 01-folders first");

  // ── Create docs ───────────────────────────────────────────────────────────

  for (const def of DEMO_DOCS) {
    await step(`POST /docs — create "${def.name}" (idempotent)`, async () => {
      // Re-runnable: a prior run may have already created this doc.
      let doc: DocVO;
      try {
        doc = await api<DocVO>("POST", "/docs", {
          slug: def.slug,
          name: def.name,
          description: def.description,
          body: def.body,
          parentNodeId: docsFolder.node.id,
          // Smoke-testing the API surface, not the review-first policy — opt
          // out the same way a seed script does.
          autoMerge: true,
        });
      } catch {
        // Slug lookup still works — `nodeId` accepts an id OR a slug; `type`
        // disambiguates a slug that exists under more than one node type.
        doc = await api<DocDetailVO>("GET", `/nodes/${def.slug}?type=doc`);
      }
      assert(doc.node.slug === def.slug, `slug mismatch: ${doc.node.slug}`);
      assert(doc.node.type === "doc", `expected type=doc, got ${doc.node.type}`);
      if (needsMove(nodes, def.slug, "docs")) {
        await moveNodeToFolder(def.slug, "docs", nodes);
      }
      if (def === DEMO_DOCS[0]) docId = doc.node.id;
    });
  }

  // ── List docs ─────────────────────────────────────────────────────────────

  await step("GET /nodes?types=doc — all demo doc slugs present", async () => {
    const docs = await api<NodeVO[]>("GET", "/nodes?types=doc");
    assert(Array.isArray(docs), "expected array");
    assert(
      docs.every((d) => d.type === "doc"),
      "expected only doc nodes",
    );
    const slugs = new Set(docs.map((d) => d.slug));
    for (const def of DEMO_DOCS) {
      assert(slugs.has(def.slug), `slug "${def.slug}" not found in /nodes?types=doc`);
    }
    // The reason this replaced `GET /docs`: the summary must not carry bodies.
    assert(
      docs.every((d) => !("body" in d)),
      "summary list must not hydrate Doc bodies",
    );
  });

  // ── GET /nodes/{id} ───────────────────────────────────────────────────────

  await step("GET /nodes/{id} — doc detail includes body", async () => {
    if (!docId) return;
    const doc = await api<DocDetailVO>("GET", `/nodes/${docId}`);
    assert(doc.type === "doc", `expected type=doc, got ${doc.type}`);
    assert(doc.node.id === docId, "id mismatch");
    assert(typeof doc.body === "string", "expected body string");
    assert(doc.body.includes("Engineering Notes"), "expected body content");
  });

  // ── Direct body update ────────────────────────────────────────────────────

  await step("PUT /docs/{id}/body — direct update (no CR needed)", async () => {
    if (!docId) return;
    const updatedBody =
      "# Engineering Notes\n\nUpdated directly (no CR) by demo-05-docs at " +
      new Date().toISOString() +
      ".\n";
    const doc = await api<DocVO>("PUT", `/docs/${docId}/body`, { body: updatedBody });
    assert(doc.body.includes("Updated directly"), "body not updated");
  });

  await step("GET /nodes/{id} — verify direct body update persisted", async () => {
    if (!docId) return;
    const doc = await api<DocDetailVO>("GET", `/nodes/${docId}`);
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

  await step("GET /nodes/{id} — verify CR body after merge", async () => {
    if (!docId) return;
    const doc = await api<DocDetailVO>("GET", `/nodes/${docId}`);
    assert(
      doc.body.includes("approval workflow"),
      `expected CR body, got: ${doc.body.slice(0, 80)}`,
    );
  });

  // ── GET /nodes by slug ────────────────────────────────────────────────────

  await step("GET /nodes/{slug}?type=doc — lookup by slug works", async () => {
    const doc = await api<DocDetailVO>("GET", `/nodes/${DEMO_DOCS[1].slug}?type=doc`);
    assert(doc.type === "doc", `expected type=doc, got ${doc.type}`);
    assert(doc.node.slug === DEMO_DOCS[1].slug, "slug lookup failed");
  });

  return summary();
}

if (process.argv[1]?.endsWith("05-docs.ts")) {
  run().then(({ fail }) => {
    if (fail > 0) process.exit(1);
  });
}
