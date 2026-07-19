/**
 * Layout reader: a package's files (from a repo dir, or an extracted zip held in
 * memory) → the in-memory tree. Used by `install`, and by the round-trip tests.
 *
 * Node detection follows §6.3 exactly — the order matters, first match wins:
 *   1. directory with `_node.json`  → skill | airapp | drive (contents verbatim)
 *   2. directory with `base.json`   → base
 *   3. any other directory          → folder (optional `_folder.json`)
 *   4. `*.md`                       → doc (YAML frontmatter + body)
 *   5. any other file               → file node (optional `<name>.node.json`)
 */
import {
  PACKAGE_BASE_FILENAME,
  PACKAGE_CONTENT_DIRNAME,
  PACKAGE_FOLDER_META_FILENAME,
  PACKAGE_FORMAT,
  PACKAGE_MANIFEST_FILENAME,
  PACKAGE_MAX_RECORDS_PER_BASE,
  PACKAGE_NODE_META_FILENAME,
  PACKAGE_NODE_META_SUFFIX,
  PACKAGE_RECORDS_FILENAME,
  PackageBaseSchema,
  PackageDocFrontmatterSchema,
  PackageFileNodeMetaSchema,
  PackageFileTreeNodeMetaSchema,
  PackageFolderMetaSchema,
  PackageManifestSchema,
  PackageRecordLineSchema,
} from "busabase-contract/domains/package/types";
import type { z } from "zod";
import { parseFrontmatter } from "./frontmatter.js";
import {
  assertNoReservedNames,
  assertNoSiblingCaseCollisions,
  assertSafeNodeSlug,
  guessMimeType,
  humanizeSlug,
  type PackageDocNode,
  type PackageFileEntry,
  type PackageNode,
  type PackageTree,
  sortNodes,
} from "./tree.js";

/** A package's raw bytes keyed by package-relative POSIX path (`content/faq.md`). */
export type PackageFiles = Map<string, Buffer>;

const decodeText = (bytes: Buffer, filePath: string): string => {
  const text = bytes.toString("utf8");
  // A lone replacement char means the bytes weren't UTF-8 — for files the format
  // reads as text, that is a corrupt package rather than something to guess at.
  if (text.includes("�")) {
    throw new Error(`${filePath} is not valid UTF-8 text.`);
  }
  return text;
};

const parseJsonFile = (files: PackageFiles, filePath: string): unknown => {
  const bytes = files.get(filePath);
  if (!bytes) throw new Error(`Missing ${filePath}`);
  try {
    return JSON.parse(decodeText(bytes, filePath));
  } catch (error) {
    throw new Error(`${filePath} is not valid JSON: ${(error as Error).message}`);
  }
};

const zodParse = <T>(schema: z.ZodType<T>, value: unknown, filePath: string): T => {
  const result = schema.safeParse(value);
  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `  - ${issue.path.join(".") || "(root)"}: ${issue.message}`)
      .join("\n");
    throw new Error(`${filePath} does not match the ${PACKAGE_FORMAT} schema:\n${issues}`);
  }
  return result.data;
};

/** Direct children of `dir` (which must end in `/`, or be "" for the root). */
interface DirEntries {
  files: string[];
  dirs: string[];
}

const listDir = (files: PackageFiles, dir: string): DirEntries => {
  const fileNames = new Set<string>();
  const dirNames = new Set<string>();
  for (const filePath of files.keys()) {
    if (!filePath.startsWith(dir)) continue;
    const rest = filePath.slice(dir.length);
    if (!rest) continue;
    const slash = rest.indexOf("/");
    if (slash === -1) fileNames.add(rest);
    else dirNames.add(rest.slice(0, slash));
  }
  return { files: [...fileNames].sort(), dirs: [...dirNames].sort() };
};

/** Every file at or below `dir`, keyed by its path relative to `dir`. */
const collectSubtree = (files: PackageFiles, dir: string): PackageFileEntry[] => {
  const entries: PackageFileEntry[] = [];
  for (const [filePath, bytes] of files) {
    if (!filePath.startsWith(dir)) continue;
    const relativePath = filePath.slice(dir.length);
    if (relativePath) entries.push({ path: relativePath, bytes });
  }
  return entries.sort((a, b) => a.path.localeCompare(b.path, "en"));
};

export interface ReadPackageOptions {
  /** Where the manifest and `content/` live inside `files`. Default: the root. */
  root?: string;
}

