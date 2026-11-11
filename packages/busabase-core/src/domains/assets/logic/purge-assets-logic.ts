import "server-only";

import { ORPCError } from "@orpc/server";
import {
  type AnyColumn,
  and,
  asc,
  desc,
  eq,
  gt,
  inArray,
  isNull,
  ne,
  not,
  or,
  type SQL,
  sql,
} from "drizzle-orm";
import { storage } from "openlib/storage";
import type { BusabaseDatabase } from "../../../context";
import { getContextSpaceId } from "../../../context";
import {
  attachments,
  busabaseAssets,
  busabaseAssetUsages,
  busabaseBases,
  busabaseCommits,
  busabaseNodes,
  busabaseOperations,
  busabaseRecords,
} from "../../../db/schema";
import { docBodyKey } from "../../doc/handlers";
import { folderReadmeKeys, resolveFolderReadme } from "../../folder/handlers";
import { busabaseAssetTexts } from "../schema/asset-texts";
import type { StorageCleanupKind } from "../schema/storage-cleanup-jobs";
import { extractAssetContentIds } from "../utils/asset-content-url";
import { enqueueStorageCleanup, withStorageKeyLocks } from "./storage-cleanup-logic";

/**
 * One bind parameter for any number of ids. A plain `inArray` binds one per id
 * and fails past Postgres' 65,534 limit — one space holds 142,924 Assets.
 */
const anyText = (column: AnyColumn, values: readonly string[]): SQL =>
  sql`${column} = any(${sql.param([...values])}::text[])`;

/** Record heads read per query while scanning for references. */
const RECORD_HEAD_PAGE = 1_000;
/** Retained Doc and folder bodies read from storage at once. */
const BODY_READ_CONCURRENCY = 8;
/**
 * Up to this many candidate ids and keys, Postgres skips record heads that
 * mention none of them. Past it, every head is read and checked here.
 */
const PREFILTER_TOKEN_LIMIT = 200;
/**
 * Up to this much subtree text (UTF-16 units, distinct strings summed),
 * Postgres finds the owned attachments it names, so the space's attachments
 * stay in the database. Past it, they are loaded and matched here. Postgres
 * pays one `strpos` over the text per owned attachment: with 143,000 of them
 * that measured 0.16 s at 1 KB, 0.24 s at 8 KB and 0.48 s at 32 KB, against
 * 0.43 s to load them all with no network at all and 1.5 s over a 1 ms,
 * 100 Mbit/s link. Up to here it is never much slower, and usually far faster.
 */
export const MATCH_IN_DB_TEXT_LIMIT = 32 * 1024;

export interface AttachmentRef {
  id: string;
  storageKey: string;
}

interface References {
  assets: Set<string>;
  attachments: Set<string>;
}

interface BodyNode {
  id: string;
  type: string;
}

/**
 * Which attachments a string references: it equals the attachment id, or it
 * contains the attachment's storage key. Same rule as `includes` against every
 * attachment, indexed by each key's last characters so the cost grows with the
 * string, not with the number of attachments in the space.
 */
export const createAttachmentMatcher = (rows: readonly AttachmentRef[]) => {
  const byId = new Map(rows.map((row) => [row.id, row]));
  const matchesEverything = rows.filter((row) => row.storageKey === "");
  let window = 16;
  for (const row of rows) {
    if (row.storageKey) window = Math.min(window, row.storageKey.length);
  }
  const bySuffix = new Map<string, AttachmentRef[]>();
  for (const row of rows) {
    if (!row.storageKey) continue;
    const suffix = row.storageKey.slice(-window);
    const bucket = bySuffix.get(suffix);
    if (bucket) bucket.push(row);
    else bySuffix.set(suffix, [row]);
  }
  return (body: string): AttachmentRef[] => {
    const hits = new Set<AttachmentRef>(matchesEverything);
    const direct = byId.get(body);
    if (direct) hits.add(direct);
    for (let end = window; bySuffix.size && end <= body.length; end++) {
      const bucket = bySuffix.get(body.slice(end - window, end));
      if (!bucket) continue;
      for (const row of bucket) {
        const start = end - row.storageKey.length;
        if (start >= 0 && body.startsWith(row.storageKey, start)) hits.add(row);
      }
    }
    return [...hits];
  };
};

