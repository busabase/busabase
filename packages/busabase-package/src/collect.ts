/**
 * `publish`'s read half: a space subtree → the in-memory package tree, entirely via
 * the public read API. The inverse of `apply`.
 *
 * Rewrites the three id-bearing option keys back to slug references, drops everything
 * the format has no slot for (ids, history, permissions), and enforces the format's
 * self-containment rule: a relation may not leave the package.
 */

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
import {
  guessMimeType,
  type PackageFileEntry,
  type PackageNode,
  type PackageTree,
  sortNodes,
} from "./tree";

/** The subset of `nodes.list`'s output publish walks. */
interface SourceNode {
  id: string;
  slug: string;
  name: string;
  description: string;
  type: string;
  position: number;
  baseId?: string | null;
  metadata?: { assetId?: string } | null;
  children?: SourceNode[];
}

export interface CollectOptions {
  manifest: PackageManifest;
  warn: (message: string) => void;
  /**
   * The server we're publishing from. Load-bearing for asset downloads: a local
   * (non-S3) server hands back a ROOT-RELATIVE download url (e.g.
   * `/api/dev/attachment/…`), meant to be fetched same-origin by a browser. The
   * CLI runs out-of-process, so it must resolve that against the host itself —
   * a bare `fetch("/api/…")` throws "Failed to parse URL" in Node. (The same
   * trap `busabase-dump`'s exporter hit and documents.)
   */
  baseUrl: string;
}

/** Find the subtree to publish by node slug or id. */
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
  const children = root.children ?? [];
  const nodes = await collectNodes(client, children, options);
  const tree: PackageTree = { manifest: { ...options.manifest, format: PACKAGE_FORMAT }, nodes };
  assertSelfContained(tree, options);
  return tree;
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
    slug: source.slug,
    name: source.name,
    description: source.description ?? "",
    // `publish` always writes position, so round trips preserve sibling order exactly.
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
      const doc = await client.docs.get({ nodeId: source.id });
      return { ...common, type: "doc", body: doc.body };
    }
    case "base":
      return collectBase(client, source, common, options);
    case "skill":
    case "airapp":
    case "drive":
      return collectFileTree(client, source, common, options);
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
      `Base node "${source.slug}" has no Base behind it (looked up ${baseId}). The space may be mid-migration; re-run publish.`,
    );
  }
  const views = await client.bases.listViews({ baseId: base.id });
  const { baseSlugById, fieldSlugById } = await buildIndexes(client);

  const fields = [...base.fields]
    .sort((a, b) => a.position - b.position)
    .map((field) =>
      toPackageField(field, {
        fieldSlugById,
        baseSlugById,
        baseSlug: base.slug,
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
): Promise<{ baseSlugById: Map<string, string>; fieldSlugById: Map<string, string> }> => {
  const bases = await client.bases.list();
  const baseSlugById = new Map<string, string>();
  const fieldSlugById = new Map<string, string>();
  for (const base of bases) {
    baseSlugById.set(base.id, base.slug);
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
        `Field "${context.baseSlug}.${field.slug}" relates to a Base that no longer exists (${targetBaseId}). Fix the field before publishing.`,
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
    const page = await client.records.listPaged({ baseId, limit: 100, cursor });
    for (const record of page.records) {
      if (record.status !== "active") continue;
      const values: Record<string, unknown> = {};
      for (const [slug, value] of Object.entries(record.headCommit.fields ?? {})) {
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
      // `publish` keys on the SOURCE record id: stable across re-publishes (clean git
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
  common: NodeCommon,
  options: CollectOptions,
): Promise<PackageNode> => {
  const api =
    source.type === "skill"
      ? client.skills
      : source.type === "airapp"
        ? client.airapps
        : client.drives;
  const listed = await api.listFiles({ nodeId: source.id });
  const files: PackageFileEntry[] = [];
  for (const file of listed) {
    const read = await api.readFile({ nodeId: source.id, filePath: file.path });
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
  const fileNode = await client.files.get({ nodeId: source.id });
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
 * dangling reference — so publish fails naming the field and the external base rather
 * than emitting it.
 */
const assertSelfContained = (tree: PackageTree, options: CollectOptions): void => {
  const baseNodes = [...walk(tree.nodes)].filter((node) => node.type === "base");
  const packagedBaseSlugs = new Set(baseNodes.map((node) => node.slug));
  const packagedRecordKeys = new Set(
    baseNodes.flatMap((node) =>
      node.type === "base" ? node.records.map((record) => record.key) : [],
    ),
  );

  for (const node of baseNodes) {
    if (node.type !== "base") continue;
    for (const field of node.base.fields) {
      const targetBaseSlug = field.options.targetBaseSlug;
      if (field.type !== "relation" || !targetBaseSlug) continue;
      if (!packagedBaseSlugs.has(targetBaseSlug)) {
        throw new Error(
          `Field "${node.slug}.${field.slug}" relates to Base "${targetBaseSlug}", which is outside the subtree being published. A package must be self-contained — publish a subtree that includes both Bases, or remove the field.`,
        );
      }
    }
    let dangling = 0;
    for (const record of node.records) {
      for (const field of node.base.fields) {
        if (field.type !== "relation") continue;
        const value = record.fields[field.slug];
        const keys = Array.isArray(value) ? value : typeof value === "string" ? [value] : [];
        for (const key of keys) {
          if (typeof key === "string" && !packagedRecordKeys.has(key)) dangling++;
        }
      }
    }
    if (dangling > 0) {
      options.warn(
        `Base "${node.slug}" has ${dangling} relation value(s) pointing at records outside the published subtree — they were dropped.`,
      );
    }
  }
};

const walk = function* (nodes: readonly PackageNode[]): Generator<PackageNode> {
  for (const node of nodes) {
    yield node;
    if (node.type === "folder") yield* walk(node.children);
  }
};
