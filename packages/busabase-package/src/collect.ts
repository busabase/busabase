/**
 * `export`'s read half: a space subtree → the in-memory package tree, entirely via
 * the public read API. The inverse of `apply`.
 *
 * Rewrites the three id-bearing option keys back to slug references, drops everything
 * the format has no slot for (ids, history, permissions), carries the bytes behind
 * every Doc's inline images (see {@link collectDocAssets}), and enforces the format's
 * self-containment rule: a relation may not leave the package.
 */

import {
  APP_ROOT_RESOURCE_KEY,
  TEMPLATE_SKILL_METADATA_KEY,
} from "busabase-contract/domains/package/template";
import {
  PACKAGE_COMPUTED_FIELD_TYPES,
  PACKAGE_FORMAT,
  type PackageBaseField,
  type PackageFieldOptions,
  type PackageManifest,
  type PackageRecordLine,
  type PackageView,
} from "busabase-contract/domains/package/types";
import type { PackageClient } from "./client";
import { collectDocAssetIds, reportUnresolvableDocAssets } from "./doc-asset-refs";
import {
  guessMimeType,
  NODE_SLUG_PATTERN,
  type PackageDocAsset,
  type PackageFileEntry,
  type PackageFileTreeNode,
  type PackageNode,
  type PackageRootSkill,
  type PackageTree,
  sortNodes,
  walkNodes,
} from "./tree";

/** The subset of `nodes.list`'s output export walks. */
export interface SourceNode {
  id: string;
  slug: string;
  name: string;
  description: string;
  type: string;
  position: number;
  baseId?: string | null;
  metadata?: { assetId?: string; [key: string]: unknown } | null;
  children?: SourceNode[];
}

export interface CollectOptions {
  manifest: PackageManifest;
  warn: (message: string) => void;
  /**
   * The server we're exporting from. Load-bearing for asset downloads: a local
   * (non-S3) server hands back a ROOT-RELATIVE download url (e.g.
   * `/api/storage/…`), meant to be fetched same-origin by a browser. The
   * CLI runs out-of-process, so it must resolve that against the host itself —
   * a bare `fetch("/api/…")` throws "Failed to parse URL" in Node. (The same
   * trap `busabase-dump`'s exporter hit and documents.)
   */
  baseUrl: string;
  /**
   * Base id → its `resourceKey`-restored slug, for every Base under `root`
   * that install renamed. Computed once from the source tree (see
   * {@link collectBaseResourceKeys}) and threaded through so a relation
   * field's `targetBaseSlug` can be resolved to the restored name even
   * though {@link buildIndexes} otherwise only sees each Base's raw current
   * server slug. Callers building a `CollectOptions` by hand (tests) can
   * omit it — it defaults to empty, meaning "nothing was install-renamed."
   */
  baseResourceKeys?: ReadonlyMap<string, string>;
}

/** Find the subtree to export by node slug or id. */
export const findSourceNode = (nodes: readonly SourceNode[], slugOrId: string): SourceNode => {
  const stack = [...nodes];
  while (stack.length > 0) {
    const node = stack.shift();
    if (!node) continue;
    if (node.id === slugOrId || node.slug === slugOrId) return node;
    if (node.children) stack.push(...node.children);
  }
  throw new Error(
    `No node found with slug or id "${slugOrId}" in this space. Run \`busabase-cli nodes list\` to see the tree.`,
  );
};

export const collectPackageTree = async (
  client: PackageClient,
  root: SourceNode,
  options: CollectOptions,
): Promise<PackageTree> => {
  // A folder's own content lives in `children`. Any other node type (a bare
  // Base, Doc, Drive, …) has no `children` at all — it IS the content — so
  // treating `root.children ?? []` as the source list here would silently
  // walk zero nodes and export nothing but an empty manifest. Fall back to
  // `[root]` so exporting a non-folder node directly still collects it.
  const children = root.type === "folder" ? (root.children ?? []) : [root];
  const { skillSource, rest } = partitionTemplateSkill(children);
  const collectOptions: CollectOptions = {
    ...options,
    baseResourceKeys: collectBaseResourceKeys(children),
  };
  const nodes = await collectNodes(client, rest, collectOptions);
  const tree: PackageTree = {
    manifest: { ...options.manifest, format: PACKAGE_FORMAT },
    nodes,
    ...(skillSource
      ? { rootSkill: await collectRootSkill(client, skillSource, collectOptions) }
      : {}),
    assets: await collectDocAssets(client, nodes, collectOptions),
  };
  assertSelfContained(tree, collectOptions);
  return tree;
};

