/**
 * Layout writer: the in-memory tree → a repo directory (§6.1), deterministically
 * (§6.6). "Clean diffs" is a feature: for an unchanged space, `publish` twice must
 * produce byte-identical output, so re-publishing after one record edit diffs as
 * exactly one changed NDJSON line.
 *
 * Determinism rules, all enforced here:
 *   • 2-space-indented JSON with a schema-defined key order
 *   • `options` blobs (carried verbatim from the server, whose JSONB key order is
 *     not a contract) are deep key-sorted
 *   • records sorted by `key`, one per line
 *   • LF endings, trailing newline on every file
 */
import { mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  PACKAGE_BASE_FILENAME,
  PACKAGE_CONTENT_DIRNAME,
  PACKAGE_FOLDER_META_FILENAME,
  PACKAGE_MANIFEST_FILENAME,
  PACKAGE_NODE_META_FILENAME,
  PACKAGE_NODE_META_SUFFIX,
  PACKAGE_RECORDS_FILENAME,
  type PackageBase,
  type PackageBaseField,
  type PackageManifest,
  type PackageRecordLine,
  type PackageView,
} from "busabase-contract/domains/package/types";
import { serializeDoc } from "./frontmatter";
import {
  assertNoReservedNames,
  assertNoSiblingCaseCollisions,
  assertSafeFilePath,
  assertSafeNodeSlug,
  type PackageNode,
  type PackageTree,
  sortNodes,
} from "./tree";

/** Package-relative POSIX path → bytes. The tree, rendered but not yet on disk. */
export type PackageFiles = Map<string, Buffer>;

// ── Deterministic JSON ───────────────────────────────────────────────────────

/**
 * Deep key-sort. Applied to blobs the server owns the key order of (field
 * `options`), never to arrays — `choices`, `filters`, and `sorts` are ordered data.
 */
const sortKeysDeep = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(sortKeysDeep);
  if (value === null || typeof value !== "object") return value;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => item !== undefined)
    .sort(([a], [b]) => a.localeCompare(b, "en"));
  return Object.fromEntries(entries.map(([key, item]) => [key, sortKeysDeep(item)]));
};

/** 2-space JSON + trailing LF. Key order is the insertion order of `value`. */
const toJsonFile = (value: unknown): Buffer =>
  Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8");

/** Drop `undefined` so optional keys vanish rather than serializing inconsistently. */
const compact = <T extends Record<string, unknown>>(value: T): Partial<T> =>
  Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as Partial<T>;

// ── Schema-ordered serializers ───────────────────────────────────────────────

const serializeManifest = (manifest: PackageManifest): Buffer =>
  toJsonFile(
    compact({
      format: manifest.format,
      name: manifest.name,
      description: manifest.description || undefined,
      version: manifest.version,
      author: manifest.author,
      license: manifest.license,
      homepage: manifest.homepage,
      tags: manifest.tags.length > 0 ? manifest.tags : undefined,
    }),
  );

const serializeField = (field: PackageBaseField): Record<string, unknown> =>
  compact({
    slug: field.slug,
    name: field.name,
    type: field.type,
    required: field.required,
    position: field.position,
    options: sortKeysDeep(field.options),
  });

const serializeView = (view: PackageView): Record<string, unknown> =>
  compact({
    slug: view.slug,
    name: view.name,
    description: view.description || undefined,
    type: view.type,
    config: compact({
      filters: view.config.filters.map((filter) =>
        compact({
          fieldSlug: filter.fieldSlug,
          operator: filter.operator,
          value: filter.value,
        }),
      ),
      sorts: view.config.sorts.map((sort) => ({
        direction: sort.direction,
        fieldSlug: sort.fieldSlug,
      })),
      visibleFieldSlugs: view.config.visibleFieldSlugs ?? undefined,
    }),
  });

const serializeBase = (base: PackageBase, position: number | undefined): Buffer =>
  toJsonFile(
    compact({
      name: base.name,
      description: base.description || undefined,
      position,
      reviewPolicy: base.reviewPolicy,
      fields: base.fields.map(serializeField),
      views: base.views.map(serializeView),
    }),
  );

/** One JSON object per line, sorted by `key` — determinism (§6.4). */
const serializeRecords = (records: readonly PackageRecordLine[]): Buffer => {
  const sorted = [...records].sort((a, b) => a.key.localeCompare(b.key, "en"));
  const lines = sorted.map((record) => JSON.stringify({ key: record.key, fields: record.fields }));
  return Buffer.from(lines.length > 0 ? `${lines.join("\n")}\n` : "", "utf8");
};

// ── Tree → files ─────────────────────────────────────────────────────────────

/**
 * Render a tree to package-relative paths + bytes, validating §6.3 as it goes.
 * Pure: no disk access, so the round-trip and determinism tests exercise it directly.
 */
