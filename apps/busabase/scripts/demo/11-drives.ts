/**
 * 11-drives: Full Drive lifecycle — create, list, read file, CR update, approve, merge, verify.
 * Drives are pure file-tree nodes (like Skills, minus the Skill metadata), so this
 * exercises the same /drives endpoints the seeded "Team Files" Drive is built on.
 */

import { api, approveMerge, assert, BASE, makeRunner, type NodeTreeVO } from "./_client";
import { findFolderBySlug, moveNodeToFolder, needsMove } from "./_nodes";

interface NodeVO {
  id: string;
  slug: string;
  name: string;
  type: string;
}

interface DriveVO {
  node: NodeVO;
  entryFile: string;
  visibility: string;
  version: string;
  files: Array<{ path: string; name: string }>;
}

interface FileContentVO {
  nodeId: string;
  path: string;
  content: string;
  contentHash: string;
}

interface ChangeRequestVO {
  id: string;
  status: string;
}

const DEMO_DRIVES = [
  {
    slug: "demo-launch-assets",
    name: "Launch Assets",
    description: "Shared Drive of launch-day files, edited through review.",
    files: [
      {
        path: "README.md",
        content:
          "# Launch Assets\n\nDrop launch-day files here. Every change is proposed as a change request and merged only after approval.\n",
      },
    ],
  },
  {
    slug: "demo-runbooks",
    name: "Runbooks",
    description: "On-call runbooks as a plain file Drive.",
    files: [{ path: "README.md", content: "# Runbooks\n\nOperational runbooks live here.\n" }],
  },
];

export async function run() {
  const { step, summary } = makeRunner("11-drives");
  console.log(`\n🗂️   Drives  →  ${BASE}\n`);

  // ── Find Drives folder ─────────────────────────────────────────────────────

  let parentNodeId: string | undefined;
  let nodes: NodeTreeVO[] = [];
  await step("GET /nodes — locate Drives folder", async () => {
    nodes = await api<NodeTreeVO[]>("GET", "/nodes");
    parentNodeId = findFolderBySlug(nodes, "drives")?.node.id;
    assert(!!parentNodeId, "Drives folder not found; run 01-folders first");
  });

  // ── Create drives (idempotent by slug) ─────────────────────────────────────

  const created: DriveVO[] = [];

  for (const def of DEMO_DRIVES) {
    await step(`POST /drives — create "${def.name}" (idempotent)`, async () => {
      // Re-runnable: a prior run may have already created this Drive.
      let drive: DriveVO;
      try {
        drive = await api<DriveVO>("POST", "/drives", {
          ...def,
          ...(parentNodeId ? { parentNodeId } : {}),
          // Smoke-testing the API surface, not the review-first policy — opt
          // out the same way a seed script does.
          autoMerge: true,
        });
      } catch {
        const list = await api<DriveVO[]>("GET", "/drives");
        const found = list.find((d) => d.node.slug === def.slug);
        assert(!!found, `Drive "${def.slug}" missing after create failed`);
        drive = found;
      }
      assert(drive.node.slug === def.slug, `slug mismatch: ${drive.node.slug}`);
      assert(drive.node.type === "drive", `expected type=drive, got ${drive.node.type}`);
      if (needsMove(nodes, def.slug, "drives")) {
        await moveNodeToFolder(def.slug, "drives", nodes);
      }
      created.push(drive);
    });
  }

  // ── GET /drives ────────────────────────────────────────────────────────────

  await step("GET /drives — all created slugs present", async () => {
    const list = await api<DriveVO[]>("GET", "/drives");
    const slugs = new Set(list.map((d) => d.node.slug));
    for (const def of DEMO_DRIVES) {
      assert(slugs.has(def.slug), `slug "${def.slug}" missing from GET /drives`);
    }
  });

  // ── GET /drives/{id} + files ───────────────────────────────────────────────

  if (created[0]) {
    await step("GET /drives/{id} — detail includes README.md", async () => {
      const drive = await api<DriveVO>("GET", `/drives/${created[0].node.id}`);
      assert(drive.node.id === created[0].node.id, "id mismatch");
      assert(
        drive.files.some((f) => f.path === "README.md"),
        "README.md not found in Drive files",
      );
    });

    await step("GET /drives/{id}/files/README.md — read seeded content", async () => {
      const file = await api<FileContentVO>("GET", `/drives/${created[0].node.id}/files/README.md`);
      assert(file.content.includes("Launch Assets"), "unexpected README content");
      assert(file.contentHash.startsWith("sha256:"), "unexpected hash format");
    });
  }

  // ── CR: update README.md via review workflow ───────────────────────────────

  if (created[0]) {
    const target = created[0];
    let crId = "";
    const updatedContent = `# ${target.node.name}\n\nUpdated by 11-drives.ts via the OpenAPI change-request workflow.\n`;

    await step(`POST /drives/{id}/change-requests — update README.md`, async () => {
      const cr = await api<ChangeRequestVO>("POST", `/drives/${target.node.id}/change-requests`, {
        message: "demo: update README via CR",
        submittedBy: "demo-script",
        operations: [{ kind: "update", path: "README.md", content: updatedContent }],
      });
      assert(cr.status === "in_review", `expected in_review, got ${cr.status}`);
      crId = cr.id;
    });

    await step("approve + merge drive CR", async () => {
      if (!crId) return;
      const result = await approveMerge(crId);
      assert(
        result.changeRequest.status === "merged",
        `expected merged, got ${result.changeRequest.status}`,
      );
    });

    await step("GET /drives/{id}/files/README.md — verify merged content", async () => {
      const file = await api<FileContentVO>("GET", `/drives/${target.node.id}/files/README.md`);
      assert(
        file.content.includes("11-drives.ts"),
        `expected updated README, got: ${file.content.slice(0, 80)}`,
      );
    });
  }

  return summary();
}

if (process.argv[1]?.endsWith("11-drives.ts")) {
  run().then(({ fail }) => {
    if (fail > 0) process.exit(1);
  });
}