/**
 * Undo the slug INSTALL chose for one node, restoring the one the package
 * declared.
 *
 * Install prefixes a template's Base slugs with the target folder (`contacts` →
 * `kelly-crm-contacts`) and records the original as the node's `resourceKey`.
 * Exporting the installed slug would make the package say something its author
 * never wrote — and re-installing it would prefix the prefix, or collide
 * outright. Reading the stamp back makes export→install→export a fixed point,
 * which is the property that lets a user install a template, adjust it, and
 * publish the result without the names drifting a little further each time.
 *
 * The app-root stamp is skipped: `resourceKey` is the reserved `app-root`
 * marker there, not a slug anything should be named after.
 *
 * Applied to the ONE node `source` describes — never through a space-wide
 * slug→slug rename table. An earlier version built exactly that table (keyed
 * by each node's *current* slug) and applied it by re-matching slugs across
 * the whole exported tree; that broke the moment two unrelated nodes shared a
 * slug anywhere in the space — observed live: an AirApp installed into a
 * folder auto-named after it end up BOTH called "social-media" pre-restore
 * (the folder, and the app before its own stamp renamed it back to "airapp"),
 * so the app's rename bled onto its own parent folder on export.
 */
const restoredNodeSlug = (source: Pick<SourceNode, "slug" | "metadata">): string => {
  const key = source.metadata?.resourceKey;
  if (
    typeof key === "string" &&
    key !== APP_ROOT_RESOURCE_KEY &&
    key !== source.slug &&
    NODE_SLUG_PATTERN.test(key)
  ) {
    return key;
  }
  return source.slug;
};

/**
 * The other half of slug restoration: a relation field's `targetBaseSlug` (set
 * from `context.baseSlugById` in {@link toPackageField}, itself built by
 * {@link buildIndexes} from each Base's raw current server slug) must resolve
 * to whatever THAT target Base's own node slug gets restored to, or the
 * package would ship a relation pointing at a name it never actually wrote.
 *
 * Keyed by Base id (globally unique, unlike slug — see {@link restoredNodeSlug}'s
 * doc) so `buildIndexes` can look a target base's restored slug up without
 * re-deriving it from a name that might collide with something else in the
 * space.
 */
const collectBaseResourceKeys = (sources: readonly SourceNode[]): Map<string, string> => {
  const byBaseId = new Map<string, string>();
  const walk = (list: readonly SourceNode[]): void => {
    for (const source of list) {
      if (source.type === "base") {
        const restored = restoredNodeSlug(source);
        if (restored !== source.slug) byBaseId.set(source.baseId ?? source.slug, restored);
      }
      if (source.children) walk(source.children);
    }
  };
  walk(sources);
  return byBaseId;
};

/**
 * Separate the app's manual from its resources.
 *
 * The Skill node stamped `isTemplateSkill` is the one an install lifted out of a
 * package root, so export has to put it back there rather than under `content/`.
 * Writing it as a normal node would make every export→install cycle add another
 * copy of the manual beside the previous one.
 *
 * Only the FIRST such node is lifted: two of them in one folder is a state no
 * install can produce, and silently merging them would be a guess. The extra one
 * is exported as an ordinary Skill node, which is visible and fixable, rather
 * than dropped.
 */
const partitionTemplateSkill = (
  children: readonly SourceNode[],
): { skillSource?: SourceNode; rest: SourceNode[] } => {
  const index = children.findIndex(
    (node) => node.type === "skill" && node.metadata?.[TEMPLATE_SKILL_METADATA_KEY] === true,
  );
  if (index === -1) return { rest: [...children] };
  return {
    skillSource: children[index],
    rest: children.filter((_, position) => position !== index),
  };
};

