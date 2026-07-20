/**
 * The five-pass install apply (§7). Each pass boundary is forced by a verified API
 * constraint — collapsing any two of them produces code that passes most tests and
 * silently loses data on the cases that matter:
 *
 *   1. Structure           folders → docs → file-tree/file nodes → bases (plain fields only)
 *   2. Relation + AI fields  `options.targetBaseSlug` resolves only against bases that
 *                            already exist, and relations may be CYCLIC (A↔B), so no
 *                            base ordering can satisfy them at create time.
 *   3. Field-id patches      `inverseFieldId` / `ai.sourceFieldIds` are raw field ids
 *                            with no slug alias; their targets exist only after pass 2.
 *   4. Records (no relations)
 *   5. Relation values       relation targets that don't exist yet are SILENTLY DROPPED
 *                            server-side, so values written in pass 4 would vanish.
 *
 * Structure vs content, and what `--auto-merge` actually decides: folders, Bases,
 * their fields and their views are STRUCTURE and are always created immediately —
 * a pending Base has no id, and without an id there is nowhere to put a view, a
 * field patch, or a record. Records are CONTENT and are the only thing
 * `--auto-merge` gates: without it they land as change requests to review (which is
 * the point of a review-first install), with it they are merged on the spot.
 * Relation VALUES need the ids of merged records, so a package whose Bases carry
 * relation fields refuses to install without `--auto-merge` (plan.requiresAutoMerge)
 * rather than installing every relation empty.
 */

import { createHash } from "node:crypto";
import {
  PACKAGE_COMPUTED_FIELD_TYPES,
  PACKAGE_DEFERRED_FIELD_TYPES,
  type PackageBaseField,
  type PackageFieldOptions,
} from "busabase-contract/domains/package/types";
import type { PackageClient } from "./client";
import type { InstallPlan } from "./plan";
import {
  collectBaseNodes,
  guessMimeType,
  isTextMimeType,
  type PackageBaseNode,
  type PackageFileTreeNode,
  type PackageNode,
} from "./tree";

/** §7.4 — records are proposed in batches of this size. */
export const RECORD_BATCH_SIZE = 200;

export interface ApplyOptions {
  autoMerge: boolean;
  submittedBy?: string;
  /** Progress reporting; `install` prints these as the passes run. */
  onProgress?: (message: string) => void;
}

export interface ApplyResult {
  targetFolderNodeId: string;
  created: {
    folders: number;
    docs: number;
    bases: number;
    views: number;
    records: number;
    fileTreeNodes: number;
    files: number;
  };
  /** Change requests left for a human to review (a non-`--auto-merge` install). */
  pendingChangeRequests: number;
  warnings: string[];
}

/** `(baseSlug, fieldSlug)` → field id, built across passes 1 and 2 and consumed by pass 3. */
type FieldIdIndex = Map<string, string>;
const fieldKey = (baseSlug: string, fieldSlug: string): string => `${baseSlug}\u0000${fieldSlug}`;

interface BaseContext {
  node: PackageBaseNode;
  baseId: string;
}

