/**
 * 11-drives: Full Drive lifecycle — create, list, read file, CR update, approve, merge, verify.
 * Drives are pure file-tree nodes (like Skills, minus the Skill metadata), so this
 * exercises the shared /file-trees endpoints the seeded "Team Files" Drive uses.
 *
 * `GET /file-trees` and `GET /file-trees/{nodeId}` were retired by the unified
 * Node surface: list Drives with `GET /nodes?types=drive` (FLAT lightweight
 * summaries) and read one with `GET /nodes/{nodeId}` (`type: "drive"` variant
 * of `NodeDetailVO` — the exact old VO plus a discriminator). The create, file
 * read, and change-request routes under `/file-trees` are untouched.
 */

import { api, approveMerge, assert, BASE, makeRunner, type NodeTreeVO } from "./_client";
import { findFolderBySlug, moveNodeToFolder, needsMove } from "./_nodes";

interface NodeVO {
  id: string;
  slug: string;
  name: string;
  type: string;
  children?: NodeVO[];
}

/** What `POST /file-trees` returns (no `type` discriminator on the envelope). */
interface DriveVO {
  node: NodeVO;
  entryFile: string;
  visibility: string;
  version: string;
  files: Array<{ path: string; name: string }>;
}

/** The `type: "drive"` variant of `NodeDetailVO` from `GET /nodes/{nodeId}`. */
interface DriveDetailVO extends DriveVO {
  type: "drive";
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
    await step(`POST /file-trees — create "${def.name}" (idempotent)`, async () => {
      // Re-runnable: a prior run may have already created this Drive.
      let drive: DriveVO;
      try {
        drive = await api<DriveVO>("POST", "/file-trees", {
          ...def,
          type: "drive",
          ...(parentNodeId ? { parentNodeId } : {}),
          // Smoke-testing the API surface, not the review-first policy — opt
          // out the same way a seed script does.
          autoMerge: true,
        });
      } catch {
        // The summary list has no `files`/`version`, and the rest of this suite
        // needs the full Drive — so find it in the summary, then open it.
        const list = await api<NodeVO[]>("GET", "/nodes?types=drive");
        const found = list.find((d) => d.slug === def.slug);
        assert(!!found, `Drive "${def.slug}" missing after create failed`);
        drive = await api<DriveDetailVO>("GET", `/nodes/${found.id}?type=drive`);
      }
      assert(drive.node.slug === def.slug, `slug mismatch: ${drive.node.slug}`);
      assert(drive.node.type === "drive", `expected type=drive, got ${drive.node.type}`);
      if (needsMove(nodes, def.slug, "drives")) {
        await moveNodeToFolder(def.slug, "drives", nodes);
      }
      created.push(drive);
    });
  }

  // ── GET /nodes?types=drive ────────────────────────────────────────────────

  await step("GET /nodes?types=drive — all created slugs present", async () => {
    const list = await api<NodeVO[]>("GET", "/nodes?types=drive");
    assert(
      list.every((d) => d.type === "drive"),
      "expected only drive nodes",
    );
    const slugs = new Set(list.map((d) => d.slug));
    for (const def of DEMO_DRIVES) {
      assert(slugs.has(def.slug), `slug "${def.slug}" missing from GET /nodes?types=drive`);
    }
    // The reason this replaced `GET /file-trees`: no per-node file inventory.
    assert(
      list.every((d) => !("files" in d)),
      "summary list must not hydrate file inventories",
    );
  });

  // ── GET /nodes/{id} + files ──────────────────────────────────────────────

  if (created[0]) {
    await step("GET /nodes/{id} — detail includes README.md", async () => {
      const drive = await api<DriveDetailVO>("GET", `/nodes/${created[0].node.id}?type=drive`);
      assert(drive.type === "drive", `expected type=drive, got ${drive.type}`);
      assert(drive.node.id === created[0].node.id, "id mismatch");
      assert(
        drive.files.some((f) => f.path === "README.md"),
        "README.md not found in Drive files",
      );
    });

    await step("GET /file-trees/{id}/files/README.md — read seeded content", async () => {
      const file = await api<FileContentVO>(
        "GET",
        `/file-trees/${created[0].node.id}/files/README.md?type=drive`,
      );
      assert(file.content.includes("Launch Assets"), "unexpected README content");
      assert(file.contentHash.startsWith("sha256:"), "unexpected hash format");
    });
  }

  // ── CR: update README.md via review workflow ───────────────────────────────

  if (created[0]) {
    const target = created[0];
    let crId = "";
    const updatedContent = `# ${target.node.name}\n\nUpdated by 11-drives.ts via the OpenAPI change-request workflow.\n`;

    await step(`POST /file-trees/{id}/change-requests — update README.md`, async () => {
      const cr = await api<ChangeRequestVO>(
        "POST",
        `/file-trees/${target.node.id}/change-requests`,
        {
          type: "drive",
          message: "demo: update README via CR",
          submittedBy: "demo-script",
          // Review-first demo step: `autoMerge` is permission-aware when omitted and
          // this script has write access, so review must be requested explicitly.
          autoMerge: false,
          operations: [{ kind: "update", path: "README.md", content: updatedContent }],
        },
      );
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

    await step("GET /file-trees/{id}/files/README.md — verify merged content", async () => {
      const file = await api<FileContentVO>(
        "GET",
        `/file-trees/${target.node.id}/files/README.md?type=drive`,
      );
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
