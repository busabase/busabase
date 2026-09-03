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
 *
 * Outside `content/`, the optional `assets/` directory carries the bytes for the
 * images the Docs embed — see {@link readDocAssets}. Nothing in there is a node.
 *
 * Rule 0 sits ahead of all of them but reads a different place: a `SKILL.md` at
 * the package ROOT (beside the manifest, not under `content/`) makes this
 * package a *template*, and is lifted into `tree.rootSkill` — see
 * {@link readRootSkill}. `content/` itself is untouched by that rule, which is
 * what keeps a template byte-identical to a plain package below the root.
 */

import {
  PACKAGE_AIRAPP_IGNORE,
  PACKAGE_SKILL_ENTRY,
  PACKAGE_SKILL_SIDECAR_DIRS,
} from "busabase-contract/domains/package/template";
import {
  PACKAGE_ASSET_META_SUFFIX,
  PACKAGE_ASSETS_DIRNAME,
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
  PackageDocAssetMetaSchema,
  PackageDocFrontmatterSchema,
  PackageFileNodeMetaSchema,
  PackageFileTreeNodeMetaSchema,
  PackageFolderMetaSchema,
  PackageManifestSchema,
  PackageRecordLineSchema,
} from "busabase-contract/domains/package/types";
import type { z } from "zod";
import { parseFrontmatter } from "./frontmatter";
import { IGNORE_NOTHING, type IgnoreMatcher, parseIgnoreFile } from "./ignore";
import {
  assertNoReservedNames,
  assertNoSiblingCaseCollisions,
  assertSafeNodeSlug,
  guessMimeType,
  humanizeSlug,
  type PackageDocAsset,
  type PackageDocNode,
  type PackageFileEntry,
  type PackageNode,
  type PackageRootSkill,
  type PackageTree,
  sortNodes,
} from "./tree";

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

const AIRAPP_MANIFEST_FILENAME = "airapp.json";
const PYTHON_RUNTIME_MARKERS = ["requirements.txt", "pyproject.toml"] as const;

export interface AirAppPackageLifecycle {
  runtime: "node" | "python";
  usesDefaultInstall: boolean;
  usesDefaultStart: boolean;
}

/**
 * Resolve only the lifecycle facts the package format needs to validate.
 * Keep the same explicit -> inferred -> default order as Busabase's runtime
 * descriptor without making busabase-package depend on busabase-core (core
 * already depends on this package).
 */
export const resolveAirAppPackageLifecycle = (
  files: readonly PackageFileEntry[],
  slug: string,
): AirAppPackageLifecycle => {
  const paths = new Set(files.map((file) => file.path));
  const manifestFile = files.find((file) => file.path === AIRAPP_MANIFEST_FILENAME);
  let manifest: Record<string, unknown> = {};

  if (manifestFile) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(decodeText(manifestFile.bytes, AIRAPP_MANIFEST_FILENAME));
    } catch (error) {
      throw new Error(
        `AirApp "${slug}" has an invalid ${AIRAPP_MANIFEST_FILENAME}: ${(error as Error).message}`,
      );
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error(
        `AirApp "${slug}" has an invalid ${AIRAPP_MANIFEST_FILENAME}: expected an object.`,
      );
    }
    manifest = parsed as Record<string, unknown>;
  }

  const declaredRuntime = manifest.runtime;
  if (declaredRuntime !== undefined && declaredRuntime !== "node" && declaredRuntime !== "python") {
    throw new Error(
      `AirApp "${slug}" declares unknown runtime ${JSON.stringify(declaredRuntime)} in ${AIRAPP_MANIFEST_FILENAME}.`,
    );
  }

  const runtime =
    declaredRuntime === "node" || declaredRuntime === "python"
      ? declaredRuntime
      : PYTHON_RUNTIME_MARKERS.some((path) => paths.has(path))
        ? "python"
        : "node";
  const hasCustomCommand = (key: "install" | "start") =>
    typeof manifest[key] === "string" && manifest[key].trim().length > 0;

  return {
    runtime,
    usesDefaultInstall: !hasCustomCommand("install"),
    usesDefaultStart: !hasCustomCommand("start"),
  };
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
  const rootSkill = readRootSkill(files, root, manifest.name, manifest.description);
  return {
    manifest,
    nodes,
    ...(rootSkill ? { rootSkill } : {}),
    assets: readDocAssets(files, root),
  };
};

/**
 * Rule 0 — the package root's `SKILL.md` plus its sidecar directories.
 *
 * Absent → a plain package, and every downstream consumer behaves exactly as it
 * did before. Present → the manual travels with the resources: the installer
 * turns this into a Skill node inside the target folder, which is what lets the
 * agent that a user talks to after installing actually know what the app is for.
 *
 * The node's slug comes from the MANIFEST name rather than the skill
 * frontmatter's, because the manifest name is already the default target folder
 * name and is validated as a slug elsewhere; the validator separately requires
 * the two names to agree, so this is not a silent tie-break.
 */