export const applyInstall = async (
  client: PackageClient,
  plan: InstallPlan,
  options: ApplyOptions,
): Promise<ApplyResult> => {
  const state: ApplyResult = {
    targetFolderNodeId: "",
    created: { folders: 0, docs: 0, bases: 0, views: 0, records: 0, fileTreeNodes: 0, files: 0 },
    pendingChangeRequests: 0,
    warnings: [...plan.warnings],
  };
  const fieldIds: FieldIdIndex = new Map();
  const bases: BaseContext[] = [];
  const progress = options.onProgress ?? (() => {});

  // ── Pass 1: structure ──────────────────────────────────────────────────────
  progress("Pass 1/5: creating the node tree…");
  state.targetFolderNodeId = await createFolderNode(client, {
    parentNodeId: undefined,
    slug: plan.targetFolderSlug,
    name: plan.tree.manifest.name,
    description: plan.tree.manifest.description,
    submittedBy: options.submittedBy,
  });
  state.created.folders++;
  await createStructure(
    client,
    plan.tree.nodes,
    state.targetFolderNodeId,
    options,
    state,
    bases,
    fieldIds,
  );

  // ── Pass 2: relation + AI fields ───────────────────────────────────────────
  const deferred = bases.filter((base) => base.node.base.fields.some(isDeferredField));
  if (deferred.length > 0) {
    progress("Pass 2/5: adding relation and AI fields…");
    for (const base of deferred) {
      for (const field of base.node.base.fields.filter(isDeferredField)) {
        // Immediate, never a change request — `bases.createField` has no autoMerge and
        // returns the whole base, so the new field's id is read back by slug.
        const updated = await client.bases.createField({
          baseId: base.baseId,
          slug: field.slug,
          name: field.name,
          type: field.type,
          required: field.required,
          options: toApiFieldOptions(field.options),
        });
        indexFields(fieldIds, base.node.slug, updated.fields);
      }
    }
  }

  // ── Pass 3: field-id patches ───────────────────────────────────────────────
  const patchable = bases.flatMap((base) =>
    base.node.base.fields.filter(needsFieldIdPatch).map((field) => ({ base, field })),
  );
  if (patchable.length > 0) {
    progress("Pass 3/5: resolving inverse and AI source field references…");
    for (const { base, field } of patchable) {
      const fieldId = fieldIds.get(fieldKey(base.node.slug, field.slug));
      if (!fieldId) {
        throw new Error(
          `Internal error: no field id for ${base.node.slug}.${field.slug} in pass 3.`,
        );
      }
      const patched = resolveFieldIdOptions(field, base.node.slug, fieldIds, state.warnings);
      if (!patched) continue;
      const changeRequest = await client.bases.updateFieldChangeRequest({
        baseId: base.baseId,
        fieldId,
        patch: { options: patched },
        message: `Wire up ${base.node.slug}.${field.slug} references`,
        submittedBy: options.submittedBy,
      });
      await approveAndMerge(client, changeRequest.id);
    }
  }

  // ── Pass 4: records, relation values omitted ───────────────────────────────
  // `key` → the newly minted record id, the map pass 5 resolves relations through.
  const recordIdsByKey = new Map<string, string>();
  const withRecords = bases.filter((base) => base.node.records.length > 0);
  if (withRecords.length > 0) {
    progress("Pass 4/5: creating records…");
    for (const base of withRecords) {
      await createRecords(client, base, plan, options, state, recordIdsByKey);
    }
  }

  // ── Pass 5: relation values ────────────────────────────────────────────────
  const relationFieldSlugs = new Map<string, string[]>();
  for (const base of bases) {
    const slugs = base.node.base.fields
      .filter((field) => field.type === "relation")
      .map((field) => field.slug);
    if (slugs.length > 0) relationFieldSlugs.set(base.node.slug, slugs);
  }
  if (relationFieldSlugs.size > 0) {
    progress("Pass 5/5: linking relations…");
    for (const base of bases) {
      const slugs = relationFieldSlugs.get(base.node.slug);
      if (!slugs) continue;
      await linkRelations(client, base, slugs, recordIdsByKey, options, state);
    }
  }

  return state;
};

// ── Pass 1 helpers ───────────────────────────────────────────────────────────

const createStructure = async (
  client: PackageClient,
  nodes: readonly PackageNode[],
  parentNodeId: string,
  options: ApplyOptions,
  state: ApplyResult,
  bases: BaseContext[],
  fieldIds: FieldIdIndex,
): Promise<void> => {
  for (const node of nodes) {
    switch (node.type) {
      case "folder": {
        const nodeId = await createFolderNode(client, {
          parentNodeId,
          slug: node.slug,
          name: node.name,
          description: node.description,
          submittedBy: options.submittedBy,
        });
        state.created.folders++;
        await createStructure(client, node.children, nodeId, options, state, bases, fieldIds);
        break;
      }
      case "doc": {
        const result = await client.docs.create({
          parentNodeId,
          slug: node.slug,
          name: node.name,
          description: node.description,
          body: node.body,
          autoMerge: options.autoMerge,
        });
        if (result.materialized) state.created.docs++;
        else state.pendingChangeRequests++;
        break;
      }
      case "base": {
        await createBase(client, node, parentNodeId, options, state, bases, fieldIds);
        break;
      }
      case "skill":
      case "airapp":
      case "drive": {
        await createFileTreeNode(client, node, parentNodeId, options, state);
        break;
      }
      case "file": {
        let asset: { assetId: string };
        try {
          asset = await uploadAsset(client, node.fileName, node.mimeType, node.bytes);
        } catch (error) {
          // A file node IS its bytes — with no asset there is nothing to create,
          // so skip the node itself rather than making an empty one.
          state.warnings.push(asSkippableUpload(error, node.fileName));
          break;
        }
        const result = await client.files.create({
          parentNodeId,
          slug: node.slug,
          name: node.name,
          description: node.description,
          assetId: asset.assetId,
          autoMerge: options.autoMerge,
        });
        if (result.materialized) state.created.files++;
        else state.pendingChangeRequests++;
        break;
      }
    }
  }
};