const collectRootSkill = async (
  client: PackageClient,
  source: SourceNode,
  options: CollectOptions,
): Promise<PackageRootSkill> => {
  const node = await collectFileTree(
    client,
    source,
    "skill",
    {
      slug: source.slug,
      name: source.name,
      description: source.description ?? "",
      position: source.position,
    },
    options,
  );
  return {
    slug: source.slug,
    name: source.name,
    description: source.description ?? "",
    files: node.files,
  };
};

/**
 * The bytes behind every `![](/api/assets/{id}/raw)` in every exported Doc.
 *
 * A Doc's images are the one part of a Doc that is not in its markdown, and
 * before this they were simply left behind: the body travelled, the bytes did
 * not, and the install produced a Doc full of dead links. Carrying them is what
 * makes a Doc portable at all.
 *
 * Downloaded through `assets.download`, which is the same gate the Doc's own
 * reader goes through (a Doc-embedded image has a `doc` usage, so it is exactly
 * as readable as the Doc) and which hands back the metadata the target needs to
 * re-create the asset: name, mime type, content hash.
 *
 * One unreadable image never fails the export — see {@link assertSelfContained}.
 */
const collectDocAssets = async (
  client: PackageClient,
  nodes: readonly PackageNode[],
  options: CollectOptions,
): Promise<PackageDocAsset[]> => {
  const assets: PackageDocAsset[] = [];
  for (const assetId of collectDocAssetIds(nodes)) {
    try {
      const detail = await client.assets.download({ assetId });
      assets.push({
        assetId,
        fileName: detail.fileName,
        mimeType: detail.mimeType,
        contentHash: detail.contentHash ?? undefined,
        // See CollectOptions.baseUrl — a local server's download url is root-relative.
        bytes: await downloadBytes(detail.downloadUrl, detail.fileName, options),
      });
    } catch (error) {
      // Deleted, or unreadable by whoever is exporting. Name it and carry on:
      // the doc, and every image that DID download, still ship.
      options.warn(
        `Could not read the image ${assetId} embedded in a doc (${error instanceof Error ? error.message : String(error)}). The package ships without it.`,
      );
    }
  }
  return assets;
};

const collectNodes = async (
  client: PackageClient,
  sources: readonly SourceNode[],
  options: CollectOptions,
): Promise<PackageNode[]> => {
  const nodes: PackageNode[] = [];
  for (const source of sources) {
    const node = await collectNode(client, source, options);
    if (node) nodes.push(node);
  }
  return sortNodes(nodes);
};

const collectNode = async (
  client: PackageClient,
  source: SourceNode,
  options: CollectOptions,
): Promise<PackageNode | undefined> => {
  const common = {
    slug: restoredNodeSlug(source),
    name: source.name,
    description: source.description ?? "",
    // `export` always writes position, so round trips preserve sibling order exactly.
    position: source.position,
  };

  switch (source.type) {
    case "folder":
      return {
        ...common,
        type: "folder",
        children: await collectNodes(client, source.children ?? [], options),
      };
    case "doc": {
      // Reads through the unified Node detail route (`docs.get` is retired). The
      // `type` hint narrows the discriminated union straight to the doc branch,
      // which carries the same `body` the typed get returned.
      const doc = await client.nodes.get({ nodeId: source.id, type: "doc" });
      if (doc.type !== "doc") {
        throw new Error(`Expected a doc node for "${source.slug}", got "${doc.type}".`);
      }
      return { ...common, type: "doc", body: doc.body };
    }
    case "base":
      return collectBase(client, source, common, options);
    case "skill":
    case "airapp":
    case "drive":
      // `source.type` is `string`, so the switch narrows the field but not the
      // object — pass the narrowed literal through explicitly.
      return collectFileTree(client, source, source.type, common, options);
    case "file":
      return collectFile(client, source, common, options);
    default:
      options.warn(`Skipped node "${source.slug}": unsupported node type "${source.type}".`);
      return undefined;
  }
};

type NodeCommon = Pick<PackageNode, "slug" | "name" | "description" | "position">;

