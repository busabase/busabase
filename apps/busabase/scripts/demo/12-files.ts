/**
 * 12-files: Full File-node lifecycle — upload an Asset, then create a first-class
 * File node that references it, list, and read back its Asset metadata.
 *
 * Mirrors the real uploader (busabase-core use-attachment-upload):
 *   POST /assets/upload-urls → push bytes (dev relay) → POST /assets/confirmations → POST /files
 *
 * `GET /files` and `GET /files/{nodeId}` were retired by the unified Node
 * surface: list File nodes with `GET /nodes?types=file` (FLAT lightweight
 * summaries — the retired list resolved a full AssetVO per row) and read one
 * with `GET /nodes/{nodeId}`, whose `type: "file"` variant is the exact old
 * `FileNodeVO` plus a `type` discriminator. `POST /files` is untouched.
 */

import { api, assert, BASE, makeRunner, type NodeTreeVO } from "./_client";
import { findFolderBySlug, moveNodeToFolder, needsMove } from "./_nodes";

interface NodeVO {
  id: string;
  slug: string;
  name: string;
  type: string;
  children?: NodeVO[];
}

interface UploadUrlVO {
  uploadUrl: string;
  storageKey: string;
  publicUrl: string;
  duplicate?: boolean;
  attachmentId?: string;
  assetId?: string;
}

interface ConfirmVO {
  attachmentId: string;
  assetId?: string;
  storageKey: string;
  publicUrl: string;
}

interface AssetVO {
  id: string;
  fileName: string;
  mimeType: string;
  size: number;
  contentKind: string;
  url: string;
}

/** What `POST /files` returns (no `type` discriminator on the envelope). */
interface FileNodeVO {
  node: NodeVO;
  asset: AssetVO;
}

/** The `type: "file"` variant of `NodeDetailVO` from `GET /nodes/{nodeId}`. */
interface FileNodeDetailVO extends FileNodeVO {
  type: "file";
}

const CONTEXT = "file-node-demo";

const DEMO_FILES = [
  {
    slug: "demo-product-brief",
    name: "Product Brief",
    description: "Demo File node uploaded via the OpenAPI asset flow.",
    fileName: "product-brief.md",
    mimeType: "text/markdown",
    body: "# Product Brief\n\nUploaded by 12-files.ts to verify the File-node OpenAPI flow.\n",
  },
  {
    slug: "demo-q3-metrics",
    name: "Q3 Metrics",
    description: "Demo CSV File node.",
    fileName: "q3-metrics.csv",
    mimeType: "text/csv",
    body: "metric,value\nsignups,1240\nactivation_rate,0.38\n",
  },
];

/** Push bytes to the upload target: dev relay (multipart POST) or presigned PUT. */
async function pushBytes(upload: UploadUrlVO, buffer: Buffer, mimeType: string, fileName: string) {
  if (upload.uploadUrl.startsWith("/")) {
    const form = new FormData();
    form.append("file", new Blob([new Uint8Array(buffer)], { type: mimeType }), fileName);
    form.append("storageKey", upload.storageKey);
    const res = await fetch(`${BASE}${upload.uploadUrl}`, { method: "POST", body: form });
    if (!res.ok) throw new Error(`dev upload failed (${res.status})`);
  } else {
    const res = await fetch(upload.uploadUrl, {
      method: "PUT",
      headers: { "content-type": mimeType },
      body: new Blob([new Uint8Array(buffer)], { type: mimeType }),
    });
    if (!res.ok) throw new Error(`presigned upload failed (${res.status})`);
  }
}

