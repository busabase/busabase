/**
 * 14-airapps: create all example AirApp nodes (see `busabase-core/domains/
 * airapp/demo-content` for the full catalog and the Nodepod/Vite/Babel/SWC/
 * HyperFrames investigation behind each one) via the real REST API — the OpenAPI create
 * → approve/merge path, the same one an agent goes through, not the Run
 * panel itself (clicking Run is a browser-only action, not exercised here).
 * Use `webapp-testing` against a live dev server to click Run and see an
 * AirApp actually execute.
 *
 * Places every created node under the "AirApps" sidebar folder (same folder
 * `pnpm db:seed:all` creates via `FILE_TREE_FOLDER_CONFIG` in
 * `busabase-core/logic/seed.ts`), mirroring how `06-skills.ts`/`11-drives.ts`
 * attach their demo nodes to the "Agent Skills"/"Drives" folders instead of
 * leaving them loose at root.
 */

import { ALL_AIRAPP_DEMOS } from "busabase-core/domains/airapp/demo-content";
import { ApiError, api, assert, BASE, makeRunner, type NodeTreeVO } from "./_client";
import { findFolderBySlug, moveNodeToFolder, needsMove } from "./_nodes";

interface NodeVO {
  id: string;
  slug: string;
  name: string;
  type: string;
  children?: NodeVO[];
}

/** What `POST /file-trees` returns (no `type` discriminator on the envelope). */
interface AirAppVO {
  node: NodeVO;
  entryFile: string;
  visibility: string;
  version: string;
  files: Array<{ path: string; name: string }>;
}

/**
 * The `type: "airapp"` variant of `NodeDetailVO` from `GET /nodes/{nodeId}`.
 * `GET /file-trees` / `GET /file-trees/{nodeId}` were retired by the unified
 * Node surface; `GET /nodes?types=airapp` lists FLAT lightweight summaries and
 * this is what opening one returns.
 */
interface AirAppDetailVO extends AirAppVO {
  type: "airapp";
}

interface FileContentVO {
  nodeId: string;
  path: string;
  content: string;
  contentHash: string;
}

/** The `dev` script a demo's own `package.json` ships, or "" if it has none. */
function devScriptOf(def: { files: ReadonlyArray<{ path: string; content?: string }> }): string {
  const pkg = def.files.find((f) => f.path === "package.json");
  if (!pkg?.content) return "";
  try {
    return (JSON.parse(pkg.content) as { scripts?: { dev?: string } }).scripts?.dev ?? "";
  } catch {
    return "";
  }
}