/**
 * Every id the inspector below could ask `isAsset` about, as if it descended
 * into every value: explicit `assetId`/`id` strings and Asset content URL ids.
 * Ownership looked up for exactly these answers every question it asks.
 */
const collectAssetIdProbes = (value: unknown, into: Set<string>): void => {
  if (typeof value === "string") {
    for (const assetId of extractAssetContentIds(value)) into.add(assetId);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectAssetIdProbes(item, into);
    return;
  }
  if (!value || typeof value !== "object") return;
  const ref = value as Record<string, unknown>;
  if (typeof ref.assetId === "string") into.add(ref.assetId);
  if (typeof ref.id === "string") into.add(ref.id);
  for (const child of Object.values(ref)) collectAssetIdProbes(child, into);
};

/** Which of `ids` are Assets of the space, each → its attachment id. */
const loadOwnedAssets = async (
  db: BusabaseDatabase,
  spaceId: string,
  ids: readonly string[],
): Promise<Map<string, string>> => {
  if (!ids.length) return new Map();
  const rows = await db
    .select({ id: busabaseAssets.id, attachmentId: busabaseAssets.attachmentId })
    .from(busabaseAssets)
    .where(and(eq(busabaseAssets.spaceId, spaceId), anyText(busabaseAssets.id, ids)));
  return new Map(rows.map((row) => [row.id, row.attachmentId]));
};

/** The attachment ids behind the space's Assets. */
const spaceAssetAttachmentIds = (db: BusabaseDatabase, spaceId: string) =>
  db
    .select({ id: busabaseAssets.attachmentId })
    .from(busabaseAssets)
    .where(eq(busabaseAssets.spaceId, spaceId));

/**
 * The owned attachments any of `texts` references, by the rule of
 * `createAttachmentMatcher`. For a little text Postgres answers, so the
 * space's attachments never leave the database: `strpos(text, key) > 0` is
 * `text.includes(key)`, an empty key included. One `strpos` per attachment
 * over the texts joined by line breaks finds every key some text contains; a
 * key without a line break cannot straddle two texts, and the rare key with
 * one is rechecked against each text here. Past the limit, or for text
 * Postgres cannot hold (NUL), every owned attachment is loaded and matched
 * here.
 */
export const findReferencedAttachments = async (
  db: BusabaseDatabase,
  spaceId: string,
  texts: readonly string[],
): Promise<AttachmentRef[]> => {
  if (!texts.length) return [];
  let size = 0;
  for (const text of texts) size += text.length;
  const columns = { id: attachments.id, storageKey: attachments.storageKey };
  if (size > MATCH_IN_DB_TEXT_LIMIT || texts.some((text) => text.includes("\u0000"))) {
    const rows = await db
      .select(columns)
      .from(attachments)
      .where(
        or(
          eq(attachments.spaceId, spaceId),
          inArray(attachments.id, spaceAssetAttachmentIds(db, spaceId)),
        ),
      );
    const match = createAttachmentMatcher(rows);
    const hits = new Map<string, AttachmentRef>();
    for (const text of texts) for (const row of match(text)) hits.set(row.id, row);
    return [...hits.values()];
  }
  const joined = texts.join("\n");
  const isNamed = (id: AnyColumn, key: AnyColumn): SQL =>
    sql`(${id} = any(${sql.param([...texts])}::text[]) or strpos(${joined}::text, ${key}) > 0)`;
  // An attachment the space owns is registered to it or behind one of its
  // Assets. As two disjoint halves no row probes the space's Assets: those
  // registered to it (its index), and the rest behind its Assets. The limit
  // fences the second half, so Postgres does not test the text against every
  // other space's rows before knowing which are the space's.
  const elsewhere = db
    .select(columns)
    .from(attachments)
    .where(
      and(
        or(isNull(attachments.spaceId), ne(attachments.spaceId, spaceId)),
        inArray(attachments.id, spaceAssetAttachmentIds(db, spaceId)),
      ),
    )
    .limit(Number.MAX_SAFE_INTEGER)
    .as("elsewhere");
  const rows = await db
    .select(columns)
    .from(attachments)
    .where(and(eq(attachments.spaceId, spaceId), isNamed(attachments.id, attachments.storageKey)))
    .unionAll(
      db
        .select({ id: elsewhere.id, storageKey: elsewhere.storageKey })
        .from(elsewhere)
        .where(isNamed(elsewhere.id, elsewhere.storageKey)),
    );
  const ids = new Set(texts);
  return rows.filter(
    (row) =>
      ids.has(row.id) ||
      !row.storageKey.includes("\n") ||
      texts.some((text) => text.includes(row.storageKey)),
  );
};

