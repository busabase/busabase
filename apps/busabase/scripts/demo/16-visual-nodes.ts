/**
 * 16-visual-nodes: Whiteboard / Workflow / HTML — the metadata-backed "visual" node
 * types. Ensures the "Visual Tools" folder and its 3 example nodes exist via the
 * OpenAPI surface, using the exact same content the DB seed uses
 * (`busabase-core/demo/dataset`'s `englishScenario.richNodes` — see
 * `SeedRichNodeDef`'s docblock), so demo.busabase.com never drifts from the
 * `db:seed:all` baseline even though it's converged over REST instead of a DB seed.
 *
 * POST /nodes/change-requests → approve → merge, idempotent (skip-if-exists by slug).
 */

import { englishScenario } from "busabase-core/demo/dataset";
import { api, approveMerge, assert, BASE, makeRunner, type NodeTreeVO } from "./_client";
import { findFolderBySlug, findNode, STANDARD_DEMO_FOLDERS } from "./_nodes";

interface ChangeRequestVO {
  id: string;
  status: string;
}

const VISUAL_FOLDER_SLUG = "visual-tools";

export async function run() {
  const { step, summary } = makeRunner("16-visual-nodes");
  console.log(`\n🎨  Visual nodes (whiteboard/workflow/html)  →  ${BASE}\n`);

  const richNodes = englishScenario.richNodes ?? [];

  let nodes: NodeTreeVO[] = [];
  let folderId = "";

  await step(`ensure "${VISUAL_FOLDER_SLUG}" folder exists (idempotent self-seed)`, async () => {
    nodes = await api<NodeTreeVO[]>("GET", "/nodes");
    const existing = findFolderBySlug(nodes, VISUAL_FOLDER_SLUG);
    if (existing) {
      folderId = existing.node.id;
      return;
    }
    const def = STANDARD_DEMO_FOLDERS.find((f) => f.slug === VISUAL_FOLDER_SLUG);
    assert(!!def, `"${VISUAL_FOLDER_SLUG}" missing from STANDARD_DEMO_FOLDERS`);
    const root = findNode(nodes, (n) => n.type === "folder" && n.slug === "root");
    assert(!!root, "root folder not found");
    const cr = await api<ChangeRequestVO>("POST", "/nodes/change-requests", {
      message: `demo: ensure folder ${VISUAL_FOLDER_SLUG}`,
      submittedBy: "demo-script",
      operations: [
        {
          kind: "create",
          nodeType: "folder",
          slug: def.slug,
          name: def.name,
          description: def.description,
          parentNodeId: root.node.id,
        },
      ],
    });
    await approveMerge(cr.id);
    nodes = await api<NodeTreeVO[]>("GET", "/nodes");
    const created = findFolderBySlug(nodes, VISUAL_FOLDER_SLUG);
    assert(!!created, `folder "${VISUAL_FOLDER_SLUG}" not found after create`);
    folderId = created.node.id;
  });

  for (const richNode of richNodes) {
    await step(
      `POST /nodes/change-requests — create "${richNode.name}" (nodeType: ${richNode.nodeType}, idempotent)`,
      async () => {
        if (!folderId) return;
        nodes = await api<NodeTreeVO[]>("GET", "/nodes");
        const existing = findNode(nodes, (n) => n.slug === richNode.slug);
        if (existing) {
          assert(
            existing.node.type === richNode.nodeType,
            `slug "${richNode.slug}" exists with type ${existing.node.type}, expected ${richNode.nodeType}`,
          );
          return;
        }
        const cr = await api<ChangeRequestVO>("POST", "/nodes/change-requests", {
          message: `demo: create ${richNode.slug} (${richNode.nodeType})`,
          submittedBy: "demo-script",
          operations: [
            {
              kind: "create",
              nodeType: richNode.nodeType,
              slug: richNode.slug,
              name: richNode.name,
              description: richNode.description,
              parentNodeId: folderId,
              metadata: richNode.metadata,
            },
          ],
        });
        assert(cr.status === "in_review", `expected in_review, got ${cr.status}`);
        const result = await approveMerge(cr.id);
        assert(result.changeRequest.status === "merged", "expected merged");
      },
    );
  }

  await step("GET /nodes — all visual nodes present under Visual Tools", async () => {
    nodes = await api<NodeTreeVO[]>("GET", "/nodes");
    const folder = findFolderBySlug(nodes, VISUAL_FOLDER_SLUG);
    assert(!!folder, `folder "${VISUAL_FOLDER_SLUG}" not found`);
    for (const richNode of richNodes) {
      const found = findNode(nodes, (n) => n.slug === richNode.slug);
      assert(!!found, `node "${richNode.slug}" not found`);
      assert(found?.parentId === folder?.node.id, `node "${richNode.slug}" not under Visual Tools`);
    }
  });

  return summary();
}

if (process.argv[1]?.endsWith("16-visual-nodes.ts")) {
  run().then(({ fail }) => {
    if (fail > 0) process.exit(1);
  });
}
