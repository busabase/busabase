/**
 * The in-memory `busabase-package@1` tree — the shape both `layout-read` (repo dir
 * → tree) and `layout-write` (space subtree → tree → repo dir) speak, and that
 * `plan`/`apply` consume. Plus the format's shared validation rules (§6.3).
 */
import { extname } from "node:path";
import {
  PACKAGE_BASE_FILENAME,
  PACKAGE_FOLDER_META_FILENAME,
  PACKAGE_MANIFEST_FILENAME,
  PACKAGE_NODE_META_FILENAME,
  PACKAGE_NODE_META_SUFFIX,
  PACKAGE_RECORDS_FILENAME,
  type PackageBase,
  type PackageFileTreeNodeType,
  type PackageManifest,
  type PackageRecordLine,
} from "busabase-contract/domains/package/types";

/** A file carried verbatim inside a skill/airapp/drive, or a `file` node's bytes. */
export interface PackageFileEntry {
  /** Node-relative POSIX path, e.g. `scripts/extract.py`. */
  path: string;
  bytes: Buffer;
}

interface PackageNodeCommon {
  slug: string;
  name: string;
  description: string;
  /** Sibling order. Absent → alphabetical by slug. `publish` always writes it. */
  position: number | undefined;
}

export interface PackageFolderNode extends PackageNodeCommon {
  type: "folder";
  children: PackageNode[];
}

export interface PackageDocNode extends PackageNodeCommon {
  type: "doc";
  body: string;
}

export interface PackageBaseNode extends PackageNodeCommon {
  type: "base";
  base: PackageBase;
  records: PackageRecordLine[];
}

export interface PackageFileTreeNode extends PackageNodeCommon {
  type: PackageFileTreeNodeType;
  files: PackageFileEntry[];
}

export interface PackageFileNode extends PackageNodeCommon {
  type: "file";
  /** Original filename incl. extension — the asset's stored name (`report.pdf`). */
  fileName: string;
  mimeType: string;
  bytes: Buffer;
}

export type PackageNode =
  | PackageFolderNode
  | PackageDocNode
  | PackageBaseNode
  | PackageFileTreeNode
  | PackageFileNode;

export interface PackageTree {
  manifest: PackageManifest;
  /** Top-level nodes under `content/`. */
  nodes: PackageNode[];
}

// ── Validation (§6.3) ────────────────────────────────────────────────────────

/**
 * Every creatable node type's slug is `/^[a-z0-9-]+$/` across the whole API
 * (`docs.create`, `files.create`, `createFileTreeInputSchema`, `createBaseInputSchema`,
 * and the `nodes.createChangeRequest` create op all agree). Kebab-case is a strict
 * subset of "cross-platform-safe filename", so enforcing it here delivers §6.3's
 * filename-safety guarantee AND guarantees the slug is installable.
 */
export const NODE_SLUG_PATTERN = /^[a-z0-9-]+$/;

export const assertSafeNodeSlug = (slug: string, context: string): void => {
  if (!NODE_SLUG_PATTERN.test(slug)) {
    throw new Error(
      `Invalid slug "${slug}" (${context}). Slugs must be lowercase letters, digits, and hyphens only (a-z, 0-9, -) — that keeps them safe as file names on every OS and valid for the Busabase API. Rename it, e.g. "${suggestSlug(slug)}".`,
    );
  }
};

/** Best-effort kebab-case suggestion for an offending slug. */
export const suggestSlug = (value: string): string => {
  const suggestion = value
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return suggestion || "renamed";
};

