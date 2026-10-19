/**
 * First-screen benchmark: what does opening a big workspace cost?
 *
 * The sidebar tree is already depth-bounded (root + 2 levels, deeper folders
 * load on expand), so the tree itself is not the question. The question is
 * everything ELSE the dashboard fetches on its first paint, measured against a
 * workspace big enough to matter: a couple of thousand nodes, hundreds of
 * Bases with their fields and views, and a Trash with real content in it.
 *
 * Every row reports both wall time and response BYTES — on a remote host the
 * payload size, not the server's wait, is usually what the user feels.
 *
 * Drives the real oRPC router over PGLite in a temp dir (same setup as
 * bench-records.ts).
 *
 * Usage:
 *   pnpm --filter busabase-core bench:sidebar
 *   BENCH_TOP_FOLDERS=60 pnpm --filter busabase-core bench:sidebar
 *   BENCH_DATA_DIR=~/.cache/bench-sidebar BENCH_SKIP_SEED=1 pnpm --filter busabase-core bench:sidebar
 */
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRouterClient } from "@orpc/server";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_CWD = path.resolve(__dirname, "../../../apps/busabase");

const TOP_FOLDERS = Number(process.env.BENCH_TOP_FOLDERS ?? 30);
/** Per top folder: sub-folders, Bases, Docs directly inside it. */
const SUB_FOLDERS = Number(process.env.BENCH_SUB_FOLDERS ?? 8);
const TOP_BASES = Number(process.env.BENCH_TOP_BASES ?? 6);
const TOP_DOCS = Number(process.env.BENCH_TOP_DOCS ?? 6);
/** Per sub-folder: Bases and Docs inside it (third level, below the prefetch depth). */
const LEAF_BASES = Number(process.env.BENCH_LEAF_BASES ?? 2);
const LEAF_DOCS = Number(process.env.BENCH_LEAF_DOCS ?? 6);
const FIELDS_PER_BASE = Number(process.env.BENCH_FIELDS_PER_BASE ?? 10);
/** Top folders moved to Trash (with everything inside). */
const ARCHIVED_TOP_FOLDERS = Number(process.env.BENCH_ARCHIVED_TOP_FOLDERS ?? 3);
const WARM_RUNS = Number(process.env.BENCH_WARM_RUNS ?? 3);
const REUSE_DIR = process.env.BENCH_DATA_DIR ?? "";
const SKIP_SEED = process.env.BENCH_SKIP_SEED === "1";

const kb = (value: unknown) =>
  (Buffer.byteLength(JSON.stringify(value) ?? "", "utf8") / 1024).toFixed(1);

const countNodes = (nodes: Array<{ children?: unknown[] }>): number =>
  nodes.reduce(
    (sum, node) => sum + 1 + countNodes((node.children ?? []) as Array<{ children?: unknown[] }>),
    0,
  );

async function bench<T>(label: string, fn: () => Promise<T>, describe: (out: T) => string) {
  const t0 = performance.now();
  let out = await fn();
  const coldMs = performance.now() - t0;
  const warm: number[] = [];
  for (let run = 0; run < WARM_RUNS; run++) {
    const t = performance.now();
    out = await fn();
    warm.push(performance.now() - t);
  }
  const avgWarm = warm.reduce((a, b) => a + b, 0) / (warm.length || 1);
  console.log(
    `  ${label.padEnd(52)} cold=${String(Math.round(coldMs)).padStart(6)}ms  warm=${String(Math.round(avgWarm)).padStart(6)}ms  ${kb(out).padStart(8)}KB  ${describe(out)}`,
  );
}