/**
 * Collects the Assets and attachments a body or a record's fields reference.
 * `isAsset` says whether an id is an Asset the space owns: it decides whether
 * an explicit id is a logical reference. `keep` limits what is recorded.
 */
const createReferenceInspector = (options: {
  isAsset: (assetId: string) => boolean;
  matchAttachments: (body: string) => AttachmentRef[];
  keep?: (kind: "asset" | "attachment", id: string) => boolean;
}) => {
  const keep = options.keep ?? (() => true);
  const inspectBody = (body: string, into: References) => {
    for (const assetId of extractAssetContentIds(body)) {
      if (options.isAsset(assetId) && keep("asset", assetId)) into.assets.add(assetId);
    }
    for (const attachment of options.matchAttachments(body)) {
      if (keep("attachment", attachment.id)) into.attachments.add(attachment.id);
    }
  };
  const inspectFields = (value: unknown, into: References): void => {
    if (typeof value === "string") {
      inspectBody(value, into);
      return;
    }
    if (Array.isArray(value)) {
      for (const item of value) inspectFields(item, into);
      return;
    }
    if (!value || typeof value !== "object") return;
    const ref = value as Record<string, unknown>;
    const explicitId =
      typeof ref.assetId === "string"
        ? ref.assetId
        : typeof ref.id === "string" && options.isAsset(ref.id)
          ? ref.id
          : null;
    if (explicitId && options.isAsset(explicitId)) {
      // A rich attachment cell often includes assetId, attachmentId AND URL.
      // The explicit logical identity owns that reference. Treating its copied
      // physical identity as ownership of every alias leaks retired handles.
      if (keep("asset", explicitId)) into.assets.add(explicitId);
      return;
    }
    for (const child of Object.values(ref)) inspectFields(child, into);
  };
  return { inspectBody, inspectFields };
};

