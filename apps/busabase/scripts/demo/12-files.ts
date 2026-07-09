/**
 * 12-files: Full File-node lifecycle — upload an Asset, then create a first-class
 * File node that references it, list, and read back its Asset metadata.
 *
 * Mirrors the real uploader (busabase-core use-attachment-upload):
 *   POST /assets/upload-urls → push bytes (dev relay) → POST /assets/confirmations → POST /files
 */

import { api, assert, BASE, makeRunner } from "./_client";

interface NodeVO {
  id: string;
  slug: string;
  name: string;
  type: string;
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

interface FileNodeVO {
  node: NodeVO;
  asset: AssetVO;
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
  await step("GET /nodes — locate Files folder", async () => {
    const nodes = await api<NodeVO[]>("GET", "/nodes");
    const folder = nodes.find((n) => n.type === "folder" && n.name === "Files");
    parentNodeId = folder?.id;
  });

  // ── Create files (upload Asset → create File node, idempotent by slug) ──────

  const created: FileNodeVO[] = [];

  for (const def of DEMO_FILES) {
    await step(`POST /files — upload + create "${def.name}" (idempotent)`, async () => {
      // Skip the upload entirely if this File node already exists (re-runnable,
      // and avoids leaving orphan Assets behind on repeat runs).
      const existing = await api<FileNodeVO[]>("GET", "/files");
      const already = existing.find((f) => f.node.slug === def.slug);
      if (already) {
        created.push(already);
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

  // ── GET /files ─────────────────────────────────────────────────────────────

  await step("GET /files — all created slugs present", async () => {
    const list = await api<FileNodeVO[]>("GET", "/files");
    const slugs = new Set(list.map((f) => f.node.slug));
    for (const def of DEMO_FILES) {
      assert(slugs.has(def.slug), `slug "${def.slug}" missing from GET /files`);
    }
  });

  // ── GET /files/{id} — File node detail + backing Asset ─────────────────────

  if (created[0]) {
    await step("GET /files/{id} — detail includes backing Asset", async () => {
      const file = await api<FileNodeVO>("GET", `/files/${created[0].node.id}`);
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
