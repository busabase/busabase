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
 * Pass 1 opens with one preparatory step that is not a pass of its own: the Doc
 * images the package carries are uploaded first, because every one of them comes
 * back with a NEW host-local asset id and the Doc bodies that reference the old
 * ids are written during the very same walk. See {@link uploadDocAssets}.
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
  APP_ROOT_RESOURCE_KEY,
  type AppResourceOwnership,
  type AppRootOwnership,
  TEMPLATE_SKILL_METADATA_KEY,
} from "busabase-contract/domains/package/template";
import {
  PACKAGE_COMPUTED_FIELD_TYPES,
  PACKAGE_DEFERRED_FIELD_TYPES,
  type PackageBaseField,
  type PackageFieldOptions,
} from "busabase-contract/domains/package/types";
import type { PackageClient } from "./client";
import { reportUnresolvableDocAssets, rewriteDocAssetIds } from "./doc-asset-refs";
import type { InstallPlan } from "./plan";
import {
  collectBaseNodes,
  guessMimeType,
  isTextMimeType,
  type PackageBaseNode,
  type PackageDocAsset,
  type PackageFileTreeNode,
  type PackageNode,
  type PackageTree,
} from "./tree";

/** §7.4 — records are proposed in batches of this size. */
export const RECORD_BATCH_SIZE = 200;

export interface ApplyOptions {
  autoMerge: boolean;
  submittedBy?: string;
  /** Progress reporting; `install` prints these as the passes run. */
  onProgress?: (message: string) => void;
  /**
   * Origin of the server `client` talks to, used to resolve a ROOT-RELATIVE
   * upload url into something an out-of-process caller can PUT to.
   *
   * A host on local-disk storage has no presigned target to hand out, so
   * `createUploadUrl` answers with its own relay path (`/api/storage/upload?key=…`)
   * — fine for its web UI, meaningless to a CLI, which is why an unresolvable one
   * makes the upload skip with a warning. The exporter already resolves the
   * mirror-image case (`new URL(downloadUrl, sourceHost)` in busabase-cli's
   * full-exporter); this is the same move on the write side, and without it a
   * default self-hosted target silently installs every package minus its bytes.
   */
  serverUrl?: string;
  /**
   * Where this package came from, recorded on the app's root Folder.
   *
   * Not decoration: without it there is no way to later ask "is there a newer
   * version of this?", because the installed folder would carry no memory of
   * the repo it came from.
   */
  source?: { repo?: string; ref?: string; subdir?: string };
  /**
   * Merge a template's sample records instead of proposing them (default true
   * for templates, ignored otherwise).
   *
   * A template's whole promise is that the app WORKS when you open it, and an
   * app whose tables are empty until you visit the inbox and approve twelve
   * change requests has not delivered that. This is the one deliberate
   * exception to "content goes to review" — see the spec's §13.6 — and it is
   * scoped to sample rows the template author shipped, never to the AirApp code
   * or the Skill, which stay review-first.
   */
  installSampleRecords?: boolean;
  /** Fixed timestamp for the root stamp; defaults to now. Injectable for tests. */
  now?: () => string;
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
  // Read off the plan rather than re-derived: the plan already decided this
  // against the package as written, before it rewrote any slugs. See
  // `InstallPlan.isTemplate` for why asking twice is actively wrong.
  const app = resolveAppContext(plan, options);

  // ── Pass 1: structure ──────────────────────────────────────────────────────
  // Doc images first, before a single Doc is created. A Doc body references its
  // images by asset id, this host is about to mint NEW ids for those bytes, and
  // a Doc cannot be created twice — so the id map has to be complete before the
  // tree walk starts, not discovered during it. Uploading here (rather than
  // lazily, per doc) also carries an image shared by three Docs exactly once.
  const docAssetIds = await uploadDocAssets(
    client,
    plan.tree.assets ?? [],
    state,
    progress,
    options.serverUrl,
  );
  progress("Pass 1/5: creating the node tree…");
  if (plan.existingTargetFolderNodeId) {
    state.targetFolderNodeId = plan.existingTargetFolderNodeId;
  } else {
    state.targetFolderNodeId = await createFolderNode(client, {
      parentNodeId: undefined,
      slug: plan.targetFolderSlug,
      name: plan.tree.manifest.name,
      description: plan.tree.manifest.description,
      submittedBy: options.submittedBy,
      // Only a folder we just created is stamped. Installing into a folder the
      // user already had — or into the space root — must not claim it for this
      // app; that is someone else's container and re-stamping it would make
      // their own tooling think this app owns it.
      metadata: app?.rootMetadata,
    });
    state.created.folders++;
  }
  await createStructure(
    client,
    plan.tree.nodes,
    state.targetFolderNodeId,
    options,
    state,
    bases,
    fieldIds,
    docAssetIds,
    app,
  );