const forEachConcurrently = async <T>(
  items: readonly T[],
  limit: number,
  run: (item: T) => Promise<void>,
): Promise<void> => {
  let next = 0;
  let failed = false;
  const worker = async () => {
    while (!failed && next < items.length) {
      const item = items[next++] as T;
      try {
        await run(item);
      } catch (error) {
        failed = true;
        throw error;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
};

/**
 * The retained body of a Doc or a folder readme. Reads are allowed here; all
 * external DELETEs are durably queued. An unreadable retained Doc must not be
 * mistaken for an empty document.
 */
const readRetainedBody = async (
  db: BusabaseDatabase,
  node: BodyNode,
): Promise<string | undefined> => {
  const isFolder = node.type === "folder";
  try {
    // A folder's readme is whichever of `readme.md` / `readme.html` is live.
    const key = isFolder ? (await resolveFolderReadme(node.id)).key : docBodyKey(node.id);
    const head = await storage.getObjectMetadata(key);
    if (!head) {
      // A missing live copy does not prove a legacy Doc is empty: the last
      // merged body is also stored in history and may still be recoverable.
      // For a folder, a missing object is simply an empty readme — most
      // folders never had one.
      const [snapshot] = await db
        .select({ payload: busabaseCommits.payload })
        .from(busabaseCommits)
        .leftJoin(busabaseOperations, eq(busabaseOperations.headCommitId, busabaseCommits.id))
        .where(
          and(
            eq(busabaseCommits.nodeId, node.id),
            inArray(
              busabaseCommits.operation,
              isFolder ? ["folder_update", "node_create"] : ["doc_update", "node_create"],
            ),
            or(eq(busabaseOperations.status, "merged"), isNull(busabaseCommits.operationId)),
          ),
        )
        .orderBy(desc(busabaseCommits.createdAt))
        .limit(1);
      return typeof snapshot?.payload.body === "string" ? snapshot.payload.body : undefined;
    }
    return (await storage.getObject(key)).toString("utf8");
  } catch {
    throw new ORPCError("SERVICE_UNAVAILABLE", {
      message: "Unable to verify retained document attachments. Retry permanent deletion later.",
    });
  }
};

/** Retained Docs and folders, read concurrently, each body handed to `inspect`. */
const inspectRetainedBodies = (
  db: BusabaseDatabase,
  nodes: readonly BodyNode[],
  inspect: (body: string) => void,
) =>
  forEachConcurrently(nodes, BODY_READ_CONCURRENCY, async (node) => {
    const body = await readRetainedBody(db, node);
    if (body !== undefined) inspect(body);
  });

/**
 * Every live record head matching `where`, one page at a time. Head snapshots
 * are the durable truth even when an old archive removed its where-used rows.
 */
const forEachRecordHeadPage = async (
  db: BusabaseDatabase,
  where: SQL | undefined,
  visit: (payloads: Record<string, unknown>[]) => void | Promise<void>,
): Promise<void> => {
  let after: string | undefined;
  for (;;) {
    const page = await db
      .select({ id: busabaseRecords.id, payload: busabaseCommits.payload })
      .from(busabaseRecords)
      .innerJoin(busabaseBases, eq(busabaseBases.id, busabaseRecords.baseId))
      .innerJoin(busabaseNodes, eq(busabaseNodes.id, busabaseBases.nodeId))
      .innerJoin(busabaseCommits, eq(busabaseCommits.id, busabaseRecords.headCommitId))
      .where(
        and(
          isNull(busabaseNodes.deletedAt),
          where,
          after === undefined ? undefined : gt(busabaseRecords.id, after),
        ),
      )
      .orderBy(asc(busabaseRecords.id))
      .limit(RECORD_HEAD_PAGE);
    await visit(page.map((row) => row.payload));
    if (page.length < RECORD_HEAD_PAGE) return;
    after = page[page.length - 1]?.id;
  }
};

const recordFields = (payload: Record<string, unknown>): unknown => payload.fields ?? payload;

/** How a token appears inside `payload::text`: jsonb escapes strings like JSON does. */
const jsonTextForm = (value: string): string => JSON.stringify(value).slice(1, -1);

interface PurgePlan {
  /** Owned Assets the purged subtree references. */
  candidateAssets: Set<string>;
  /** Attachments the purged subtree references, plus those of the candidate Assets. */
  candidateAttachments: Map<string, AttachmentRef>;
  /** Attachments the purged subtree references directly (legacy URLs and keys). */
  referencedAttachments: Set<string>;
  /** Retained Docs and folders in the purged subtree. */
  bodyNodes: BodyNode[];
  /** Storage keys whose fences this purge must hold. */
  lockKeys: string[];
}

/**
 * Everything the purged subtree references, found without locks: where-used
 * rows, record heads and Doc/folder bodies inside the subtree only. Nothing
 * else in the space is read here: Asset ownership is looked up only for ids
 * the subtree names, and legacy attachment references are matched in
 * Postgres. Only these files' fences are taken.
 */
const planPurge = async (
  db: BusabaseDatabase,
  spaceId: string,
  subtreeIds: string[],
): Promise<PurgePlan> => {
  const bodyNodes = await db
    .select({ id: busabaseNodes.id, type: busabaseNodes.type })
    .from(busabaseNodes)
    .where(
      and(
        eq(busabaseNodes.spaceId, spaceId),
        anyText(busabaseNodes.id, subtreeIds),
        inArray(busabaseNodes.type, ["doc", "folder"]),
        isNull(busabaseNodes.deletedAt),
      ),
    );

  const referenced: References = { assets: new Set(), attachments: new Set() };
  const usages = await db
    .select({ assetId: busabaseAssetUsages.assetId })
    .from(busabaseAssetUsages)
    .where(
      and(
        eq(busabaseAssetUsages.spaceId, spaceId),
        anyText(busabaseAssetUsages.nodeId, subtreeIds),
      ),
    );
  for (const usage of usages) referenced.assets.add(usage.assetId);

  const fields: unknown[] = [];
  await forEachRecordHeadPage(
    db,
    and(eq(busabaseRecords.spaceId, spaceId), anyText(busabaseBases.nodeId, subtreeIds)),
    (payloads) => {
      for (const payload of payloads) fields.push(recordFields(payload));
    },
  );
  const bodies: string[] = [];
  await inspectRetainedBodies(db, bodyNodes, (body) => {
    if (body) bodies.push(body);
  });

  const probes = new Set(referenced.assets);
  for (const value of fields) collectAssetIdProbes(value, probes);
  for (const body of bodies) collectAssetIdProbes(body, probes);
  const ownedAssets = await loadOwnedAssets(db, spaceId, [...probes]);

  // Legacy references name an attachment by id or storage key. The strings
  // inspection checks for them are collected first and matched in one go.
  const texts = new Set<string>();
  const inspector = createReferenceInspector({
    isAsset: (assetId) => ownedAssets.has(assetId),
    matchAttachments: (text) => {
      texts.add(text);
      return [];
    },
  });
  for (const value of fields) inspector.inspectFields(value, referenced);
  for (const body of bodies) inspector.inspectBody(body, referenced);
  const referencedRows = await findReferencedAttachments(db, spaceId, [...texts]);

  const candidateAssets = new Set([...referenced.assets].filter((id) => ownedAssets.has(id)));
  const candidateAttachments = new Map(referencedRows.map((row) => [row.id, row]));
  const assetAttachmentIds = [...candidateAssets].flatMap((id) => ownedAssets.get(id) ?? []);
  if (assetAttachmentIds.length) {
    const rows = await db
      .select({ id: attachments.id, storageKey: attachments.storageKey })
      .from(attachments)
      .where(anyText(attachments.id, assetAttachmentIds));
    for (const row of rows) candidateAttachments.set(row.id, row);
  }
  const textKeys = candidateAssets.size
    ? await db
        .select({ key: busabaseAssetTexts.textStorageKey })
        .from(busabaseAssetTexts)
        .where(anyText(busabaseAssetTexts.assetId, [...candidateAssets]))
    : [];

  return {
    candidateAssets,
    candidateAttachments,
    referencedAttachments: new Set(referencedRows.map((row) => row.id)),
    bodyNodes,
    lockKeys: [
      ...new Set([
        ...[...candidateAttachments.values()].map((row) => row.storageKey),
        ...textKeys.map((row) => row.key),
        ...bodyNodes.flatMap((node) =>
          node.type === "folder" ? folderReadmeKeys(node.id) : [docBodyKey(node.id)],
        ),
      ]),
    ],
  };
};

/**
 * Which candidates something outside the purged subtree still references:
 * where-used rows, live record heads, and retained Doc/folder bodies. Archived
 * content is deliberately included. Only references to candidates are looked
 * for, and only record heads that mention one are read when there are few.
 */
const findProtectedReferences = async (
  db: BusabaseDatabase,
  spaceId: string,
  subtreeIds: string[],
  plan: PurgePlan,
): Promise<References> => {
  const protectedRefs: References = { assets: new Set(), attachments: new Set() };
  const candidateAssetIds = [...plan.candidateAssets];
  const attachmentRows = [...plan.candidateAttachments.values()];
  if (!candidateAssetIds.length && !attachmentRows.length) return protectedRefs;

  if (candidateAssetIds.length) {
    const usages = await db
      .select({ assetId: busabaseAssetUsages.assetId })
      .from(busabaseAssetUsages)
      .where(
        and(
          eq(busabaseAssetUsages.spaceId, spaceId),
          anyText(busabaseAssetUsages.assetId, candidateAssetIds),
          not(anyText(busabaseAssetUsages.nodeId, subtreeIds)),
        ),
      );
    for (const usage of usages) protectedRefs.assets.add(usage.assetId);
  }

  // An explicit id that is an owned Asset owns its cell, so ownership must be
  // exact for every id met here. Candidates were owned when planned; any other
  // id is looked up when a page of record heads names it. In a body only
  // candidates matter, so bodies need no lookup.
  const ownedOthers = new Set<string>();
  const probed = new Set<string>(candidateAssetIds);
  const inspector = createReferenceInspector({
    isAsset: (assetId) => plan.candidateAssets.has(assetId) || ownedOthers.has(assetId),
    matchAttachments: createAttachmentMatcher(attachmentRows),
    keep: (kind, id) =>
      kind === "asset" ? plan.candidateAssets.has(id) : plan.candidateAttachments.has(id),
  });

  const tokens = [
    ...candidateAssetIds,
    ...attachmentRows.flatMap((row) => [row.id, row.storageKey]),
  ].map(jsonTextForm);
  const mentionsCandidate =
    tokens.length <= PREFILTER_TOKEN_LIMIT
      ? sql`exists (select 1 from unnest(${sql.param(tokens)}::text[]) as needle(value) where strpos(${busabaseCommits.payload}::text, needle.value) > 0)`
      : undefined;
  await forEachRecordHeadPage(
    db,
    and(
      eq(busabaseRecords.spaceId, spaceId),
      not(anyText(busabaseBases.nodeId, subtreeIds)),
      mentionsCandidate,
    ),
    async (payloads) => {
      const probes = new Set<string>();
      for (const payload of payloads) collectAssetIdProbes(recordFields(payload), probes);
      const unknown = [...probes].filter((id) => !probed.has(id));
      for (const id of unknown) probed.add(id);
      for (const id of (await loadOwnedAssets(db, spaceId, unknown)).keys()) ownedOthers.add(id);
      for (const payload of payloads) inspector.inspectFields(recordFields(payload), protectedRefs);
    },
  );

  const retained = await db
    .select({ id: busabaseNodes.id, type: busabaseNodes.type })
    .from(busabaseNodes)
    .where(
      and(
        eq(busabaseNodes.spaceId, spaceId),
        inArray(busabaseNodes.type, ["doc", "folder"]),
        isNull(busabaseNodes.deletedAt),
        not(anyText(busabaseNodes.id, subtreeIds)),
      ),
    );
  await inspectRetainedBodies(db, retained, (body) => inspector.inspectBody(body, protectedRefs));
  return protectedRefs;
};

/**
 * Permanent deletion owns only assets evidenced by its subtree. It never sweeps
 * unrelated, unmounted library uploads. Canonical record heads and Doc bodies
 * supplement the reverse index for legacy records/URLs that predate that index.
 * Archived content is deliberately included in both protection scans.
 *
 * Cost follows the purged subtree, not the space: only the subtree's content
 * is read to find candidates, only the candidates' fences are taken, and the
 * rest of the space is read only when there is a candidate to protect.
 */
export const releasePurgedNodeAssets = async (
  db: BusabaseDatabase,
  subtreeIds: string[],
): Promise<void> => {
  const spaceId = getContextSpaceId();
  // Discover without row locks, then take the physical fences in the same
  // lexical order as uploads and derived-text writes. Taking Asset row locks
  // first would deadlock a writer holding a fence while inserting its FK.
  const plan = await planPurge(db, spaceId, subtreeIds);
  const lockedKeys = new Set(plan.lockKeys);
  return withStorageKeyLocks(db, [...lockedKeys], (tx) =>
    releaseWithinFences(tx, spaceId, subtreeIds, plan, lockedKeys),
  );
};

const releaseWithinFences = async (
  db: BusabaseDatabase,
  spaceId: string,
  subtreeIds: string[],
  plan: PurgePlan,
  lockedKeys: ReadonlySet<string>,
): Promise<void> => {
  const candidateAssetIds = [...plan.candidateAssets];
  const lockedAssets = candidateAssetIds.length
    ? await db
        .select()
        .from(busabaseAssets)
        .where(
          and(eq(busabaseAssets.spaceId, spaceId), anyText(busabaseAssets.id, candidateAssetIds)),
        )
        .orderBy(busabaseAssets.id)
        .for("update")
    : [];
  // A candidate re-pointed at other bytes since discovery would be released
  // without its fence held.
  const lockedAttachmentIds = [...new Set(lockedAssets.map((asset) => asset.attachmentId))];
  const lockedAttachments = lockedAttachmentIds.length
    ? await db
        .select({ id: attachments.id, storageKey: attachments.storageKey })
        .from(attachments)
        .where(anyText(attachments.id, lockedAttachmentIds))
    : [];
  if (lockedAttachments.some((row) => !lockedKeys.has(row.storageKey))) {
    throw new ORPCError("CONFLICT", {
      message: "Files changed while preparing permanent deletion. Retry the operation.",
    });
  }

  const protectedRefs = await findProtectedReferences(db, spaceId, subtreeIds, plan);

  await db
    .delete(busabaseAssetUsages)
    .where(
      and(
        eq(busabaseAssetUsages.spaceId, spaceId),
        anyText(busabaseAssetUsages.nodeId, subtreeIds),
      ),
    );
  const removableAssets = lockedAssets.filter(
    (asset) => !asset.retainInLibrary && !protectedRefs.assets.has(asset.id),
  );
  // Recheck globally: ids are tenant-unique, but malformed legacy cross-space
  // usage rows must still protect their bytes rather than cascade silently.
  const stillUsed = removableAssets.length
    ? await db
        .selectDistinct({ assetId: busabaseAssetUsages.assetId })
        .from(busabaseAssetUsages)
        .where(
          anyText(
            busabaseAssetUsages.assetId,
            removableAssets.map((asset) => asset.id),
          ),
        )
    : [];
  const stillUsedIds = new Set(stillUsed.map((row) => row.assetId));
  const removed = removableAssets.filter((asset) => !stillUsedIds.has(asset.id));
  const removableIds = removed.map((asset) => asset.id);

  const derived = removableIds.length
    ? await db
        .select()
        .from(busabaseAssetTexts)
        .where(anyText(busabaseAssetTexts.assetId, removableIds))
    : [];
  if (derived.some((row) => !lockedKeys.has(row.textStorageKey))) {
    throw new ORPCError("CONFLICT", {
      message: "File text changed while preparing permanent deletion. Retry the operation.",
    });
  }
  const releasedAttachments = new Set(plan.referencedAttachments);
  for (const asset of removed) releasedAttachments.add(asset.attachmentId);
  if (removableIds.length)
    await db.delete(busabaseAssets).where(anyText(busabaseAssets.id, removableIds));

  const cleanup = new Map<
    string,
    {
      storageKey: string;
      sizeBytes: number;
      kind: StorageCleanupKind;
      spaceId: string;
    }
  >();
  const ownTexts = derived.filter((text) => text.writtenBy !== "auto");
  const textStillShared = ownTexts.length
    ? await db
        .selectDistinct({ key: busabaseAssetTexts.textStorageKey })
        .from(busabaseAssetTexts)
        .where(
          anyText(
            busabaseAssetTexts.textStorageKey,
            ownTexts.map((text) => text.textStorageKey),
          ),
        )
    : [];
  const sharedTextKeys = new Set(textStillShared.map((row) => row.key));
  for (const text of ownTexts) {
    if (!sharedTextKeys.has(text.textStorageKey))
      cleanup.set(text.textStorageKey, {
        storageKey: text.textStorageKey,
        sizeBytes: text.byteCount,
        kind: "derived_text",
        spaceId,
      });
  }

  // Group by physical identity and acquire fences in a stable order. A new
  // Asset adoption shares this fence and is rechecked before registry removal.
  const keyById = new Map<string, string>();
  for (const row of [...plan.candidateAttachments.values(), ...lockedAttachments]) {
    keyById.set(row.id, row.storageKey);
  }
  const keys = [
    ...new Set(
      [...releasedAttachments]
        .filter((id) => !protectedRefs.attachments.has(id))
        .flatMap((id) => keyById.get(id) ?? []),
    ),
  ].sort();
  for (const key of keys) {
    await withStorageKeyLocks(db, [key], async (tx) => {
      const rows = await tx
        .select()
        .from(attachments)
        .where(eq(attachments.storageKey, key))
        .for("update");
      const removeIds: string[] = [];
      for (const attachment of rows) {
        if (!releasedAttachments.has(attachment.id) || protectedRefs.attachments.has(attachment.id))
          continue;
        const remainingAssets = await tx
          .select({ spaceId: busabaseAssets.spaceId })
          .from(busabaseAssets)
          .where(eq(busabaseAssets.attachmentId, attachment.id));
        if (remainingAssets.some((asset) => asset.spaceId === spaceId)) continue;
        if (attachment.spaceId !== null && attachment.spaceId !== spaceId) continue;
        if (remainingAssets.length) {
          // The physical object remains available to another space. Its Assets
          // retain their own billable ownership; the purged space relinquishes it.
          if (attachment.spaceId === spaceId)
            await tx
              .update(attachments)
              .set({ spaceId: null })
              .where(eq(attachments.id, attachment.id));
        } else removeIds.push(attachment.id);
      }
      if (removeIds.length && rows.every((row) => removeIds.includes(row.id))) {
        await enqueueStorageCleanup(tx, {
          storageKey: key,
          sizeBytes: Math.max(...rows.map((row) => row.sizeBytes)),
          kind: "attachment",
          spaceId,
        });
      }
      if (removeIds.length) await tx.delete(attachments).where(inArray(attachments.id, removeIds));
    });
  }
  for (const node of plan.bodyNodes) {
    // Both readme objects for a folder: which one is live is not recorded
    // anywhere, and deleting the absent one is a no-op.
    const storageKeys = node.type === "folder" ? folderReadmeKeys(node.id) : [docBodyKey(node.id)];
    for (const storageKey of storageKeys) {
      cleanup.set(storageKey, {
        storageKey,
        sizeBytes: 0,
        kind: node.type === "folder" ? "folder" : "doc",
        spaceId,
      });
    }
  }
  for (const job of [...cleanup.values()].sort((a, b) =>
    a.storageKey.localeCompare(b.storageKey),
  )) {
    await enqueueStorageCleanup(db, job);
  }
};