const collectBase = async (
  client: PackageClient,
  source: SourceNode,
  common: NodeCommon,
  options: CollectOptions,
): Promise<PackageNode> => {
  const baseId = source.baseId ?? source.slug;
  const base = await client.bases.get({ baseId });
  if (!base) {
    throw new Error(
      `Base node "${source.slug}" has no Base behind it (looked up ${baseId}). The space may be mid-migration; re-run export.`,
    );
  }
  const allViews = await client.bases.listViews({ baseId: base.id });
  // A view predating the slug requirement (real production data: a View
  // whose `slug` is `""`) fails `PackageViewSchema` — the package on disk
  // parses as invalid, so EVERY later `install` of it fails outright, far
  // from the export that actually produced it. Drop just that one view with
  // a warning rather than shipping a package `install` can never read.
  const views = allViews.filter((view) => view.slug.length > 0);
  if (views.length !== allViews.length) {
    options.warn(
      `Base "${common.slug}" has ${allViews.length - views.length} view(s) with no slug — they were dropped (predates the slug requirement; rename it in the UI to keep it).`,
    );
  }
  const { baseSlugById, fieldSlugById } = await buildIndexes(
    client,
    options.baseResourceKeys ?? new Map(),
  );

  const fields = [...base.fields]
    .sort((a, b) => a.position - b.position)
    .map((field) =>
      toPackageField(field, {
        fieldSlugById,
        baseSlugById,
        baseSlug: common.slug,
        warn: options.warn,
      }),
    );
  const records = await collectRecords(client, base.id, base.fields, options);

  return {
    ...common,
    type: "base",
    base: {
      name: base.name,
      description: base.description ?? "",
      position: common.position,
      reviewPolicy: base.reviewPolicy,
      fields,
      views: views.map(toPackageView),
    },
    records,
  };
};

/** `bse_…` → slug, so `targetBaseId` can be rewritten to `targetBaseSlug`. */
/**
 * Space-wide id→slug indexes for bases AND every field in them.
 *
 * The field index must span the whole space, not just the base being collected:
 * a relation's `inverseFieldId` names a field in the **target** base, so a
 * cross-base inverse (A.b_link ↔ B.a_link) is unresolvable from A's own fields.
 * Indexing only the current base happened to work for the demo's self-relation
 * inverse and silently dropped every cross-base one.
 *
 * `bases.list()` already hydrates each base's fields, so one call builds both.
 */
const buildIndexes = async (
  client: PackageClient,
  baseResourceKeys: ReadonlyMap<string, string>,
): Promise<{ baseSlugById: Map<string, string>; fieldSlugById: Map<string, string> }> => {
  const bases = await client.bases.list({});
  const baseSlugById = new Map<string, string>();
  const fieldSlugById = new Map<string, string>();
  for (const base of bases) {
    baseSlugById.set(base.id, baseResourceKeys.get(base.id) ?? base.slug);
    for (const field of base.fields ?? []) fieldSlugById.set(field.id, field.slug);
  }
  return { baseSlugById, fieldSlugById };
};

interface FieldContext {
  fieldSlugById: Map<string, string>;
  baseSlugById: Map<string, string>;
  baseSlug: string;
  warn: (message: string) => void;
}

/**
 * `BaseFieldVO` minus ids. Only the three id-bearing option keys are rewritten;
 * everything else in `options` is carried verbatim (the server stores it verbatim, so
 * `choices[].id` survives and record values referencing choice ids need no remap).
 */