/**
 * Parse a package's files into the in-memory tree, validating the manifest, every
 * sidecar, slug safety, reserved names, and per-base record caps. Any failure throws
 * before install writes anything.
 */
export const readPackageTree = (
  files: PackageFiles,
  options: ReadPackageOptions = {},
): PackageTree => {
  const root = options.root ? `${options.root.replace(/\/+$/, "")}/` : "";
  const manifestPath = `${root}${PACKAGE_MANIFEST_FILENAME}`;
  if (!files.has(manifestPath)) {
    throw new Error(buildMissingManifestError(files, root));
  }
  const rawManifest = parseJsonFile(files, manifestPath);
  assertKnownFormat(rawManifest, manifestPath);
  const manifest = zodParse(PackageManifestSchema, rawManifest, manifestPath);

  const contentDir = `${root}${PACKAGE_CONTENT_DIRNAME}/`;
  const nodes = readNodes(files, contentDir);
  return { manifest, nodes };
};

/**
 * A `format` the CLI doesn't understand must refuse loudly rather than be
 * guess-imported by a schema that happens to accept a subset of it.
 */
const assertKnownFormat = (rawManifest: unknown, manifestPath: string): void => {
  const format =
    typeof rawManifest === "object" && rawManifest !== null
      ? (rawManifest as { format?: unknown }).format
      : undefined;
  if (typeof format === "string" && format !== PACKAGE_FORMAT) {
    throw new Error(
      `${manifestPath} declares format "${format}", but this busabase-cli only understands "${PACKAGE_FORMAT}". Upgrade busabase-cli (npm i -g busabase-cli@latest) and try again.`,
    );
  }
};

/** §4: name the exact problem, and point at any manifests found deeper in the repo. */
const buildMissingManifestError = (files: PackageFiles, root: string): string => {
  const at = root || "the repository root";
  const nested = [...files.keys()]
    .filter((filePath) => filePath.endsWith(`/${PACKAGE_MANIFEST_FILENAME}`))
    .map((filePath) => filePath.slice(0, -PACKAGE_MANIFEST_FILENAME.length - 1))
    .filter((dir) => dir && dir !== root.replace(/\/+$/, ""))
    .sort();
  const base = `Not a Busabase package — expected ${PACKAGE_MANIFEST_FILENAME} at ${at}.`;
  if (nested.length === 0) return base;
  const suggestions = nested
    .slice(0, 10)
    .map((dir) => `  • .../tree/<ref>/${dir}`)
    .join("\n");
  return `${base}\n\nThis repo does contain packages in subdirectories — install one of them by URL:\n${suggestions}`;
};

const readNodes = (files: PackageFiles, dir: string): PackageNode[] => {
  const { files: fileNames, dirs } = listDir(files, dir);
  assertNoSiblingCaseCollisions([...fileNames, ...dirs], `in ${dir || "content/"}`);

  const nodes: PackageNode[] = [];
  for (const dirName of dirs) nodes.push(readDirNode(files, `${dir}${dirName}/`, dirName));
  for (const fileName of fileNames) {
    const node = readFileNode(files, dir, fileName);
    if (node) nodes.push(node);
  }
  return sortNodes(nodes);
};

const readDirNode = (files: PackageFiles, dir: string, slug: string): PackageNode => {
  assertSafeNodeSlug(slug, `directory ${dir}`);

  // 1. `_node.json` → a verbatim-content file-tree node.
  if (files.has(`${dir}${PACKAGE_NODE_META_FILENAME}`)) {
    const metaPath = `${dir}${PACKAGE_NODE_META_FILENAME}`;
    const meta = zodParse(PackageFileTreeNodeMetaSchema, parseJsonFile(files, metaPath), metaPath);
    const entries = collectSubtree(files, dir).filter(
      (entry) => entry.path !== PACKAGE_NODE_META_FILENAME,
    );
    assertNoReservedNames(
      entries.map((entry) => entry.path),
      `${meta.type} "${slug}"`,
    );
    return {
      type: meta.type,
      slug,
      name: meta.name,
      description: meta.description,
      position: meta.position,
      files: entries,
    };
  }

  // 2. `base.json` → a base node.
  if (files.has(`${dir}${PACKAGE_BASE_FILENAME}`)) {
    const basePath = `${dir}${PACKAGE_BASE_FILENAME}`;
    const base = zodParse(PackageBaseSchema, parseJsonFile(files, basePath), basePath);
    const records = readRecords(files, dir, slug);
    return {
      type: "base",
      slug,
      name: base.name,
      description: base.description,
      position: base.position,
      base,
      records,
    };
  }

  // 3. anything else → a folder.
  const metaPath = `${dir}${PACKAGE_FOLDER_META_FILENAME}`;
  const meta = files.has(metaPath)
    ? zodParse(PackageFolderMetaSchema, parseJsonFile(files, metaPath), metaPath)
    : { name: undefined, description: "", position: undefined };
  return {
    type: "folder",
    slug,
    name: meta.name ?? humanizeSlug(slug),
    description: meta.description,
    position: meta.position,
    children: readNodes(files, dir),
  };
};