/** The command the server named in an AIRAPP_NOT_RUNNABLE rejection, e.g. `vite`. */
function rejectedCommand(err: ApiError): string | undefined {
  return /starts `([^`]+)`/.exec(err.body)?.[1];
}

export async function run() {
  const { step, summary } = makeRunner("14-airapps");
  console.log(`\n📱  AirApps  →  ${BASE}\n`);

  let parentNodeId: string | undefined;
  let nodes: NodeTreeVO[] = [];
  await step("GET /nodes — locate AirApps folder", async () => {
    nodes = await api<NodeTreeVO[]>("GET", "/nodes");
    parentNodeId = findFolderBySlug(nodes, "airapps")?.node.id;
    assert(!!parentNodeId, "AirApps folder not found; run 01-folders first");
  });

  const created: AirAppVO[] = [];
  /** Demos the server refuses to store at all — see the AIRAPP_NOT_RUNNABLE branch. */
  const rejected = new Set<string>();

  for (const def of ALL_AIRAPP_DEMOS) {
    await step(`POST /file-trees — create "${def.name}" (idempotent)`, async () => {
      let airapp: AirAppVO;
      try {
        airapp = await api<AirAppVO>("POST", "/file-trees", {
          slug: def.slug,
          type: "airapp",
          name: def.name,
          description: def.description,
          files: def.files,
          ...(parentNodeId ? { parentNodeId } : {}),
          autoMerge: true,
          // These demos each hand over a complete, self-contained project
          // (Hono, Vite, SQLite, ...) — replace the default Hono-template
          // seed files entirely rather than merging with them by path, or
          // e.g. the Vite demos would end up with stray server.js/style.css/
          // client.js left over from the default template mixed into an
          // unrelated Vite project.
          mergeMode: "replace",
        });
      } catch (err) {
        // An AirApp whose `dev` script starts a bundler is refused on write: Vite and
        // friends cannot boot under Nodepod, so storing one would only move the failure
        // to Run time. Some demos in this catalog are exactly that, and asserting the
        // refusal is the real coverage — silently treating it as "already exists" is
        // what hid the 422 behind a phantom "missing after create failed".
        if (err instanceof ApiError && err.code === "AIRAPP_NOT_RUNNABLE") {
          const command = rejectedCommand(err);
          assert(err.status === 422, `expected 422, got ${err.status}`);
          assert(!!command, `rejection did not name the offending command: ${err.body}`);
          assert(
            devScriptOf(def).includes(command),
            `server rejected \`${command}\` but "${def.slug}" runs \`${devScriptOf(def)}\``,
          );
          rejected.add(def.slug);
          return;
        }
        // Anything else: this may just be a re-run over a node a previous run created.
        // The summary list has no `files`, and the file-count assertion below needs
        // them — find it in the summary, then open it. If it genuinely isn't there,
        // rethrow the ORIGINAL error rather than inventing a misleading one.
        const list = await api<NodeVO[]>("GET", "/nodes?types=airapp");
        const found = list.find((m) => m.slug === def.slug);
        if (!found) throw err;
        airapp = await api<AirAppDetailVO>("GET", `/nodes/${found.id}?type=airapp`);
      }
      assert(airapp.node.slug === def.slug, `slug mismatch: ${airapp.node.slug}`);
      assert(airapp.node.type === "airapp", `expected type=airapp, got ${airapp.node.type}`);
      assert(
        airapp.files.length === def.files.length,
        `expected ${def.files.length} files, got ${airapp.files.length}`,
      );
      if (needsMove(nodes, def.slug, "airapps")) {
        await moveNodeToFolder(def.slug, "airapps", nodes);
      }
      created.push(airapp);
    });
  }

  await step("GET /nodes?types=airapp — all created slugs present", async () => {
    const list = await api<NodeVO[]>("GET", "/nodes?types=airapp");
    assert(
      list.every((m) => m.type === "airapp"),
      "expected only airapp nodes",
    );
    const slugs = new Set(list.map((m) => m.slug));
    for (const def of ALL_AIRAPP_DEMOS) {
      // A demo refused as not-runnable was never stored, by design — assert it is
      // absent rather than skipping it, so a silent partial write would still fail.
      if (rejected.has(def.slug)) {
        assert(!slugs.has(def.slug), `rejected AirApp "${def.slug}" was stored anyway`);
        continue;
      }
      assert(slugs.has(def.slug), `slug "${def.slug}" missing from GET /nodes?types=airapp`);
    }
    // The reason this replaced `GET /file-trees`: no per-node file inventory.
    assert(
      list.every((m) => !("files" in m)),
      "summary list must not hydrate file inventories",
    );
  });

  const honoDemo = created.find((airapp) => airapp.node.slug === "demo-hono-api");
  if (honoDemo) {
    await step("GET /file-trees/{id}/files/package.json — read seeded content", async () => {
      const file = await api<FileContentVO>(
        "GET",
        `/file-trees/${honoDemo.node.id}/files/package.json?type=airapp`,
      );
      assert(file.content.includes("hono-api-demo"), "unexpected package.json content");
      assert(file.contentHash.startsWith("sha256:"), "unexpected hash format");
    });
  }

  return summary();
}

if (process.argv[1]?.endsWith("14-airapps.ts")) {
  run().then(({ fail }) => {
    if (fail > 0) process.exit(1);
  });
}