async function main() {
  process.chdir(MIGRATIONS_CWD);
  const storageDir = await mkdtemp(path.join(os.tmpdir(), "busabase-bench-sidebar-storage-"));
  const dataDir = REUSE_DIR
    ? path.resolve(REUSE_DIR.replace(/^~/, os.homedir()))
    : await mkdtemp(path.join(os.tmpdir(), "busabase-bench-sidebar-db-"));
  process.env.PG_DATABASE_URL = `pglite://${dataDir}`;
  process.env.STORAGE_URL = `local:${storageDir}?base_url=/api/bench/storage`;

  const { busabaseRouter } = await import("../src/router");
  const { listViews } = await import("../src/domains/base/logic/queries");
  const client = createRouterClient(busabaseRouter);

  const fields = Array.from({ length: FIELDS_PER_BASE }, (_, i) => ({
    slug: `f${i}`,
    name: `Field ${i}`,
    type: (i === 0 ? "text" : i % 3 === 0 ? "number" : "text") as "text" | "number",
  }));

  // The router client has no actor, so nothing auto-merges — approve + merge
  // explicitly, the same way bench-records.ts lands its imports.
  const mergeNow = async (changeRequest: { id: string; status?: string }) => {
    if (changeRequest.status === "merged") return;
    await client.changeRequests.review({
      changeRequestIds: [changeRequest.id],
      verdict: "approved",
    });
    await client.changeRequests.merge({ changeRequestIds: [changeRequest.id] });
  };

  const rootTree = await client.nodes.list({ parentId: null, depth: 1 });
  const rootId = rootTree[0]?.id;
  if (!rootId) throw new Error("no space root");

  if (!SKIP_SEED) {
    console.log(`Seeding ${TOP_FOLDERS} top folders...`);
    const t0 = performance.now();
    for (let t = 0; t < TOP_FOLDERS; t++) {
      // One change request per top folder: the folder + its whole subtree,
      // parented by ref so it lands in a single merge.
      type Operation = Parameters<typeof client.nodes.createChangeRequest>[0]["operations"][number];
      const operations: Operation[] = [
        {
          kind: "create",
          ref: "top",
          parentNodeId: rootId,
          nodeType: "folder",
          slug: `bench-t${t}`,
          name: `Team ${t}`,
        } as Operation,
      ];
      for (let b = 0; b < TOP_BASES; b++)
        operations.push({
          kind: "create",
          ref: `tb${b}`,
          parentNodeRef: "top",
          nodeType: "base",
          slug: `bench-t${t}-b${b}`,
          name: `Base ${t}.${b}`,
          fields,
        } as Operation);
      for (let d = 0; d < TOP_DOCS; d++)
        operations.push({
          kind: "create",
          ref: `td${d}`,
          parentNodeRef: "top",
          nodeType: "doc",
          slug: `bench-t${t}-d${d}`,
          name: `Doc ${t}.${d}`,
        } as Operation);
      for (let s = 0; s < SUB_FOLDERS; s++) {
        operations.push({
          kind: "create",
          ref: `s${s}`,
          parentNodeRef: "top",
          nodeType: "folder",
          slug: `bench-t${t}-s${s}`,
          name: `Project ${t}.${s}`,
        } as Operation);
        for (let b = 0; b < LEAF_BASES; b++)
          operations.push({
            kind: "create",
            ref: `s${s}b${b}`,
            parentNodeRef: `s${s}`,
            nodeType: "base",
            slug: `bench-t${t}-s${s}-b${b}`,
            name: `Base ${t}.${s}.${b}`,
            fields,
          } as Operation);
        for (let d = 0; d < LEAF_DOCS; d++)
          operations.push({
            kind: "create",
            ref: `s${s}d${d}`,
            parentNodeRef: `s${s}`,
            nodeType: "doc",
            slug: `bench-t${t}-s${s}-d${d}`,
            name: `Doc ${t}.${s}.${d}`,
          } as Operation);
      }
      await mergeNow(
        await client.nodes.createChangeRequest({ message: `Seed team ${t}`, operations }),
      );
      if ((t + 1) % 10 === 0) console.log(`  ${t + 1}/${TOP_FOLDERS}`);
    }
    console.log(`Seeded in ${Math.round((performance.now() - t0) / 1000)}s`);

    const full = await client.nodes.list({});
    const topFolders = full[0]?.children.filter((node) => node.slug.startsWith("bench-t")) ?? [];
    for (const folder of topFolders.slice(0, ARCHIVED_TOP_FOLDERS)) {
      await mergeNow(
        await client.nodes.createChangeRequest({
          message: `Archive ${folder.name}`,
          operations: [{ kind: "delete", nodeId: folder.id }],
        }),
      );
    }
  }

  const full = await client.nodes.list({});
  const topFolder = full[0]?.children.find((node) => node.slug.startsWith("bench-t"));
  const subFolder = topFolder?.children.find((node) => node.type === "folder");
  const deepDoc = subFolder?.children.find((node) => node.type === "doc");
  console.log(
    `\n=== Workspace: ${countNodes(full)} live nodes, ${(await client.bases.list({})).length} live bases ===\n`,
  );

  console.log("[sidebar tree]");
  await bench(
    "nodes.list({ parentId: null, depth: 2 })  ← web root",
    () => client.nodes.list({ parentId: null, depth: 2 }),
    (out) => `${countNodes(out)} nodes`,
  );
  await bench(
    "nodes.list({})  ← full tree (mobile drawer)",
    () => client.nodes.list({}),
    (out) => `${countNodes(out)} nodes`,
  );
  if (topFolder) {
    await bench(
      "nodes.list({ parentId: top, depth: 2 })  ← expand",
      () => client.nodes.list({ parentId: topFolder.id, depth: 2 }),
      (out) => `${countNodes(out)} nodes`,
    );
    await bench(
      "nodes.list({ parentId: top, depth: 1 })",
      () => client.nodes.list({ parentId: topFolder.id, depth: 1 }),
      (out) => `${countNodes(out)} nodes`,
    );
  }
  if (deepDoc) {
    await bench(
      "nodes.ancestors(deep doc)  ← deep link reveal",
      () => client.nodes.ancestors({ nodeId: deepDoc.id, type: "doc" }),
      (out) => JSON.stringify(out).slice(0, 60),
    );
  }

  console.log("\n[other first-screen requests]");
  await bench(
    "bases.list({})",
    () => client.bases.list({}),
    (out) => `${out.length} bases, ${out.reduce((n, b) => n + b.fields.length, 0)} fields`,
  );
  await bench(
    'bases.list({ fields: "links" })  ← Base design page',
    () => client.bases.list({ fields: "links" }),
    (out) => `${out.length} bases, ${out.reduce((n, b) => n + b.fields.length, 0)} fields`,
  );
  const someBase = (await client.bases.list({}))[0];
  if (someBase) {
    await bench(
      "bases.get(one Base)  ← just the open Base",
      () => client.bases.get({ baseId: someBase.slug }),
      (out) => `${out.fields.length} fields`,
    );
  }
  await bench(
    'nodes.list({ types: ["base"] })  ← names only',
    () => client.nodes.list({ types: ["base"] }),
    (out) => `${out.length} bases`,
  );
  await bench(
    "listViews()  ← Cloud SSR seed, every view in the space",
    () => listViews(),
    (out) => `${(out as unknown[]).length} views`,
  );
  await bench(
    'nodes.list({ status: "archived" })',
    () => client.nodes.list({ status: "archived" }),
    (out) => `${out.length} nodes`,
  );
  await bench(
    'bases.list({ status: "archived" })',
    () => client.bases.list({ status: "archived" }),
    (out) => `${out.length} bases`,
  );
  await bench(
    "auditEvents.list({})",
    () => client.auditEvents.list({}),
    (out) => `${(out as unknown[]).length} events`,
  );
  await bench(
    "nodes.listFavorites({})",
    () => client.nodes.listFavorites({}),
    (out) => `${(out as unknown[]).length} favorites`,
  );
  await bench(
    "nodes.share.list({})",
    () => client.nodes.share.list({}),
    (out) => `${(out as unknown[]).length} shares`,
  );
  console.log(`\nData dir: ${dataDir}`);
}

main().then(
  () => process.exit(0),
  (error) => {
    console.error(error);
    process.exit(1);
  },
);