/**
 * Folders are always auto-merged, regardless of `--auto-merge`. A folder is an empty
 * container with nothing to review, and every child create needs a REAL `parentNodeId`
 * — an unmerged folder has no node id, so nothing could be nested inside it.
 */
const createFolderNode = async (
  client: PackageClient,
  input: {
    parentNodeId: string | undefined;
    slug: string;
    name: string;
    description: string;
    submittedBy: string | undefined;
  },
): Promise<string> => {
  const changeRequest = await client.nodes.createChangeRequest({
    message: `Install folder ${input.slug}`,
    submittedBy: input.submittedBy,
    autoMerge: true,
    operations: [
      {
        kind: "create",
        nodeType: "folder",
        slug: input.slug,
        name: input.name,
        description: input.description,
        parentNodeId: input.parentNodeId,
      },
    ],
  });
  const nodeId = changeRequest.operations[0]?.nodeId;
  if (!nodeId) {
    throw new Error(
      `Folder "${input.slug}" was created but the server returned no node id, so nothing could be installed inside it.`,
    );
  }
  return nodeId;
};

const createBase = async (
  client: PackageClient,
  node: PackageBaseNode,
  parentNodeId: string,
  options: ApplyOptions,
  state: ApplyResult,
  bases: BaseContext[],
  fieldIds: FieldIdIndex,
): Promise<void> => {
  // Pass 1 creates PLAIN fields only. Relation/AI fields are deferred to pass 2.
  const immediateFields = node.base.fields
    .filter((field) => !isDeferredField(field))
    .map((field) => ({
      slug: field.slug,
      name: field.name,
      type: field.type,
      required: field.required,
      options: toApiFieldOptions(field.options),
    }));

  const result = await client.bases.create({
    parentNodeId,
    slug: node.slug,
    name: node.name,
    description: node.description,
    fields: immediateFields,
    // A Base's schema is structure, so it is created immediately even on a
    // review-first install — the same reasoning as folders (see createFolderNode).
    // This is load-bearing, not a shortcut: a PENDING Base has no id, and without
    // an id there is nothing to hang views, field patches, or records on. When the
    // base was left pending, its records were dropped on the floor with no error —
    // the user merged the change request and got an empty Base. Materializing the
    // container is what lets the CONTENT (records, below) be proposed for review at
    // all, which is the part a reviewer actually wants to see.
    autoMerge: true,
  });

  if (!result.materialized) {
    throw new Error(
      `Base "${node.slug}" was requested immediately but the server returned a pending change request; install cannot attach its views or records to it.`,
    );
  }

  state.created.bases++;
  bases.push({ node, baseId: result.id });
  indexFields(fieldIds, node.slug, result.fields);

  for (const view of node.base.views) {
    const changeRequest = await client.bases.createViewChangeRequest({
      baseId: result.id,
      slug: view.slug,
      name: view.name,
      description: view.description,
      config: view.config,
      submittedBy: options.submittedBy,
    });
    await approveAndMerge(client, changeRequest.id);
    state.created.views++;
  }
};

const createFileTreeNode = async (
  client: PackageClient,
  node: PackageFileTreeNode,
  parentNodeId: string,
  options: ApplyOptions,
  state: ApplyResult,
): Promise<void> => {
  const uploaded = await Promise.all(
    node.files.map(async (entry) => {
      const mimeType = guessMimeType(entry.path);
      if (isTextMimeType(mimeType)) {
        return { path: entry.path, content: entry.bytes.toString("utf8"), mimeType };
      }
      try {
        const asset = await uploadAsset(
          client,
          entry.path.split("/").at(-1) ?? entry.path,
          mimeType,
          entry.bytes,
        );
        return { path: entry.path, assetId: asset.assetId, mimeType };
      } catch (error) {
        // Drop just this file from the node; its siblings still install.
        state.warnings.push(asSkippableUpload(error, `${node.slug}/${entry.path}`));
        return undefined;
      }
    }),
  );
  const files = uploaded.filter((entry) => entry !== undefined);

  const api =
    node.type === "skill" ? client.skills : node.type === "airapp" ? client.airapps : client.drives;
  const result = await api.create({
    parentNodeId,
    slug: node.slug,
    name: node.name,
    description: node.description,
    files,
    // The package hands over a complete, self-contained node; "merge" would layer the
    // default scaffold underneath and leave stray unrelated files behind.
    mergeMode: "replace",
    autoMerge: options.autoMerge,
  });
  if (result.materialized) {
    state.created.fileTreeNodes++;
    state.created.files += node.files.length;
  } else {
    state.pendingChangeRequests++;
  }
};