export async function run() {
  const { step, summary } = makeRunner("12-files");
  console.log(`\n📎  Files  →  ${BASE}\n`);

  // ── Find Files folder ──────────────────────────────────────────────────────

  let parentNodeId: string | undefined;
  let nodes: NodeTreeVO[] = [];
  await step("GET /nodes — locate Files folder", async () => {
    nodes = await api<NodeTreeVO[]>("GET", "/nodes");
    parentNodeId = findFolderBySlug(nodes, "files")?.node.id;
    assert(!!parentNodeId, "Files folder not found; run 01-folders first");
  });

  // ── Create files (upload Asset → create File node, idempotent by slug) ──────

  const created: FileNodeVO[] = [];

  for (const def of DEMO_FILES) {
    await step(`POST /files — upload + create "${def.name}" (idempotent)`, async () => {
      // Skip the upload entirely if this File node already exists (re-runnable,
      // and avoids leaving orphan Assets behind on repeat runs). The summary
      // list carries no `asset`, and the detail step below needs one, so open
      // the match once it is found rather than reusing a thin row.
      const existing = await api<NodeVO[]>("GET", "/nodes?types=file");
      const already = existing.find((f) => f.slug === def.slug);
      if (already) {
        if (needsMove(nodes, def.slug, "files")) {
          await moveNodeToFolder(def.slug, "files", nodes);
        }
        created.push(await api<FileNodeDetailVO>("GET", `/nodes/${already.id}`));
        return;
      }

      const buffer = Buffer.from(def.body, "utf8");
      const upload = await api<UploadUrlVO>("POST", "/assets/upload-urls", {
        fileName: def.fileName,
        mimeType: def.mimeType,
        sizeBytes: buffer.length,
        context: CONTEXT,
      });

      let assetId = upload.assetId ?? upload.attachmentId;
      if (!(upload.duplicate && assetId)) {
        await pushBytes(upload, buffer, def.mimeType, def.fileName);
        const confirmed = await api<ConfirmVO>("POST", "/assets/confirmations", {
          storageKey: upload.storageKey,
          fileName: def.fileName,
          mimeType: def.mimeType,
          sizeBytes: buffer.length,
          context: CONTEXT,
        });
        assetId = confirmed.assetId ?? confirmed.attachmentId;
      }
      assert(!!assetId, "no assetId resolved from upload/confirm");

      const file = await api<FileNodeVO>("POST", "/files", {
        slug: def.slug,
        name: def.name,
        description: def.description,
        assetId,
        ...(parentNodeId ? { parentNodeId } : {}),
        // Smoke-testing the API surface, not the review-first policy — opt out
        // the same way a seed script does.
        autoMerge: true,
      });
      assert(file.node.slug === def.slug, `slug mismatch: ${file.node.slug}`);
      assert(file.node.type === "file", `expected type=file, got ${file.node.type}`);
      assert(
        file.asset.fileName === def.fileName,
        `asset fileName mismatch: ${file.asset.fileName}`,
      );
      created.push(file);
    });
  }

  // ── GET /nodes?types=file ──────────────────────────────────────────────────

  await step("GET /nodes?types=file — all created slugs present", async () => {
    const list = await api<NodeVO[]>("GET", "/nodes?types=file");
    assert(
      list.every((f) => f.type === "file"),
      "expected only file nodes",
    );
    const slugs = new Set(list.map((f) => f.slug));
    for (const def of DEMO_FILES) {
      assert(slugs.has(def.slug), `slug "${def.slug}" missing from GET /nodes?types=file`);
    }
    // The reason this replaced `GET /files`: no AssetVO resolved per row.
    assert(
      list.every((f) => !("asset" in f)),
      "summary list must not hydrate backing Assets",
    );
  });

  // ── GET /nodes/{id} — File node detail + backing Asset ─────────────────────

  if (created[0]) {
    await step("GET /nodes/{id} — detail includes backing Asset", async () => {
      const file = await api<FileNodeDetailVO>("GET", `/nodes/${created[0].node.id}`);
      assert(file.type === "file", `expected type=file, got ${file.type}`);
      assert(file.node.id === created[0].node.id, "id mismatch");
      assert(file.asset.size > 0, "expected non-empty asset size");
      assert(typeof file.asset.url === "string", "expected asset url");
    });
  }

  return summary();
}

if (process.argv[1]?.endsWith("12-files.ts")) {
  run().then(({ fail }) => {
    if (fail > 0) process.exit(1);
  });
}