const readRootSkill = (
  files: PackageFiles,
  root: string,
  manifestName: string,
  manifestDescription: string,
): PackageRootSkill | undefined => {
  const entryPath = `${root}${PACKAGE_SKILL_ENTRY}`;
  const entryBytes = files.get(entryPath);
  if (!entryBytes) return undefined;

  const entries: PackageFileEntry[] = [{ path: PACKAGE_SKILL_ENTRY, bytes: entryBytes }];
  for (const dirName of PACKAGE_SKILL_SIDECAR_DIRS) {
    const dir = `${root}${dirName}/`;
    for (const entry of collectSubtree(files, dir)) {
      entries.push({ path: `${dirName}/${entry.path}`, bytes: entry.bytes });
    }
  }
  assertNoReservedNames(
    entries.map((entry) => entry.path),
    `root skill "${manifestName}"`,
  );

  // The skill's own frontmatter is the better display name/description when it
  // has one — it is what a human wrote for agents to read — but it is optional
  // here: a malformed frontmatter is the validator's error to report with
  // context, not a reason for the reader to refuse the whole package.
  const parsed = parseSkillFrontmatterSafely(decodeText(entryBytes, entryPath), entryPath);
  return {
    slug: manifestName,
    name: parsed?.name ?? manifestName,
    description: parsed?.description ?? manifestDescription,
    files: entries.sort((a, b) => a.path.localeCompare(b.path, "en")),
  };
};

const parseSkillFrontmatterSafely = (
  text: string,
  filePath: string,
): { name?: string; description?: string } | undefined => {
  try {
    const { data } = parseFrontmatter(text, filePath);
    const record = data as Record<string, unknown>;
    return {
      name: typeof record.name === "string" ? record.name : undefined,
      description: typeof record.description === "string" ? record.description : undefined,
    };
  } catch {
    return undefined;
  }
};

/**
 * `assets/` — the bytes for the images the Docs embed. Driven off the sidecars,
 * not off the byte files: the sidecar is what carries the source asset id, so a
 * stray file with no `.asset.json` beside it is simply not an asset this package
 * declares, and is ignored rather than guessed at.
 *
 * A sidecar whose bytes are missing IS an error — the package promises an image
 * it cannot deliver, and installing it would produce exactly the dead-link Doc
 * this whole mechanism exists to prevent. That is a corrupt archive (a partial
 * checkout, a mangled zip), not a content decision the author made.
 */
const readDocAssets = (files: PackageFiles, root: string): PackageDocAsset[] => {
  const dir = `${root}${PACKAGE_ASSETS_DIRNAME}/`;
  const assets: PackageDocAsset[] = [];
  for (const filePath of [...files.keys()].sort()) {
    if (!filePath.startsWith(dir) || !filePath.endsWith(PACKAGE_ASSET_META_SUFFIX)) continue;
    const meta = zodParse(PackageDocAssetMetaSchema, parseJsonFile(files, filePath), filePath);
    const bytesPath = filePath.slice(0, -PACKAGE_ASSET_META_SUFFIX.length);
    const bytes = files.get(bytesPath);
    if (!bytes) {
      throw new Error(
        `${filePath} describes asset "${meta.assetId}" but its bytes are missing (expected ${bytesPath}). The package is incomplete — nothing was installed.`,
      );
    }
    assets.push({ ...meta, bytes });
  }
  return assets;
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
    const ignore = readIgnoreFile(files, dir);
    const entries = collectSubtree(files, dir).filter(
      (entry) =>
        entry.path !== PACKAGE_NODE_META_FILENAME &&
        entry.path !== PACKAGE_AIRAPP_IGNORE &&
        !ignore.ignores(entry.path),
    );
    assertNoReservedNames(
      entries.map((entry) => entry.path),
      `${meta.type} "${slug}"`,
    );
    if (meta.type === "airapp") {
      const lifecycle = resolveAirAppPackageLifecycle(entries, slug);
      const needsPackageJson =
        lifecycle.runtime === "node" &&
        (lifecycle.usesDefaultInstall || lifecycle.usesDefaultStart);
      if (needsPackageJson && !entries.some((entry) => entry.path === "package.json")) {
        throw new Error(
          `AirApp "${slug}" has no package.json required by its default Node lifecycle${
            ignore.isEmpty
              ? ""
              : ` — check ${dir}${PACKAGE_AIRAPP_IGNORE}, which must never exclude it`
          }. Nothing was installed.`,
        );
      }
    }
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

/**
 * `.busabaseignore` inside a file-tree node directory.
 *
 * Read here rather than at the package level because the exclusions are a
 * property of one project (an AirApp's `test/` is noise; a Drive's files are
 * the point), and a package-wide ignore list would make it possible to
 * accidentally strip another node's content from a distance.
 */
const readIgnoreFile = (files: PackageFiles, dir: string): IgnoreMatcher => {
  const bytes = files.get(`${dir}${PACKAGE_AIRAPP_IGNORE}`);
  if (!bytes) return IGNORE_NOTHING;
  return parseIgnoreFile(decodeText(bytes, `${dir}${PACKAGE_AIRAPP_IGNORE}`));
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