// ── Assets ───────────────────────────────────────────────────────────────────

/**
 * Thrown when the host can't accept an upload the normal way — see
 * {@link uploadAsset}. Callers turn this into a skip + warning rather than
 * failing the whole install: one un-uploadable binary must not cost the user
 * the other 99% of the package.
 */
class UploadTargetUnsupportedError extends Error {}

/**
 * Upload bytes and return the asset id, through the normal assets API only:
 * `createUploadUrl` → PUT the bytes to the returned url → `confirm`.
 *
 * A host backed by S3/R2/MinIO returns an absolute presigned url and this works.
 * A host on the local filesystem adapter has no presigned url to give, so it
 * returns a root-relative `/api/dev/upload` sentinel that expects the caller to
 * know it means "POST multipart here instead" — dev-environment knowledge that
 * does not belong in a client. We deliberately do NOT special-case it: clients
 * should only ever follow the url the API hands them. Binary uploads against
 * such a host are reported as skipped until the upload contract is unified
 * server-side (tracked separately; the browser uploader's `isDevUpload` branch
 * in open-domains/share-domains has the same problem).
 */
const uploadAsset = async (
  client: PackageClient,
  fileName: string,
  mimeType: string,
  bytes: Buffer,
): Promise<{ assetId: string }> => {
  const contentHash = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
  const requested = await client.assets.createUploadUrl({
    fileName,
    mimeType,
    sizeBytes: bytes.byteLength,
    context: "record-field",
    contentHash,
  });

  // Content-addressed: identical bytes already stored, so there is nothing to upload.
  if (requested.duplicate) {
    const assetId = requested.assetId ?? requested.attachmentId;
    if (!assetId)
      throw new Error(`Server reported "${fileName}" as a duplicate but returned no asset id.`);
    return { assetId };
  }

  if (!/^https?:\/\//.test(requested.uploadUrl)) {
    throw new UploadTargetUnsupportedError(
      `this server issued a non-absolute upload url (${requested.uploadUrl}), which only its own web UI knows how to use`,
    );
  }

  const uploaded = await fetch(requested.uploadUrl, {
    method: "PUT",
    body: new Uint8Array(bytes),
    headers: { "content-type": mimeType },
  });
  if (!uploaded.ok) {
    throw new Error(`Upload of "${fileName}" failed (${uploaded.status} ${uploaded.statusText}).`);
  }

  const confirmed = await client.assets.confirm({
    storageKey: requested.storageKey,
    fileName,
    mimeType,
    sizeBytes: bytes.byteLength,
    context: "record-field",
    contentHash,
  });
  const assetId = confirmed.assetId ?? confirmed.attachmentId;
  if (!assetId) throw new Error(`Upload of "${fileName}" was confirmed but returned no asset id.`);
  return { assetId };
};

/** `uploadAsset` failed in the "this host can't take uploads from a CLI" way — skip, don't abort. */
const asSkippableUpload = (error: unknown, label: string): string => {
  if (error instanceof UploadTargetUnsupportedError) {
    return `Skipped binary file "${label}": ${error.message}. Everything else in the package was installed.`;
  }
  throw error;
};

// ── Field options ────────────────────────────────────────────────────────────

const isDeferredField = (field: PackageBaseField): boolean =>
  PACKAGE_DEFERRED_FIELD_TYPES.includes(field.type);

const needsFieldIdPatch = (field: PackageBaseField): boolean =>
  Boolean(field.options.inverseFieldSlug) ||
  Boolean(field.options.ai?.sourceFieldSlugs && field.options.ai.sourceFieldSlugs.length > 0);