/** Characters and shapes that break a git checkout on macOS/Windows (§6.3). */
const UNSAFE_PATH_CHARS = /[/\\:*?"<>|]/;

/**
 * Safety for paths *inside* a file-tree node, which are carried verbatim and are
 * NOT slugs. Applied on publish, because these become real files in a git repo.
 */
export const assertSafeFilePath = (filePath: string, context: string): void => {
  for (const segment of filePath.split("/")) {
    if (!segment) {
      throw new Error(`Invalid file path "${filePath}" (${context}): empty path segment.`);
    }
    if (UNSAFE_PATH_CHARS.test(segment)) {
      throw new Error(
        `Invalid file path "${filePath}" (${context}): the segment "${segment}" contains a character that is illegal in a file name on Windows or macOS (/ \\ : * ? " < > |). Rename the file.`,
      );
    }
    if (/^[. ]|[. ]$/.test(segment)) {
      throw new Error(
        `Invalid file path "${filePath}" (${context}): the segment "${segment}" starts or ends with a dot or space, which does not survive a checkout on every OS. Rename the file.`,
      );
    }
  }
};

/**
 * macOS and Windows checkouts are case-insensitive: two siblings differing only by
 * case collapse into one file on clone, silently losing content.
 */
export const assertNoSiblingCaseCollisions = (names: readonly string[], context: string): void => {
  const seenByLower = new Map<string, string>();
  for (const name of names) {
    const lower = name.toLowerCase();
    const existing = seenByLower.get(lower);
    if (existing !== undefined && existing !== name) {
      throw new Error(
        `Sibling name collision (${context}): "${existing}" and "${name}" differ only by case. macOS and Windows treat them as the same file, so one would silently overwrite the other on checkout. Rename one.`,
      );
    }
    seenByLower.set(lower, name);
  }
};

/** Names the format interprets — a node's own content may not use them at its root. */
export const isReservedPackageFilename = (name: string): boolean =>
  name === PACKAGE_MANIFEST_FILENAME ||
  name === PACKAGE_NODE_META_FILENAME ||
  name === PACKAGE_FOLDER_META_FILENAME ||
  name === PACKAGE_BASE_FILENAME ||
  name === PACKAGE_RECORDS_FILENAME ||
  name.endsWith(PACKAGE_NODE_META_SUFFIX);

/**
 * A skill/drive/airapp's ROOT may not contain a name the format interprets. Deeper
 * levels are unrestricted — inside a recognized file-tree node nothing is read.
 */
export const assertNoReservedNames = (filePaths: readonly string[], context: string): void => {
  for (const filePath of filePaths) {
    const [rootName, ...rest] = filePath.split("/");
    if (rest.length === 0 && isReservedPackageFilename(rootName)) {
      throw new Error(
        `Reserved file name at the root of ${context}: "${rootName}" is part of the package format, so it cannot also be this node's own content. Rename it (e.g. "${renameReserved(rootName)}"), or move it into a subdirectory — names are only interpreted at the node's root.`,
      );
    }
  }
};

const renameReserved = (name: string): string => {
  const ext = extname(name);
  return ext ? `${name.slice(0, -ext.length)}-file${ext}` : `${name}-file`;
};

// ── Ordering (§6.3: position when present, else alphabetical) ────────────────

export const compareNodes = (a: PackageNode, b: PackageNode): number => {
  if (a.position !== undefined && b.position !== undefined && a.position !== b.position) {
    return a.position - b.position;
  }
  if (a.position !== undefined && b.position === undefined) return -1;
  if (a.position === undefined && b.position !== undefined) return 1;
  return a.slug.localeCompare(b.slug, "en");
};

export const sortNodes = (nodes: readonly PackageNode[]): PackageNode[] =>
  [...nodes].sort(compareNodes);

/** `getting-started` → `Getting Started`; the default name for a folder with no `_folder.json`. */
export const humanizeSlug = (slug: string): string =>
  slug
    .split("-")
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");

// ── MIME ─────────────────────────────────────────────────────────────────────

const MIME_BY_EXT: Record<string, string> = {
  ".css": "text/css",
  ".csv": "text/csv",
  ".gif": "image/gif",
  ".htm": "text/html",
  ".html": "text/html",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".js": "text/javascript",
  ".json": "application/json",
  ".md": "text/markdown",
  ".pdf": "application/pdf",
  ".png": "image/png",
  ".py": "text/x-python",
  ".svg": "image/svg+xml",
  ".ts": "text/typescript",
  ".txt": "text/plain",
  ".webp": "image/webp",
  ".yaml": "text/yaml",
  ".yml": "text/yaml",
};

export const guessMimeType = (filePath: string): string =>
  MIME_BY_EXT[extname(filePath).toLowerCase()] ?? "application/octet-stream";

/** Text-ish content can go inline in a file-tree create; anything else needs an asset upload. */
export const isTextMimeType = (mimeType: string): boolean =>
  mimeType.startsWith("text/") || mimeType === "application/json" || mimeType === "image/svg+xml";

// ── Traversal ────────────────────────────────────────────────────────────────

export const walkNodes = function* (nodes: readonly PackageNode[]): Generator<PackageNode> {
  for (const node of nodes) {
    yield node;
    if (node.type === "folder") yield* walkNodes(node.children);
  }
};

export const collectBaseNodes = (nodes: readonly PackageNode[]): PackageBaseNode[] =>
  [...walkNodes(nodes)].filter((node): node is PackageBaseNode => node.type === "base");

export type { PackageManifest, PackageBase, PackageRecordLine };