export const renderPackageTree = (tree: PackageTree): PackageFiles => {
  const files: PackageFiles = new Map();
  files.set(PACKAGE_MANIFEST_FILENAME, serializeManifest(tree.manifest));
  renderNodes(tree.nodes, `${PACKAGE_CONTENT_DIRNAME}/`, files);
  return files;
};

const renderNodes = (nodes: readonly PackageNode[], dir: string, files: PackageFiles): void => {
  const ordered = sortNodes(nodes);
  assertNoSiblingCaseCollisions(
    ordered.map((node) => node.slug),
    `in ${dir}`,
  );
  const seen = new Set<string>();
  for (const node of ordered) {
    assertSafeNodeSlug(node.slug, `${node.type} node`);
    if (seen.has(node.slug)) {
      throw new Error(
        `Two nodes in ${dir} would be written as "${node.slug}". Sibling slugs must be unique.`,
      );
    }
    seen.add(node.slug);
    renderNode(node, dir, files);
  }
};

const renderNode = (node: PackageNode, dir: string, files: PackageFiles): void => {
  switch (node.type) {
    case "folder": {
      // `_folder.json` carries metadata, and is also how an empty folder survives git.
      const needsMeta =
        node.children.length === 0 ||
        node.description !== "" ||
        node.position !== undefined ||
        node.name !== undefined;
      if (needsMeta) {
        files.set(
          `${dir}${node.slug}/${PACKAGE_FOLDER_META_FILENAME}`,
          toJsonFile(
            compact({
              name: node.name,
              description: node.description || undefined,
              position: node.position,
            }),
          ),
        );
      }
      renderNodes(node.children, `${dir}${node.slug}/`, files);
      return;
    }
    case "doc": {
      files.set(
        `${dir}${node.slug}.md`,
        Buffer.from(
          serializeDoc(
            { name: node.name, description: node.description, position: node.position },
            node.body,
          ),
          "utf8",
        ),
      );
      return;
    }
    case "base": {
      files.set(
        `${dir}${node.slug}/${PACKAGE_BASE_FILENAME}`,
        serializeBase(node.base, node.position),
      );
      const records = serializeRecords(node.records);
      if (records.byteLength > 0)
        files.set(`${dir}${node.slug}/${PACKAGE_RECORDS_FILENAME}`, records);
      return;
    }
    case "skill":
    case "airapp":
    case "drive": {
      const nodeDir = `${dir}${node.slug}/`;
      assertNoReservedNames(
        node.files.map((entry) => entry.path),
        `${node.type} "${node.slug}"`,
      );
      files.set(
        `${nodeDir}${PACKAGE_NODE_META_FILENAME}`,
        toJsonFile(
          compact({
            type: node.type,
            name: node.name,
            description: node.description || undefined,
            position: node.position,
          }),
        ),
      );
      for (const entry of [...node.files].sort((a, b) => a.path.localeCompare(b.path, "en"))) {
        assertSafeFilePath(entry.path, `${node.type} "${node.slug}"`);
        files.set(`${nodeDir}${entry.path}`, entry.bytes);
      }
      return;
    }
    case "file": {
      assertSafeFilePath(node.fileName, `file node "${node.slug}"`);
      files.set(`${dir}${node.fileName}`, node.bytes);
      // The sidecar only exists when it carries something the filename can't.
      const hasMeta =
        node.name !== node.fileName || node.description !== "" || node.position !== undefined;
      if (hasMeta) {
        files.set(
          `${dir}${node.fileName}${PACKAGE_NODE_META_SUFFIX}`,
          toJsonFile(
            compact({
              name: node.name,
              description: node.description || undefined,
              position: node.position,
            }),
          ),
        );
      }
      return;
    }
  }
};

// ── Files → disk ─────────────────────────────────────────────────────────────

export interface WritePackageOptions {
  /** Remove an existing `content/` + manifest first, so a re-publish never leaves stale files. */
  clean?: boolean;
}

/** Write rendered files under `outDir`, creating directories as needed. */
export const writePackageFiles = async (
  files: PackageFiles,
  outDir: string,
  options: WritePackageOptions = {},
): Promise<void> => {
  if (options.clean) {
    await rm(join(outDir, PACKAGE_CONTENT_DIRNAME), { recursive: true, force: true });
    await rm(join(outDir, PACKAGE_MANIFEST_FILENAME), { force: true });
  }
  for (const [filePath, bytes] of [...files].sort(([a], [b]) => a.localeCompare(b, "en"))) {
    const target = join(outDir, filePath);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, bytes);
  }
};

/** Render + write in one step — what `publish` calls. */
export const writePackageTree = async (
  tree: PackageTree,
  outDir: string,
  options: WritePackageOptions = {},
): Promise<PackageFiles> => {
  const files = renderPackageTree(tree);
  await writePackageFiles(files, outDir, options);
  return files;
};
