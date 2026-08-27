import { micromark } from "micromark";
import type { EmbedNodeDetailVO } from "./types";

const styles = `
:root {
  color-scheme: light dark;
  font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  background: Canvas;
  color: CanvasText;
}
* { box-sizing: border-box; }
html, body { min-height: 100%; margin: 0; }
body { background: Canvas; color: CanvasText; }
a { color: LinkText; }
main { min-height: 100vh; }
.table-wrap { max-width: 100%; overflow: auto; }
table { width: 100%; min-width: max-content; border-collapse: collapse; font-size: 0.875rem; }
th, td { max-width: 20rem; padding: 0.75rem 1rem; border-bottom: 1px solid color-mix(in srgb, CanvasText 16%, transparent); text-align: left; vertical-align: top; }
th { background: color-mix(in srgb, CanvasText 5%, Canvas); color: color-mix(in srgb, CanvasText 70%, transparent); font-weight: 600; }
td span { display: -webkit-box; overflow: hidden; overflow-wrap: anywhere; white-space: pre-wrap; -webkit-box-orient: vertical; -webkit-line-clamp: 4; }
.empty { margin: 0; padding: 2.5rem 1rem; color: color-mix(in srgb, CanvasText 62%, transparent); text-align: center; }
.markdown { max-width: 76ch; padding: 1.5rem clamp(1.25rem, 4vw, 2rem); line-height: 1.65; }
.markdown :first-child { margin-top: 0; }
.markdown :last-child { margin-bottom: 0; }
.markdown pre { max-width: 100%; overflow: auto; padding: 1rem; background: color-mix(in srgb, CanvasText 6%, Canvas); }
.markdown code { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; }
.file-tree { display: grid; min-height: 24rem; grid-template-columns: minmax(13rem, 17.5rem) minmax(0, 1fr); }
.file-list { margin: 0; padding: 0.75rem; border-right: 1px solid color-mix(in srgb, CanvasText 16%, transparent); background: color-mix(in srgb, CanvasText 3%, Canvas); list-style: none; }
.file-list li { overflow: hidden; padding: 0.4rem 0.5rem; font: 0.75rem/1.4 ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; text-overflow: ellipsis; white-space: nowrap; }
.file-content { min-width: 0; }
.file-path { padding: 0.75rem 1rem; border-bottom: 1px solid color-mix(in srgb, CanvasText 16%, transparent); color: color-mix(in srgb, CanvasText 65%, transparent); font: 0.75rem/1.4 ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; }
.file-content pre { max-height: 70vh; margin: 0; overflow: auto; padding: 1.25rem; overflow-wrap: anywhere; white-space: pre-wrap; font: 0.875rem/1.55 ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; }
.file-content > a, .file-content > p { display: inline-block; margin: 0; padding: 1.25rem; }
.details { display: grid; grid-template-columns: minmax(7rem, auto) minmax(0, 1fr); gap: 0.75rem 1.5rem; margin: 0; padding: 1.25rem; font-size: 0.875rem; }
.details dt { color: color-mix(in srgb, CanvasText 62%, transparent); }
.details dd { min-width: 0; margin: 0; overflow-wrap: anywhere; }
.mono { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; font-size: 0.75rem; }
.folder-list { margin: 0; padding: 0; list-style: none; }
.folder-list li { padding: 1rem 1.25rem; border-bottom: 1px solid color-mix(in srgb, CanvasText 16%, transparent); }
.folder-list strong { display: block; overflow: hidden; font-size: 0.875rem; text-overflow: ellipsis; white-space: nowrap; }
.folder-list span { display: block; margin-top: 0.25rem; color: color-mix(in srgb, CanvasText 62%, transparent); font-size: 0.75rem; text-transform: capitalize; }
@media (max-width: 640px) {
  .file-tree { grid-template-columns: 1fr; }
  .file-list { border-right: 0; border-bottom: 1px solid color-mix(in srgb, CanvasText 16%, transparent); }
  .details { grid-template-columns: 1fr; gap: 0.25rem; }
  .details dd { margin-bottom: 0.75rem; }
}
`;

const escapeHtml = (value: string): string =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");

const safeHref = (value: string): string | null => {
  if (value.startsWith("/") || value.startsWith("#")) return value;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : null;
  } catch {
    return null;
  }
};

const anchor = (href: string | null, label: string): string =>
  href
    ? `<a href="${escapeHtml(href)}" target="_blank" rel="noreferrer">${escapeHtml(label)}</a>`
    : `<span>${escapeHtml(label)}</span>`;

const displayName = (value: string | Record<string, string | undefined>): string => {
  if (typeof value === "string") return value;
  return value.en ?? value["zh-CN"] ?? Object.values(value).find(Boolean) ?? "Field";
};