const toPackageField = (
  field: {
    id: string;
    slug: string;
    name: PackageBaseField["name"];
    type: PackageBaseField["type"];
    required: boolean;
    position: number;
    options: Record<string, unknown>;
  },
  context: FieldContext,
): PackageBaseField => {
  const {
    targetBaseId,
    inverseFieldId,
    ai,
    targetBaseSlug: existingTargetBaseSlug,
    ...rest
  } = field.options as Record<string, unknown> & {
    targetBaseId?: string;
    inverseFieldId?: string;
    targetBaseSlug?: string;
    ai?: Record<string, unknown> & { sourceFieldIds?: string[] };
  };

  const options: Record<string, unknown> = { ...rest };

  if (typeof targetBaseId === "string") {
    const targetSlug = context.baseSlugById.get(targetBaseId);
    if (!targetSlug) {
      throw new Error(
        `Field "${context.baseSlug}.${field.slug}" relates to a Base that no longer exists (${targetBaseId}). Fix the field before exporting.`,
      );
    }
    options.targetBaseSlug = targetSlug;
  } else if (typeof existingTargetBaseSlug === "string") {
    options.targetBaseSlug = existingTargetBaseSlug;
  }

  if (typeof inverseFieldId === "string") {
    // The inverse field usually lives in the TARGET base — `fieldSlugById` is
    // space-wide (see buildIndexes) precisely so a cross-base inverse resolves.
    const inverseSlug = context.fieldSlugById.get(inverseFieldId);
    if (inverseSlug) {
      options.inverseFieldSlug = inverseSlug;
    } else {
      // Only reachable if the inverse points at a field that no longer exists.
      // Warn rather than drop it silently — a lost inverse is invisible damage.
      context.warn(
        `Field "${context.baseSlug}.${field.slug}" names an inverse field (${inverseFieldId}) that no longer exists; the package ships the relation without its inverse link.`,
      );
    }
  }

  if (ai) {
    const { sourceFieldIds, ...aiRest } = ai;
    const aiOptions: Record<string, unknown> = { ...aiRest };
    if (Array.isArray(sourceFieldIds) && sourceFieldIds.length > 0) {
      const slugs = sourceFieldIds
        .map((id) => context.fieldSlugById.get(id))
        .filter((slug): slug is string => Boolean(slug));
      if (slugs.length !== sourceFieldIds.length) {
        context.warn(
          `Field "${context.baseSlug}.${field.slug}" references AI source field(s) that no longer exist — they were dropped from the package.`,
        );
      }
      if (slugs.length > 0) aiOptions.sourceFieldSlugs = slugs;
    }
    options.ai = aiOptions;
  }

  return {
    slug: field.slug,
    name: field.name,
    type: field.type,
    required: field.required,
    position: field.position,
    options: options as PackageFieldOptions,
  };
};

/** `ViewVO` minus ids. `config.filters[]`/`sorts[]` keep `fieldSlug` and drop `fieldId`. */
const toPackageView = (view: {
  slug: string;
  name: string;
  description: string;
  config: {
    filters: { fieldSlug: string; fieldId?: string; operator: string; value?: unknown }[];
    sorts: { direction: "asc" | "desc"; fieldSlug: string; fieldId?: string }[];
    visibleFieldSlugs?: string[] | null;
    fieldWidths?: Record<string, number>;
  };
}): PackageView => ({
  slug: view.slug,
  name: view.name,
  description: view.description ?? "",
  type: "table",
  config: {
    filters: view.config.filters.map((filter) => ({
      fieldSlug: filter.fieldSlug,
      operator: filter.operator as PackageView["config"]["filters"][number]["operator"],
      value: filter.value,
    })),
    sorts: view.config.sorts.map((sort) => ({
      direction: sort.direction,
      fieldSlug: sort.fieldSlug,
    })),
    visibleFieldSlugs: view.config.visibleFieldSlugs ?? undefined,
    fieldWidths: view.config.fieldWidths,
  },
});

const collectRecords = async (
  client: PackageClient,
  baseId: string,
  fields: readonly { slug: string; type: string }[],
  options: CollectOptions,
): Promise<PackageRecordLine[]> => {
  const typeBySlug = new Map(fields.map((field) => [field.slug, field.type]));
  const records: PackageRecordLine[] = [];
  let droppedAttachments = 0;
  let cursor: string | undefined;

  do {
    const page = await client.records.list({ baseId, limit: 100, cursor });
    for (const record of page.records) {
      if (record.status !== "active") continue;
      const values: Record<string, unknown> = {};
      for (const [slug, value] of Object.entries(record.headCommit.payload ?? {})) {
        const type = typeBySlug.get(slug);
        if (!type) continue;
        if (PACKAGE_COMPUTED_FIELD_TYPES.includes(type)) continue;
        if (type === "attachment") {
          if (value !== null && value !== undefined) droppedAttachments++;
          continue;
        }
        if (value === null || value === undefined) continue;
        values[slug] = value;
      }
      // `export` keys on the SOURCE record id: stable across re-exports (clean git
      // diffs), unique package-wide, and meaningless to the target.
      records.push({ key: record.id, fields: values });
    }
    cursor = page.nextCursor ?? undefined;
  } while (cursor);

  if (droppedAttachments > 0) {
    options.warn(
      `Dropped ${droppedAttachments} attachment value(s) from this Base — attachment values are not carried by ${PACKAGE_FORMAT} (the field definitions are kept).`,
    );
  }
  return records.sort((a, b) => a.key.localeCompare(b.key, "en"));
};