  // The manual, last in pass 1 — after the resources it describes exist, so a
  // reviewer reading the change request sees it in the folder it belongs to.
  if (app?.rootSkill) {
    progress("Pass 1/5: installing the app skill…");
    await createFileTreeNode(
      client,
      {
        type: "skill",
        slug: app.rootSkill.slug,
        name: app.rootSkill.name,
        description: app.rootSkill.description,
        position: undefined,
        files: app.rootSkill.files,
      },
      state.targetFolderNodeId,
      options,
      state,
      app,
      { [TEMPLATE_SKILL_METADATA_KEY]: true },
    );
  }

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
      const changeRequest = await client.bases.fieldChangeRequest({
        operation: "update",
        baseId: base.baseId,
        fieldId,
        patch: { options: patched },
        message: `Wire up ${base.node.slug}.${field.slug} references`,
        submittedBy: options.submittedBy,
        // Field wiring is STRUCTURE, like the Base and its views above — ask for it
        // outright rather than proposing it and immediately approving our own
        // proposal, which is what this used to do only because the endpoint had no
        // `autoMerge`.
        autoMerge: true,
      });
      if (changeRequest.status !== "merged") {
        throw new Error(
          `Field reference wiring for ${base.node.slug}.${field.slug} was requested immediately but came back "${changeRequest.status}"; install cannot leave a Base's relation fields unwired.`,
        );
      }
    }
  }

  // ── Pass 4: records, relation values omitted ───────────────────────────────
  // `key` → the newly minted record id, the map pass 5 resolves relations through.
  const recordIdsByKey = new Map<string, string>();
  const withRecords = bases.filter((base) => base.node.records.length > 0);
  if (withRecords.length > 0) {
    progress("Pass 4/5: creating records…");
    for (const base of withRecords) {
      await createRecords(client, base, plan, options, state, recordIdsByKey, app);
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

/**
 * Everything install needs to know about "this package is an app", resolved once.
 *
 * `undefined` for a plain package, and every stamping/skill/sample-merge branch
 * below is then a no-op — which is what keeps an existing package's install
 * byte-for-byte the behaviour it had before templates existed.
 */
interface AppContext {
  appId: string;
  schemaVersion: number;
  rootMetadata: Record<string, unknown>;
  rootSkill: PackageTree["rootSkill"];
  /** Installed slug → the package's own slug, used as the stamp's resourceKey. */
  resourceKeysBySlug: Record<string, string>;
  mergeSampleRecords: boolean;
}

const resolveAppContext = (plan: InstallPlan, options: ApplyOptions): AppContext | undefined => {
  if (!plan.isTemplate) return undefined;
  const manifest = plan.tree.manifest;
  const schemaVersion = manifest.template?.schemaVersion ?? 1;
  const now = options.now ?? (() => new Date().toISOString());
  const rootStamp: AppRootOwnership = {
    appId: manifest.name,
    resourceKey: APP_ROOT_RESOURCE_KEY,
    schemaVersion,
    ...(manifest.version ? { version: manifest.version } : {}),
    ...(options.source ? { source: options.source } : {}),
    installedAt: now(),
  };
  return {
    appId: manifest.name,
    schemaVersion,
    rootMetadata: rootStamp,
    rootSkill: plan.tree.rootSkill,
    resourceKeysBySlug: plan.resourceKeysBySlug,
    mergeSampleRecords: options.installSampleRecords ?? true,
  };
};

/**
 * Stamp a node the installer just created.
 *
 * Separate from creation because `bases.create` and `fileTrees.create` take no
 * metadata — only `nodes.createChangeRequest` does, which is why the Folder can
 * be stamped inline and these cannot. A stamp that fails is a warning, never a
 * failed install: the resources are already there and useful, and the only loss
 * is that the skill's own `setup.mjs` will later offer to re-claim them, which
 * it is built to do (that is its "repair" path).
 */
const resourceStamp = (
  app: AppContext,
  installedSlug: string,
  extra: Record<string, unknown> = {},
): Record<string, unknown> => {
  const stamp: AppResourceOwnership = {
    appId: app.appId,
    // The slug the PACKAGE declared, not the one it installed under: an app
    // looks its own tables up by a stable internal handle.
    resourceKey: app.resourceKeysBySlug[installedSlug] ?? installedSlug,
    schemaVersion: app.schemaVersion,
  };
  return { ...stamp, ...extra };
};

const stampResource = async (
  client: PackageClient,
  app: AppContext | undefined,
  nodeId: string,
  installedSlug: string,
  state: ApplyResult,
  extra: Record<string, unknown> = {},
): Promise<void> => {
  if (!app) return;
  const stamp = resourceStamp(app, installedSlug, extra);
  try {
    await client.nodes.updateMetadata({ nodeId, metadata: stamp });
  } catch (error) {
    state.warnings.push(
      `Could not record app ownership on "${installedSlug}": ${(error as Error).message}. The node installed fine; running the app's own setup will claim it.`,
    );
  }
};

// ── Pass 1 helpers ───────────────────────────────────────────────────────────

/**
 * Re-create the package's carried Doc images on THIS host and return the
 * old id → new id map the Doc bodies are rewritten through.
 *
 * Runs before anything else in pass 1. A host that cannot take uploads from a
 * client at all (see {@link uploadAsset}) costs this image and nothing more: it
 * stays out of the map, so the body keeps its original reference and the doc is
 * warned about by name — the same outcome as a package that never carried the
 * image. Any other upload failure still fails the install, exactly as it does
 * for a `file` node's bytes.
 */
const uploadDocAssets = async (
  client: PackageClient,
  assets: readonly PackageDocAsset[],
  state: ApplyResult,
  progress: (message: string) => void,
  serverUrl?: string,
): Promise<Map<string, string>> => {
  const idMap = new Map<string, string>();
  if (assets.length === 0) return idMap;

  progress(`Pass 1/5: uploading ${assets.length} doc image(s)…`);
  for (const asset of assets) {
    try {
      // `context: "doc"` matches what the Doc editor's own uploader records, so
      // an installed image is indistinguishable in the Asset library from one
      // pasted into the editor here.
      const uploaded = await uploadAsset(
        client,
        asset.fileName,
        asset.mimeType,
        asset.bytes,
        "doc",
        serverUrl,
      );
      idMap.set(asset.assetId, uploaded.assetId);
    } catch (error) {
      state.warnings.push(asSkippableUpload(error, asset.fileName));
    }
  }
  return idMap;
};

const createStructure = async (
  client: PackageClient,
  nodes: readonly PackageNode[],
  parentNodeId: string,
  options: ApplyOptions,
  state: ApplyResult,
  bases: BaseContext[],
  fieldIds: FieldIdIndex,
  docAssetIds: ReadonlyMap<string, string>,
  app: AppContext | undefined,
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
        await createStructure(
          client,
          node.children,
          nodeId,
          options,
          state,
          bases,
          fieldIds,
          docAssetIds,
          app,
        );
        break;
      }
      case "doc": {
        // Doc bodies reference embedded images by asset id, and asset ids are
        // host-local: the bytes the package carried were re-uploaded above and
        // came back with brand-new ids, so the body has to be re-pointed at them
        // before it is stored. Written once, at create time — the body is
        // immutable content the moment the doc (or its change request) exists.
        //
        // Anything still unmapped is an image the package did not carry or this
        // host refused; it is left byte-for-byte alone and named out loud,
        // because a rewrite cannot invent bytes.
        const warning = reportUnresolvableDocAssets(
          node.slug,
          node.body,
          new Set(docAssetIds.keys()),
        );
        if (warning) state.warnings.push(warning);
        const result = await client.docs.create({
          parentNodeId,
          slug: node.slug,
          name: node.name,
          description: node.description,
          body: rewriteDocAssetIds(node.body, docAssetIds),
          autoMerge: options.autoMerge,
        });
        if (result.materialized) state.created.docs++;
        else state.pendingChangeRequests++;
        break;
      }
      case "base": {
        await createBase(client, node, parentNodeId, options, state, bases, fieldIds, app);
        break;
      }
      case "skill":
      case "airapp":
      case "drive": {
        await createFileTreeNode(client, node, parentNodeId, options, state, app);
        break;
      }
      case "file": {
        let asset: { assetId: string };
        try {
          asset = await uploadAsset(
            client,
            node.fileName,
            node.mimeType,
            node.bytes,
            undefined,
            options.serverUrl,
          );
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
    /** Ownership stamp, when this folder is an app's root. */
    metadata?: Record<string, unknown>;
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
        ...(input.metadata ? { metadata: input.metadata } : {}),
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
  app: AppContext | undefined,
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
  await stampResource(client, app, result.nodeId, node.slug, state);

  for (const view of node.base.views) {
    const created = await client.views.changeRequest({
      operation: "create",
      baseId: result.id,
      slug: view.slug,
      name: view.name,
      description: view.description,
      config: view.config,
      submittedBy: options.submittedBy,
      // Structure, exactly like the Base above — so ask for it outright instead
      // of proposing it and immediately approving+merging our own proposal,
      // which is what this loop used to do only because the endpoint had no
      // `autoMerge`.
      autoMerge: true,
    });
    if (!created.materialized) {
      throw new Error(
        `View "${view.slug}" was requested immediately but the server returned a pending change request; install cannot leave a Base's views behind in review.`,
      );
    }
    state.created.views++;
  }
};

const createFileTreeNode = async (
  client: PackageClient,
  node: PackageFileTreeNode,
  parentNodeId: string,
  options: ApplyOptions,
  state: ApplyResult,
  app: AppContext | undefined,
  extraMetadata: Record<string, unknown> = {},
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
          undefined,
          options.serverUrl,
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

  const result = await client.fileTrees.create({
    type: node.type,
    parentNodeId,
    slug: node.slug,
    name: node.name,
    description: node.description,
    files,
    // Inline, so it rides along the change request on the review-first path.
    // Stamping after the fact only works when the node was created outright —
    // and review-first is the DEFAULT, so a post-hoc stamp meant the ordinary
    // install produced a Skill and an AirApp that the app could never
    // recognise as its own, and whose manual an agent could never find.
    ...(app ? { metadata: resourceStamp(app, node.slug, extraMetadata) } : {}),
    // The package hands over a complete, self-contained node; "merge" would layer the
    // default scaffold underneath and leave stray unrelated files behind.
    mergeMode: "replace",
    autoMerge: options.autoMerge,
  });
  if (result.materialized) {
    state.created.fileTreeNodes++;
    state.created.files += node.files.length;
  } else {
    // The stamp went with the proposal, so it lands when a human merges.
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
 * Finish addressing whatever `createUploadUrl` handed back.
 *
 * Absolute (presigned S3/R2) urls pass through untouched. A root-relative relay
 * path is resolved against the host this client is talking to; with no host to
 * resolve against it stays unusable and the caller skips the upload.
 */
const resolveUploadUrl = (uploadUrl: string, serverUrl?: string): string => {
  if (/^https?:\/\//.test(uploadUrl)) return uploadUrl;
  if (serverUrl) {
    try {
      return new URL(uploadUrl, serverUrl).toString();
    } catch {
      // fall through to the skip below — a malformed serverUrl is not worth
      // failing an otherwise-fine install over
    }
  }
  throw new UploadTargetUnsupportedError(
    `this server issued a root-relative upload url (${uploadUrl}) and no server origin was supplied to resolve it against`,
  );
};

/**
 * Upload bytes and return the asset id, through the normal assets API only:
 * `createUploadUrl` → PUT the bytes to the returned url → `confirm`.
 *
 * A host backed by S3/R2/MinIO returns an absolute presigned url and this works
 * as-is. A host on local-disk storage has no presigned target, so it answers
 * with its own relay path — root-relative, because the browser it was designed
 * for resolves that against the page it is already on. An out-of-process caller
 * cannot, so `serverUrl` (the origin this client talks to) is used to resolve
 * it, exactly as busabase-cli's exporter resolves a root-relative DOWNLOAD url
 * against the source host. We still follow the url the API hands us; we only
 * finish addressing it.
 *
 * Without a `serverUrl` a root-relative url is still unusable, and the upload is
 * reported as skipped rather than failing the whole install.
 */
const uploadAsset = async (
  client: PackageClient,
  fileName: string,
  mimeType: string,
  bytes: Buffer,
  /** Mirrors what the equivalent in-app uploader records — `"doc"` for a Doc image. */
  context = "record-field",
  serverUrl?: string,
): Promise<{ assetId: string }> => {
  const contentHash = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
  const requested = await client.assets.createUploadUrl({
    fileName,
    mimeType,
    sizeBytes: bytes.byteLength,
    context,
    contentHash,
  });

  // Content-addressed: identical bytes already stored, so there is nothing to upload.
  if (requested.duplicate) {
    const assetId = requested.assetId ?? requested.attachmentId;
    if (!assetId)
      throw new Error(`Server reported "${fileName}" as a duplicate but returned no asset id.`);
    return { assetId };
  }

  const uploadUrl = resolveUploadUrl(requested.uploadUrl, serverUrl);

  const uploaded = await fetch(uploadUrl, {
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
    context,
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
    if (type === "attachment") continue; // §6.4: attachment values are not exported in v1.
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
  app: AppContext | undefined,
): Promise<void> => {
  // The one deliberate exception to "content goes to review" (spec §13.6). A
  // template promises an app that works the moment you open it, and an app whose
  // tables stay empty until the user finds the inbox and approves a dozen change
  // requests has not delivered that. Scoped tightly: only rows the template
  // author shipped, only when the package validates AS a template, and never the
  // AirApp code or the Skill — those stay review-first, because they are the
  // parts that execute.
  const mergeRecords = options.autoMerge || (app?.mergeSampleRecords ?? false);
  const records = [...base.node.records].sort((a, b) => a.key.localeCompare(b.key, "en"));
  for (let offset = 0; offset < records.length; offset += RECORD_BATCH_SIZE) {
    const batch = records.slice(offset, offset + RECORD_BATCH_SIZE);
    const changeRequest = await client.bases.createBulkChangeRequest({
      baseId: base.baseId,
      records: batch.map((record) => toCreatableFields(base.node, record.fields)),
      message: `Install ${batch.length} record(s) into ${base.node.slug}`,
      submittedBy: options.submittedBy,
      idempotencyKey: batchIdempotencyKey(plan.tree.manifest.name, batch[0].key),
      // Forwarded explicitly, load-bearing: for a plain package `--auto-merge` is
      // the ONLY thing that decides whether an install's records go live, and that
      // promise is what the review-first install is. Leaving this to the
      // endpoint's permission-aware default would silently merge a review-first
      // install's records for any write-capable installer.
      autoMerge: mergeRecords,
    });

    // Records are CONTENT — the thing a reviewer actually wants to see — so without
    // `--auto-merge` they stay a pending change request. That leaves them with no
    // record ids, which is exactly why a package whose Bases carry relation fields
    // refuses to install without `--auto-merge` (`plan.requiresAutoMerge`): pass 5
    // has nothing to link. Non-relation packages install fine review-first.
    if (!mergeRecords) {
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
    const changeRequest = await client.records.changeRequest({
      operation: "update",
      recordId,
      fields: { ...toCreatableFields(base.node, record.fields), ...relationValues },
      message: `Link relations for ${base.node.slug}`,
      author: options.submittedBy,
      autoMerge: false,
    });
    if (changeRequest.materialized) {
      throw new Error("Relation update unexpectedly bypassed the install review flow");
    }
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
  const reviewed = await client.changeRequests.review({
    changeRequestIds: [changeRequestId],
    verdict: "approved",
  });
  const reviewResult = reviewed.results[0];
  if (!reviewResult?.ok) {
    throw Object.assign(
      new Error(reviewResult?.error ?? "Change request review returned no result"),
      {
        code: reviewResult?.code,
        data: reviewResult?.data,
      },
    );
  }
  const merged = await client.changeRequests.merge({ changeRequestIds: [changeRequestId] });
  const mergeResult = merged.results[0];
  if (!mergeResult?.ok) {
    throw Object.assign(
      new Error(mergeResult?.error ?? "Change request merge returned no result"),
      {
        code: mergeResult?.code,
        data: mergeResult?.data,
      },
    );
  }
  return mergeResult;
};

export const __testing = { collectBaseNodes };