const readRecords = (
  files: PackageFiles,
  dir: string,
  slug: string,
): ReturnType<typeof parseRecordLines> => {
  const recordsPath = `${dir}${PACKAGE_RECORDS_FILENAME}`;
  const bytes = files.get(recordsPath);
  if (!bytes) return [];
  return parseRecordLines(decodeText(bytes, recordsPath), recordsPath, slug);
};

const parseRecordLines = (text: string, recordsPath: string, slug: string) => {
  const lines = text.split("\n").filter((line) => line.trim().length > 0);
  if (lines.length > PACKAGE_MAX_RECORDS_PER_BASE) {
    throw new Error(
      `Base "${slug}" has ${lines.length} records, above the ${PACKAGE_MAX_RECORDS_PER_BASE} per-base limit. Nothing was installed.`,
    );
  }
  const seenKeys = new Set<string>();
  return lines.map((line, index) => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch (error) {
      throw new Error(
        `${recordsPath} line ${index + 1} is not valid JSON: ${(error as Error).message}`,
      );
    }
    const record = zodParse(PackageRecordLineSchema, parsed, `${recordsPath} line ${index + 1}`);
    if (seenKeys.has(record.key)) {
      throw new Error(
        `${recordsPath} has a duplicate record key "${record.key}" on line ${index + 1}.`,
      );
    }
    seenKeys.add(record.key);
    return record;
  });
};

const readFileNode = (
  files: PackageFiles,
  dir: string,
  fileName: string,
): PackageNode | undefined => {
  // Sidecars and format files are metadata, never nodes of their own.
  if (
    fileName === PACKAGE_MANIFEST_FILENAME ||
    fileName === PACKAGE_FOLDER_META_FILENAME ||
    fileName === PACKAGE_NODE_META_FILENAME ||
    fileName.endsWith(PACKAGE_NODE_META_SUFFIX)
  ) {
    return undefined;
  }

  const bytes = files.get(`${dir}${fileName}`);
  if (!bytes) return undefined;

  // 4. `*.md` → a doc node.
  if (fileName.toLowerCase().endsWith(".md")) {
    return readDocNode(bytes, dir, fileName);
  }

  // 5. anything else → a file node.
  const slug = stripExtension(fileName);
  assertSafeNodeSlug(slug, `file ${dir}${fileName}`);
  const sidecarPath = `${dir}${fileName}${PACKAGE_NODE_META_SUFFIX}`;
  const meta = files.has(sidecarPath)
    ? zodParse(PackageFileNodeMetaSchema, parseJsonFile(files, sidecarPath), sidecarPath)
    : { name: undefined, description: "", position: undefined };
  return {
    type: "file",
    slug,
    name: meta.name ?? fileName,
    description: meta.description,
    position: meta.position,
    fileName,
    mimeType: guessMimeType(fileName),
    bytes,
  };
};

const readDocNode = (bytes: Buffer, dir: string, fileName: string): PackageDocNode => {
  const filePath = `${dir}${fileName}`;
  const slug = fileName.slice(0, -".md".length);
  assertSafeNodeSlug(slug, `doc ${filePath}`);
  const { data, body } = parseFrontmatter(decodeText(bytes, filePath), filePath);
  const frontmatter = zodParse(
    PackageDocFrontmatterSchema,
    { name: humanizeSlug(slug), ...data },
    `${filePath} frontmatter`,
  );
  return {
    type: "doc",
    slug,
    name: frontmatter.name,
    description: frontmatter.description,
    position: frontmatter.position,
    body,
  };
};

/**
 * A `file` node's slug is its filename minus the extension — the same rule docs use
 * (`faq.md` → `faq`). It cannot be the whole filename: every node slug in the API is
 * `/^[a-z0-9-]+$/`, which a dot fails.
 */
export const stripExtension = (fileName: string): string => {
  const dot = fileName.lastIndexOf(".");
  return dot > 0 ? fileName.slice(0, dot) : fileName;
};