const collectFileTree = async (
  client: PackageClient,
  source: SourceNode,
  type: "skill" | "drive" | "airapp",
  common: NodeCommon,
  options: CollectOptions,
  // Narrower than `PackageNode` so the root-skill path can reach `.files`
  // without a cast; this function only ever returns a file-tree node.
): Promise<PackageFileTreeNode> => {
  const listed = await client.fileTrees.listFiles({ nodeId: source.id, type });
  const files: PackageFileEntry[] = [];
  for (const file of listed) {
    const read = await client.fileTrees.readFile({
      nodeId: source.id,
      filePath: file.path,
      type,
    });
    files.push({
      path: file.path,
      bytes:
        read.encoding === "url"
          ? await downloadBytes(read.content, file.path, options)
          : Buffer.from(read.content, "utf8"),
    });
  }
  return {
    ...common,
    type: source.type as "skill" | "airapp" | "drive",
    files,
  };
};

const collectFile = async (
  client: PackageClient,
  source: SourceNode,
  common: NodeCommon,
  options: CollectOptions,
): Promise<PackageNode | undefined> => {
  // Reads through the unified Node detail route (`files.get` is retired); the
  // `file` branch carries the same backing `asset`.
  const fileNode = await client.nodes.get({ nodeId: source.id, type: "file" });
  if (fileNode.type !== "file") {
    throw new Error(`Expected a file node for "${source.slug}", got "${fileNode.type}".`);
  }
  const asset = fileNode.asset;
  if (!asset?.url) {
    options.warn(`Skipped file node "${source.slug}": it has no downloadable asset.`);
    return undefined;
  }
  const fileName = asset.fileName ?? source.slug;
  return {
    ...common,
    type: "file",
    fileName,
    mimeType: asset.mimeType ?? guessMimeType(fileName),
    bytes: await downloadBytes(asset.url, fileName, options),
  };
};

const downloadBytes = async (
  url: string,
  label: string,
  options: CollectOptions,
): Promise<Buffer> => {
  // See CollectOptions.baseUrl — a local server's download url is root-relative.
  const resolved = new URL(url, options.baseUrl).toString();
  const response = await fetch(resolved);
  if (!response.ok) {
    throw new Error(`Failed to download "${label}" (${response.status} ${response.statusText}).`);
  }
  return Buffer.from(await response.arrayBuffer());
};

/**
 * §12: a package must be self-contained. A relation whose target base isn't in the
 * package, or a relation value pointing at a record that isn't, would install as a
 * dangling reference — so export fails naming the field and the external base rather
 * than emitting it.
 *
 * A Doc referencing an image the package does not carry breaks the same rule, and
 * is checked here too — but as a WARNING, not an error, and the asymmetry is
 * deliberate:
 *
 *   • An out-of-package relation is a CORRECTNESS hazard the exporter can always
 *     fix: base slugs are unique per space, so on the target the relation would
 *     silently bind to whatever base happens to own that slug — someone else's
 *     data, wired up wrong, with no error. Refusing is the only safe answer, and
 *     "export a subtree that includes both Bases" is a remedy the user has.
 *   • A missing Doc image is a DEGRADATION with no remedy at export time. It gets
 *     here only when the bytes could not be read at all (the asset was deleted,
 *     or the exporter cannot see it) — retrying the export changes nothing.
 *     Failing would mean one dead image in one doc makes the entire workspace
 *     unexportable, which trades a broken image for a broken export. Nothing
 *     installs wrong because of it: the reference simply stays unresolved, and
 *     `apply` says so again on the target.
 *
 * So the rule the format actually enforces is: never ship a reference that would
 * resolve to the WRONG thing; do warn about one that resolves to nothing.
 */
