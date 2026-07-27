// Source entry for the "Workspace Data Explorer" demo's bundled `client.js`.
//
// Kept in the repo (rather than only as the minified blob baked into
// `demo-content-data-explorer.ts`) so the demo's behaviour is reviewable and
// re-bundlable. Rebuild with:
//
//   pnpm --filter busabase-sdk build
//   node packages/busabase-core/scripts/build-data-explorer-client.mjs
//
// Note there is no deployment probing and no bridge prefix: the app calls
// `/api/v1` on its own origin, which is Busabase itself when deployed and the
// app's own dev proxy when run standalone.
import { createBusabaseClient } from "busabase-sdk";

const statusEl = document.getElementById("status");
const listEl = document.getElementById("list");
const detailEl = document.getElementById("detail");

const client = createBusabaseClient({ baseUrl: window.location.origin });

const setStatus = (text, tone = "") => {
  statusEl.textContent = text;
  statusEl.className = tone ? `status ${tone}` : "status";
};

const escapeHtml = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (character) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character],
  );

const TYPE_LABELS = {
  folder: "Folders",
  base: "Bases",
  doc: "Docs",
  file: "Files",
  drive: "Drives",
  skill: "Skills",
  airapp: "AirApps",
};

const flatten = (nodes, out = []) => {
  for (const node of nodes ?? []) {
    // Skip the synthetic space-root wrapper; its children are the real tree.
    if (node.parentId !== null) out.push(node);
    if (node.children?.length) flatten(node.children, out);
  }
  return out;
};

const renderDetail = (html) => {
  detailEl.innerHTML = html;
};

const renderRecords = async (node) => {
  if (!node.baseId) {
    renderDetail(`<p class="loading">This Base has no materialized base id.</p>`);
    return;
  }
  const page = await client.records.listPaged({ baseId: node.baseId, limit: 50 });
  const records = page.records ?? [];
  if (!records.length) {
    renderDetail(`<h2>${escapeHtml(node.name)}</h2><p class="loading">No records yet.</p>`);
    return;
  }
  const columns = [...new Set(records.flatMap((r) => Object.keys(r.headCommit?.fields ?? {})))];
  const head = columns.map((c) => `<th>${escapeHtml(c)}</th>`).join("");
  const body = records
    .map(
      (record) =>
        `<tr>${columns
          .map((column) => `<td>${escapeHtml(record.headCommit?.fields?.[column])}</td>`)
          .join("")}</tr>`,
    )
    .join("");
  renderDetail(
    `<h2>${escapeHtml(node.name)}</h2>` +
      `<p class="loading">${records.length} record(s)${page.nextCursor ? "+" : ""}</p>` +
      `<table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`,
  );
};

const renderDoc = async (node) => {
  const doc = await client.docs.get({ nodeId: node.id });
  renderDetail(`<h2>${escapeHtml(node.name)}</h2><pre>${escapeHtml(doc.body ?? "(empty)")}</pre>`);
};

const renderFile = async (node) => {
  const file = await client.files.get({ nodeId: node.id });
  const asset = file.asset ?? {};
  renderDetail(
    `<h2>${escapeHtml(node.name)}</h2>` +
      `<p class="loading">${escapeHtml(asset.mimeType ?? "unknown")} · ${escapeHtml(asset.size ?? "?")} bytes</p>`,
  );
};

const openNode = async (node) => {
  renderDetail(`<p class="loading">Loading ${escapeHtml(node.name)}…</p>`);
  try {
    if (node.type === "base") await renderRecords(node);
    else if (node.type === "doc") await renderDoc(node);
    else if (node.type === "file") await renderFile(node);
    else
      renderDetail(
        `<h2>${escapeHtml(node.name)}</h2><p class="loading">No preview for ${escapeHtml(node.type)} nodes.</p>`,
      );
  } catch (error) {
    renderDetail(`<p class="loading">Could not load this node: ${escapeHtml(error?.message)}</p>`);
  }
};

const renderList = (nodes) => {
  const groups = new Map();
  for (const node of nodes) {
    if (!groups.has(node.type)) groups.set(node.type, []);
    groups.get(node.type).push(node);
  }
  listEl.innerHTML = "";
  for (const [type, group] of groups) {
    const heading = document.createElement("h3");
    heading.textContent = `${TYPE_LABELS[type] ?? type} (${group.length})`;
    listEl.append(heading);
    for (const node of group) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "node";
      button.textContent = node.name;
      button.addEventListener("click", () => void openNode(node));
      listEl.append(button);
    }
  }
};

(async () => {
  try {
    const nodes = flatten(await client.nodes.list({}));
    if (!nodes.length) {
      setStatus("Connected — this workspace has no nodes yet.", "warn");
      return;
    }
    renderList(nodes);
    setStatus(`Connected — ${nodes.length} node(s) in this workspace.`, "ok");
  } catch (error) {
    setStatus(
      `Could not reach /api/v1 on this origin: ${error?.message ?? error}. Deployed in Busabase this is served by Busabase itself; running standalone, set BUSABASE_BASE_URL.`,
      "warn",
    );
  }
})();