/**
 * Strip the two PACKAGE-ONLY option keys. `inverseFieldSlug` and `ai.sourceFieldSlugs`
 * have no server-side alias; they exist only in the package and are resolved to real
 * ids in pass 3. `targetBaseSlug` is NOT stripped — it is the API's own native alias.
 */
export const toApiFieldOptions = (options: PackageFieldOptions): Record<string, unknown> => {
  const { inverseFieldSlug: _inverseFieldSlug, ai, ...rest } = options;
  const apiOptions: Record<string, unknown> = { ...rest };
  if (ai) {
    const { sourceFieldSlugs: _sourceFieldSlugs, ...aiRest } = ai;
    apiOptions.ai = aiRest;
  }
  return apiOptions;
};

/**
 * Pass 3: the API options plus the resolved raw ids. Returns undefined when nothing
 * resolved, so no pointless change request is raised.
 */
export const resolveFieldIdOptions = (
  field: PackageBaseField,
  baseSlug: string,
  fieldIds: FieldIdIndex,
  warnings: string[],
): Record<string, unknown> | undefined => {
  const options = toApiFieldOptions(field.options);
  let resolvedAny = false;

  const inverseFieldSlug = field.options.inverseFieldSlug;
  if (inverseFieldSlug) {
    // The inverse of a relation lives in the TARGET base, not this one.
    const targetBaseSlug = field.options.targetBaseSlug;
    const inverseId = targetBaseSlug
      ? fieldIds.get(fieldKey(targetBaseSlug, inverseFieldSlug))
      : undefined;
    if (inverseId) {
      options.inverseFieldId = inverseId;
      resolvedAny = true;
    } else {
      warnings.push(
        `Could not resolve the inverse field "${inverseFieldSlug}" of ${baseSlug}.${field.slug} in base "${targetBaseSlug ?? "?"}" — the relation is installed, but its inverse link is not set.`,
      );
    }
  }

  const sourceFieldSlugs = field.options.ai?.sourceFieldSlugs;
  if (sourceFieldSlugs && sourceFieldSlugs.length > 0) {
    // AI source fields live in the SAME base as the AI field itself.
    const sourceFieldIds = sourceFieldSlugs.map((slug) => fieldIds.get(fieldKey(baseSlug, slug)));
    const missing = sourceFieldSlugs.filter((_, index) => !sourceFieldIds[index]);
    if (missing.length > 0) {
      warnings.push(
        `Could not resolve AI source field(s) ${missing.map((slug) => `"${slug}"`).join(", ")} for ${baseSlug}.${field.slug} — the field is installed without them.`,
      );
    }
    const resolved = sourceFieldIds.filter((id): id is string => Boolean(id));
    if (resolved.length > 0) {
      const ai = (options.ai as Record<string, unknown> | undefined) ?? {};
      options.ai = { ...ai, sourceFieldIds: resolved };
      resolvedAny = true;
    }
  }

  return resolvedAny ? options : undefined;
};

const indexFields = (
  fieldIds: FieldIdIndex,
  baseSlug: string,
  fields: readonly { id: string; slug: string }[],
): void => {
  for (const field of fields) fieldIds.set(fieldKey(baseSlug, field.slug), field.id);
};

// ── Records ──────────────────────────────────────────────────────────────────

/** Values the server computes, and relation values (pass 5), are never sent in pass 4. */
const toCreatableFields = (
  node: PackageBaseNode,
  fields: Record<string, unknown>,
): Record<string, unknown> => {
  const typeBySlug = new Map(node.base.fields.map((field) => [field.slug, field.type]));
  const result: Record<string, unknown> = {};
  for (const [slug, value] of Object.entries(fields)) {
    const type = typeBySlug.get(slug);
    if (!type) continue;
    if (type === "relation") continue;
    if (PACKAGE_COMPUTED_FIELD_TYPES.includes(type)) continue;
    if (type === "attachment") continue; // §6.4: attachment values are not published in v1.
    result[slug] = value;
  }
  return result;
};