export const assertSelfContained = (tree: PackageTree, options: CollectOptions): void => {
  const carriedAssetIds = new Set((tree.assets ?? []).map((asset) => asset.assetId));
  for (const node of walkNodes(tree.nodes)) {
    if (node.type !== "doc") continue;
    const warning = reportUnresolvableDocAssets(node.slug, node.body, carriedAssetIds);
    if (warning) options.warn(warning);
  }

  const baseNodes = [...walkNodes(tree.nodes)].filter((node) => node.type === "base");
  const packagedBaseSlugs = new Set(baseNodes.map((node) => node.slug));
  const packagedRecordKeys = new Set(
    baseNodes.flatMap((node) =>
      node.type === "base" ? node.records.map((record) => record.key) : [],
    ),
  );

  for (const node of baseNodes) {
    if (node.type !== "base") continue;
    // A REQUIRED attachment field can never be satisfied by this format:
    // `collectRecords` drops every attachment value (the format carries field
    // definitions, not bytes), so the column is empty in every exported record
    // by construction. Install then rejects the package — observed on a real
    // space, which failed after creating 2,903 records with
    // `Invalid field value: 文件 is required`. Unlike the relation case below,
    // this needs no per-record check: there is no value that could survive.
    for (const field of node.base.fields) {
      if (field.type !== "attachment" || !field.required) continue;
      field.required = false;
      options.warn(
        `Base "${node.slug}": attachment field "${field.slug}" is required in the source, but ` +
          `${PACKAGE_FORMAT} never carries attachment values — the field would be empty in every ` +
          "installed record and the install would fail. It is marked NOT required in this package.",
      );
    }
    for (const field of node.base.fields) {
      const targetBaseSlug = field.options.targetBaseSlug;
      if (field.type !== "relation" || !targetBaseSlug) continue;
      if (!packagedBaseSlugs.has(targetBaseSlug)) {
        throw new Error(
          `Field "${node.slug}.${field.slug}" relates to Base "${targetBaseSlug}", which is outside the subtree being exported. A package must be self-contained — export a subtree that includes both Bases, or remove the field.`,
        );
      }
    }
    let dangling = 0;
    // Fields where dropping a dangling value left a REQUIRED relation empty.
    // Tracked per field (not per record) because `required` is part of the
    // Base's schema — there is no way to say "required except on these rows".
    const emptiedRequired = new Map<string, number>();
    for (const record of node.records) {
      for (const field of node.base.fields) {
        if (field.type !== "relation") continue;
        const value = record.fields[field.slug];
        const keys = Array.isArray(value) ? value : typeof value === "string" ? [value] : [];
        if (keys.length === 0) continue;
        const kept = keys.filter((key) => typeof key !== "string" || packagedRecordKeys.has(key));
        dangling += keys.length - kept.length;
        // The warning below claims these are dropped — actually drop them, or a
        // package that says "self-contained" still ships a reference `apply`'s
        // pass 5 cannot resolve, and `install` fails outright on a record that
        // export already told the user was cleaned up.
        if (kept.length !== keys.length) {
          record.fields[field.slug] = kept;
          if (kept.length === 0 && field.required) {
            emptiedRequired.set(field.slug, (emptiedRequired.get(field.slug) ?? 0) + 1);
          }
        }
      }
    }
    if (dangling > 0) {
      options.warn(
        `Base "${node.slug}" has ${dangling} relation value(s) pointing at records outside the exported subtree — they were dropped.`,
      );
    }
    // Emptying a REQUIRED relation leaves the package contradicting its own
    // schema, and `install` refuses the WHOLE package over it
    // (`record-dependencies.ts`: "is missing required relation"). Observed on a
    // real space: a record's `project` pointed at a row that had since been
    // archived, archived rows are not exported, so the value was dropped — and
    // the resulting package could not be installed anywhere, including back
    // into the space it came from.
    //
    // Relax the constraint in the PACKAGE rather than inventing data or
    // silently dropping the record. The exported Base is then slightly more
    // permissive than the source, which is stated plainly below — an installable
    // package that says what it loosened beats a faithful one nobody can install.
    for (const [slug, count] of emptiedRequired) {
      const field = node.base.fields.find((candidate) => candidate.slug === slug);
      if (!field) continue;
      field.required = false;
      options.warn(
        `Base "${node.slug}": relation field "${slug}" is required in the source, but ${count} ` +
          "record(s) point only at records outside the export (typically archived ones, which " +
          "are never exported). It is marked NOT required in this package so the package can be " +
          "installed; those records install with that field empty.",
      );
    }
  }
};