/** A cell value's human-readable label, or null if it has no obvious one. */
const namedValue = (value: unknown): string | null => {
  if (typeof value !== "object" || value === null) return null;
  const record = value as Record<string, unknown>;
  for (const key of ["fileName", "displayName", "name", "title", "label", "text"]) {
    const candidate = record[key];
    if (typeof candidate === "string" && candidate !== "") return candidate;
  }
  return null;
};

const displayValue = (value: unknown): string => {
  if (value === null || value === undefined || value === "") return "-";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  // Attachments, links and select options arrive as objects (or arrays of them)
  // carrying a display label plus storage plumbing. `JSON.stringify` on those
  // renders a wall of ids, urls and byte counts into the cell — the Cover Image
  // column of a Blog base read as `[{"id":"att_…","url":"/assets/…","size":…}]`.
  // Prefer the label the object already names; only fall back to the raw shape
  // when there isn't one.
  const named = namedValue(value);
  if (named !== null) return named;
  if (Array.isArray(value)) {
    if (value.length === 0) return "-";
    const labels = value.map((item) => namedValue(item));
    if (labels.every((label) => label !== null)) return labels.join(", ");
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
};

export const nodeNameForEmbedDetail = (detail: EmbedNodeDetailVO): string => {
  if (detail.type === "base") return detail.base.name;
  if (detail.type === "doc") return detail.doc.node.name;
  if (detail.type === "file") return detail.file.node.name;
  if (detail.type === "drive") return detail.drive.node.name;
  if (detail.type === "skill") return detail.skill.node.name;
  if (detail.type === "airapp") return detail.airapp.node.name;
  return detail.folder.node.name;
};

const renderBase = (detail: Extract<EmbedNodeDetailVO, { type: "base" }>): string => {
  const fields = detail.base.fields;
  const headings = fields
    .map((field) => `<th>${escapeHtml(displayName(field.name))}</th>`)
    .join("");
  const rows = detail.records
    .map(
      (record) =>
        `<tr>${fields
          .map(
            (field) =>
              `<td><span>${escapeHtml(displayValue(record.headCommit.payload[field.slug]))}</span></td>`,
          )
          .join("")}</tr>`,
    )
    .join("");
  const empty = detail.records.length === 0 ? '<p class="empty">No records</p>' : "";
  return `<div class="table-wrap"><table><thead><tr>${headings}</tr></thead><tbody>${rows}</tbody></table>${empty}</div>`;
};

const renderFileTree = (
  detail: Extract<EmbedNodeDetailVO, { type: "drive" | "skill" }>,
): string => {
  const tree = detail.type === "drive" ? detail.drive : detail.skill;
  const files = tree.files.map((file) => `<li>${escapeHtml(file.path)}</li>`).join("");
  const path = escapeHtml(detail.entryFile?.path ?? tree.entryFile);
  let preview = "<p>No preview available</p>";
  if (detail.entryFile?.encoding === "utf8") {
    preview = `<pre>${escapeHtml(detail.entryFile.content)}</pre>`;
  } else if (detail.entryFile?.assetUrl) {
    preview = anchor(safeHref(detail.entryFile.assetUrl), "Open file");
  }
  return `<div class="file-tree"><ul class="file-list">${files}</ul><section class="file-content"><div class="file-path">${path}</div>${preview}</section></div>`;
};

const renderNodeContent = (detail: EmbedNodeDetailVO): string => {
  if (detail.type === "base") return renderBase(detail);
  if (detail.type === "doc") {
    return `<article class="markdown">${micromark(detail.doc.body)}</article>`;
  }
  if (detail.type === "drive" || detail.type === "skill") return renderFileTree(detail);
  if (detail.type === "file") {
    const { asset } = detail.file;
    return `<dl class="details"><dt>File name</dt><dd>${escapeHtml(asset.fileName)}</dd><dt>Type</dt><dd>${escapeHtml(asset.mimeType)}</dd><dt>Size</dt><dd>${asset.size.toLocaleString()} bytes</dd><dt>Content hash</dt><dd class="mono">${escapeHtml(asset.contentHash ?? "-")}</dd><dt>File</dt><dd>${anchor(safeHref(asset.url), "Open file")}</dd></dl>`;
  }
  if (detail.type === "airapp") return "";
  const children = detail.folder.children
    .map(
      (child) =>
        `<li><strong>${escapeHtml(child.name)}</strong><span>${escapeHtml(child.type)}</span></li>`,
    )
    .join("");
  return `<ul class="folder-list">${children}</ul>`;
};

const documentShell = (title: string, content: string): string =>
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex, nofollow"><meta name="referrer" content="no-referrer"><title>${escapeHtml(title)}</title><style>${styles}</style></head><body><main>${content}</main></body></html>`;

export const renderEmbedDocument = (detail: EmbedNodeDetailVO, title: string): string =>
  documentShell(title, renderNodeContent(detail));

export const renderUnavailableEmbedDocument = (): string =>
  documentShell("Content unavailable", '<p class="empty">Content unavailable</p>');