const createRecords = async (
  client: PackageClient,
  base: BaseContext,
  plan: InstallPlan,
  options: ApplyOptions,
  state: ApplyResult,
  recordIdsByKey: Map<string, string>,
): Promise<void> => {
  const records = [...base.node.records].sort((a, b) => a.key.localeCompare(b.key, "en"));
  for (let offset = 0; offset < records.length; offset += RECORD_BATCH_SIZE) {
    const batch = records.slice(offset, offset + RECORD_BATCH_SIZE);
    const changeRequest = await client.bases.createBulkChangeRequest({
      baseId: base.baseId,
      records: batch.map((record) => toCreatableFields(base.node, record.fields)),
      message: `Install ${batch.length} record(s) into ${base.node.slug}`,
      submittedBy: options.submittedBy,
      idempotencyKey: batchIdempotencyKey(plan.tree.manifest.name, batch[0].key),
    });

    // Records are CONTENT — the thing a reviewer actually wants to see — so without
    // `--auto-merge` they stay a pending change request. That leaves them with no
    // record ids, which is exactly why a package whose Bases carry relation fields
    // refuses to install without `--auto-merge` (`plan.requiresAutoMerge`): pass 5
    // has nothing to link. Non-relation packages install fine review-first.
    if (!options.autoMerge) {
      state.pendingChangeRequests++;
      continue;
    }

    const merged = await approveAndMerge(client, changeRequest.id);

    // `createBulkChangeRequest` sets each operation's `position` to the index in the
    // records array it was given, and merge preserves that order — so the operations
    // map back to the batch positionally. This is the ONLY way to learn the new ids.
    const created = merged.changeRequest.operations
      .filter((operation) => operation.operation === "record_create")
      .sort((a, b) => a.position - b.position);
    for (const [index, record] of batch.entries()) {
      const recordId = created[index]?.mergedRecordId;
      if (recordId) recordIdsByKey.set(record.key, recordId);
    }
    state.created.records += batch.length;
  }
};

/**
 * §7.5. The API dedupes per (base, submitter, key), so re-running an interrupted
 * install returns the original change request instead of duplicating it.
 *
 * The spec writes this key per RECORD, but pass 4 proposes records in bulk batches —
 * one change request, one key, up to 200 records. Keying on the batch's first record
 * key preserves the intent: records are sorted by key and batched deterministically,
 * so the same package always produces the same batches and therefore the same keys.
 */
export const batchIdempotencyKey = (packageName: string, firstRecordKey: string): string =>
  `pkg:${packageName}:${firstRecordKey}`;

const linkRelations = async (
  client: PackageClient,
  base: BaseContext,
  relationFieldSlugs: readonly string[],
  recordIdsByKey: Map<string, string>,
  options: ApplyOptions,
  state: ApplyResult,
): Promise<void> => {
  for (const record of base.node.records) {
    const relationValues: Record<string, unknown> = {};
    let hasRelation = false;
    for (const slug of relationFieldSlugs) {
      const value = record.fields[slug];
      const keys = toKeyArray(value);
      if (keys.length === 0) continue;
      const targetIds = keys
        .map((key) => recordIdsByKey.get(key))
        .filter((id): id is string => Boolean(id));
      const unresolved = keys.filter((key) => !recordIdsByKey.has(key));
      if (unresolved.length > 0) {
        state.warnings.push(
          `Record "${record.key}" in base "${base.node.slug}" links field "${slug}" to ${unresolved.length} record(s) that are not in this package — those links were skipped.`,
        );
      }
      if (targetIds.length > 0) {
        relationValues[slug] = targetIds;
        hasRelation = true;
      }
    }
    if (!hasRelation) continue;

    const recordId = recordIdsByKey.get(record.key);
    if (!recordId) continue;

    // A record update REPLACES the whole field map (the revise commit stores exactly
    // the fields it is given), so the non-relation values from pass 4 must be resent
    // alongside the relations — sending only the delta would blank the record.
    const changeRequest = await client.records.updateChangeRequest({
      recordId,
      fields: { ...toCreatableFields(base.node, record.fields), ...relationValues },
      message: `Link relations for ${base.node.slug}`,
      author: options.submittedBy,
    });
    await approveAndMerge(client, changeRequest.id);
  }
};

const toKeyArray = (value: unknown): string[] => {
  if (Array.isArray(value))
    return value.filter((item): item is string => typeof item === "string" && item.length > 0);
  if (typeof value === "string" && value.length > 0) return [value];
  return [];
};

// ── Change requests ──────────────────────────────────────────────────────────

/** Merging requires an `approved` status, so every auto-merge is review-then-merge. */
const approveAndMerge = async (client: PackageClient, changeRequestId: string) => {
  await client.changeRequests.review({ changeRequestId, verdict: "approved" });
  return client.changeRequests.merge({ changeRequestId });
};

export const __testing = { collectBaseNodes };
