/**
 * Raw attachment uploads that are NOT part of the Asset library.
 *
 * The Drive "Assets" library is a curated, user-visible list: every asset row
 * carries a where-used count, shows an "unused" badge at zero, and can be
 * deleted from the UI. Chrome images such as the sidebar logo have none of
 * those properties — they are referenced by a settings row, not by an asset
 * usage — so routing them through `confirmAssetUpload` would list them as
 * permanently "unused" and let a routine library cleanup silently delete the
 * bytes the sidebar renders.
 *
 * So they are stored as plain `attachments` rows instead, the same way
 * Busabase Cloud stores a space logo. This module reuses the shared
 * `open-domains/attachments` upload logic (size policy, key minting, registry
 * insert) — it adds only the server-side branding policy on top.
 */

import "server-only";

import { ORPCError } from "@orpc/server";
import type {
  NodeIconConfirmInput,
  NodeIconUploadUrlInput,
} from "busabase-contract/contract/node-icon-upload-schemas";
import { and, eq } from "drizzle-orm";
import {
  confirmUpload,
  deleteAttachmentSafely,
  requestUploadUrl,
} from "open-domains/attachments/logic";
import { attachments } from "open-domains/attachments/schema";
import type { ConfirmUploadVO, RequestUploadUrlVO } from "open-domains/attachments/types";
import { storage } from "openlib/storage";
import type { BusabaseDatabase } from "../../../context";
import { hashBuffer } from "../../../logic/kernel";

/** `attachments.context` for images that brand the app chrome. */
export const BRANDING_ATTACHMENT_CONTEXT = "branding";

/** `attachments.metadata.type`, mirroring cloud's `"space-logo"` convention. */
export const APP_BRANDING_LOGO_TYPE = "app-branding-logo";

/**
 * A sidebar logo renders at ~24px and is loaded on every page, so it is capped
 * far below the 25MB attachment ceiling. The Settings tab refuses oversized
 * files up front for a fast, friendly message; this is the boundary that
 * actually enforces it.
 */
export const BRANDING_LOGO_MAX_BYTES = 2 * 1024 * 1024;

/**
 * Accepted logo types, mapped to the extension the stored object gets.
 *
 * Deliberately an allowlist rather than a `image/*` prefix test: the download
 * route (`/api/storage/[...key]` on self-hosted Busabase) infers `Content-Type`
 * from the key's
 * extension, so a type it cannot map would be served as
 * `application/octet-stream` and render as a broken image. These five are
 * exactly the image types that route knows.
 */
export const BRANDING_LOGO_EXTENSION_BY_MIME_TYPE: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/svg+xml": "svg",
};

export const BRANDING_LOGO_MIME_TYPES = Object.keys(BRANDING_LOGO_EXTENSION_BY_MIME_TYPE);

/**
 * Owner id written on branding attachment rows — deliberately NOT the plain
 * `"local"` sentinel every other upload in this single-tenant app uses.
 *
 * This id IS the dedup scope. `findByContentHash` scopes by `spaceId` when the
 * upload has one and falls back to `eq(userId, …)` when it doesn't; branding
 * rows are deliberately space-less (see `uploadBrandingLogo`), so `userId` is
 * what decides which rows a branding upload may dedup onto. Asset and file-tree
 * uploads write under `resolveActorId("local")` → `"local"`, so sharing that id
 * would let a logo resolve to an ASSET's attachment row — and deleting that
 * asset (`domains/assets/handlers.ts` → `deleteAttachmentSafely`) would then
 * take the logo's bytes with it. A dedicated owner id makes the two scopes
 * disjoint, so branding dedup can only ever match another branding row.
 *
 * Named with the `local-` prefix the other instance-owned pseudo-actors in
 * `busabase-core/context` use (`LOCAL_SPACE_ID = "local"`, `"local-admin"`,
 * `"local-user"`), so it reads as "the instance itself", not a real user id.
 */
export const BRANDING_USER_ID = "local-branding";

export interface UploadBrandingLogoInput {
  /** The raw file bytes (already read from the request). */
  bytes: Uint8Array;
  /** The user's file name — kept for the registry row, never for the key. */
  fileName: string;
  /** Declared MIME type; must be one of {@link BRANDING_LOGO_MIME_TYPES}. */
  mimeType: string;
}

export interface UploadBrandingLogoResult {
  attachmentId: string;
  storageKey: string;
  /** What goes into `app_branding.logo_url`. */
  publicUrl: string;
}

/**
 * Store a branding logo as a standalone attachment and return its public URL.
 *
 * Throws `ORPCError("BAD_REQUEST")` for a rejected type or size, so callers can
 * map that to a 400 with the message shown to the user.
 */
export const uploadBrandingLogo = async (
  db: BusabaseDatabase,
  input: UploadBrandingLogoInput,
): Promise<UploadBrandingLogoResult> => {
  const extension = BRANDING_LOGO_EXTENSION_BY_MIME_TYPE[input.mimeType];
  if (!extension) {
    throw new ORPCError("BAD_REQUEST", {
      message: `A logo must be one of: ${BRANDING_LOGO_MIME_TYPES.join(", ")}.`,
    });
  }

  const sizeBytes = input.bytes.byteLength;
  if (sizeBytes === 0) {
    throw new ORPCError("BAD_REQUEST", { message: "The uploaded file is empty." });
  }

  // The key is minted from THIS name, not the user's: `extractFileExtension`
  // takes whatever follows the last dot, so a crafted name could otherwise push
  // a slash into the storage key. The user's name is kept on the row below.
  const keyFileName = `logo.${extension}`;

  // The bytes are already in hand, so hash them here rather than trusting a
  // client-declared fingerprint. Passing a `contentHash` opts INTO content-hash
  // dedup: re-picking the same image is then a no-op (one row, one object)
  // instead of a fresh leak. It is only safe because branding rows live in their
  // own dedup scope — see `BRANDING_USER_ID`.
  const contentHash = hashBuffer(Buffer.from(input.bytes));

  // Reuse the shared request step for the size/MIME policy and key minting.
  const requested = await requestUploadUrl(
    {
      fileName: keyFileName,
      mimeType: input.mimeType,
      sizeBytes,
      contentHash,
      context: BRANDING_ATTACHMENT_CONTEXT,
      // No spaceId → the row is written with `spaceId: null`. Required: asset
      // uploads always pass a space, and same-space scoping is what makes an
      // asset's dedup lookup unable to select this row (and therefore unable to
      // delete its bytes when that asset is removed).
    },
    BRANDING_USER_ID,
    db,
    attachments,
    { maxFileSize: BRANDING_LOGO_MAX_BYTES, allowedMimeTypes: BRANDING_LOGO_MIME_TYPES },
  );

  // Dedup hit: the identical logo is already stored and registered, so there is
  // nothing to write and no second row to create — reuse the existing one.
  if (requested.duplicate && requested.attachmentId) {
    return {
      attachmentId: requested.attachmentId,
      storageKey: requested.storageKey,
      publicUrl: requested.publicUrl,
    };
  }

  // We already hold the bytes server-side, so write them straight through the
  // storage adapter instead of round-tripping the presigned/relay URL.
  await storage.uploadFileToKey(Buffer.from(input.bytes), requested.storageKey, input.mimeType);

  const confirmed = await confirmUpload(
    {
      storageKey: requested.storageKey,
      fileName: input.fileName || keyFileName,
      mimeType: input.mimeType,
      sizeBytes,
      contentHash,
      context: BRANDING_ATTACHMENT_CONTEXT,
      metadata: { type: APP_BRANDING_LOGO_TYPE },
    },
    BRANDING_USER_ID,
    db,
    attachments,
  );

  return {
    attachmentId: confirmed.attachmentId,
    storageKey: confirmed.storageKey,
    publicUrl: confirmed.publicUrl,
  };
};

export interface DeleteBrandingLogoResult {
  /** Registry rows removed (0 when the URL isn't one of ours). */
  deletedRows: number;
  /** Stored objects removed — fewer than `deletedRows` if bytes are still shared. */
  deletedObjects: number;
}

/**
 * Drop the attachment behind a branding logo URL that is no longer referenced.
 *
 * Nothing in this repo garbage-collects orphaned attachments, so without this
 * every logo replacement would leak one registry row plus one stored object,
 * forever. Called (best-effort) by the branding store after the outgoing
 * `logo_url` has been overwritten.
 *
 * Two safety properties, both load-bearing:
 *
 * 1. **Only rows we own.** The lookup is pinned to `context = "branding"` AND
 *    `userId = BRANDING_USER_ID`, the pair only `uploadBrandingLogo` ever
 *    writes. `context` alone would not be enough — it is caller-supplied on the
 *    asset upload endpoints, so an asset could carry `context: "branding"`.
 * 2. **Only URLs we minted.** Rather than parsing the URL back into a storage
 *    key — the public URL shape differs per adapter (`/uploads/<key>`, the dev
 *    local relay `/api/storage/<key>`, a CDN base in production) and a parser
 *    would have to know all of them — this compares FORWARDS against what the
 *    adapter itself would mint for each candidate row. An operator's externally
 *    hosted logo, or the built-in `/icon.svg`, is not the public URL of any
 *    branding row and therefore matches nothing and deletes nothing.
 *
 * Deletion goes through `deleteAttachmentSafely`, which refcounts by
 * `storageKey`: content-addressed keys can be shared by other rows (an asset
 * with byte-identical content mints the same key), and the physical object is
 * only removed once the last row referencing it is gone.
 */
export const deleteBrandingLogoByUrl = async (
  db: BusabaseDatabase,
  logoUrl: string,
): Promise<DeleteBrandingLogoResult> => {
  const url = logoUrl.trim();
  if (!url) return { deletedRows: 0, deletedObjects: 0 };

  const candidates = await db
    .select({ id: attachments.id, storageKey: attachments.storageKey })
    .from(attachments)
    .where(
      and(
        eq(attachments.context, BRANDING_ATTACHMENT_CONTEXT),
        eq(attachments.userId, BRANDING_USER_ID),
      ),
    );

  const owned = candidates.filter(
    (row: { storageKey: string }) => storage.getPublicUrl(row.storageKey) === url,
  );

  let deletedRows = 0;
  let deletedObjects = 0;
  for (const row of owned) {
    const result = await deleteAttachmentSafely(row.id, db, attachments);
    if (result.deletedRow) deletedRows += 1;
    if (result.deletedObject) deletedObjects += 1;
  }
  return { deletedRows, deletedObjects };
};

/**
 * Node-avatar (icon) uploads — a THIRD, separate attachment scope alongside
 * the Asset library and the branding logo above. Like a branding logo, a node
 * icon has no "where-used" concept and isn't a curated library entry, so it is
 * stored as a plain `attachments` row rather than going through
 * `confirmAssetUpload` (see the file-level doc comment).
 *
 * Unlike branding (one singleton logo, one shared dedup scope), a node icon is
 * a MULTI-instance reference — every node has its own — so the owner-id scope
 * is parameterized BY NODE (`nodeIconOwnerId(nodeId)`) rather than a single
 * shared constant:
 *
 * 1. It still must never collide with the Asset scope (`resolveActorId("local")`),
 *    for the same reason `BRANDING_USER_ID` exists — an icon dedup-matching an
 *    Asset's attachment row would let deleting that Asset take the icon's
 *    bytes with it (`deleteAttachmentSafely` is refcounted, but only correctly
 *    scoped if this scope is disjoint from Assets' in the first place).
 * 2. It ALSO must not collide across different nodes' icons: `requestUploadUrl`
 *    /`confirmUpload`'s dedup lookup ignores `userId` entirely once a
 *    `spaceId` is supplied (see `findByContentHash`), so passing a shared
 *    space-scoped owner id would dedupe two unrelated nodes' byte-identical
 *    icons onto the SAME row — and `deleteNodeIconByUrl` deleting one node's
 *    icon would then also break the other node's. Node icons are therefore
 *    uploaded space-less (`spaceId` omitted, mirroring branding), so dedup
 *    scope is `eq(userId, nodeIconOwnerId(nodeId))` alone — global across
 *    spaces for a GIVEN node, but never shared between two different nodes.
 */
export const NODE_ICON_ATTACHMENT_CONTEXT = "node-icon";
export const NODE_ICON_TYPE = "node-icon";

/** Same 2MB ceiling as a branding logo — a node icon renders at similarly small sizes. */
export const NODE_ICON_MAX_BYTES = BRANDING_LOGO_MAX_BYTES;
export const NODE_ICON_MIME_TYPES = BRANDING_LOGO_MIME_TYPES;

/** Disjoint per-node dedup/ownership scope — see the doc comment above. */
export const nodeIconOwnerId = (nodeId: string): string => `local-node-icon:${nodeId}`;

/**
 * Step 1 of the client-driven upload flow (the browser PUTs bytes directly to
 * the returned URL between this call and `confirmNodeIconUpload`) — unlike
 * `uploadBrandingLogo` above, which uploads server-side because its caller
 * (the branding API route) already holds the bytes in hand.
 */
export const requestNodeIconUploadUrl = async (
  db: BusabaseDatabase,
  input: NodeIconUploadUrlInput,
): Promise<RequestUploadUrlVO> => {
  if (!NODE_ICON_MIME_TYPES.includes(input.mimeType)) {
    throw new ORPCError("BAD_REQUEST", {
      message: `A node icon must be one of: ${NODE_ICON_MIME_TYPES.join(", ")}.`,
    });
  }
  const result = await requestUploadUrl(
    { ...input, spaceId: undefined, context: NODE_ICON_ATTACHMENT_CONTEXT },
    nodeIconOwnerId(input.nodeId),
    db,
    attachments,
    { maxFileSize: NODE_ICON_MAX_BYTES, allowedMimeTypes: NODE_ICON_MIME_TYPES },
  );
  return result;
};

/** Step 2 — registers the object the client already PUT to the presigned URL. */
export const confirmNodeIconUpload = async (
  db: BusabaseDatabase,
  input: NodeIconConfirmInput,
): Promise<ConfirmUploadVO> => {
  const result = await confirmUpload(
    {
      ...input,
      spaceId: undefined,
      context: NODE_ICON_ATTACHMENT_CONTEXT,
      metadata: { type: NODE_ICON_TYPE },
    },
    nodeIconOwnerId(input.nodeId),
    db,
    attachments,
  );
  return result;
};

/**
 * Drop an attachment behind a node icon URL that is no longer referenced —
 * called (best-effort) after a node's `icon` is replaced or cleared. Same
 * forwards-URL-matching + refcounted-delete shape as
 * `deleteBrandingLogoByUrl`, scoped to this one node's own owner id so it can
 * never reach another node's (or an Asset's) attachment row.
 */
export const deleteNodeIconByUrl = async (
  db: BusabaseDatabase,
  nodeId: string,
  iconUrl: string,
): Promise<DeleteBrandingLogoResult> => {
  const url = iconUrl.trim();
  if (!url) return { deletedRows: 0, deletedObjects: 0 };

  const candidates = await db
    .select({ id: attachments.id, storageKey: attachments.storageKey })
    .from(attachments)
    .where(
      and(
        eq(attachments.context, NODE_ICON_ATTACHMENT_CONTEXT),
        eq(attachments.userId, nodeIconOwnerId(nodeId)),
      ),
    );

  const owned = candidates.filter(
    (row: { storageKey: string }) => storage.getPublicUrl(row.storageKey) === url,
  );

  let deletedRows = 0;
  let deletedObjects = 0;
  for (const row of owned) {
    const result = await deleteAttachmentSafely(row.id, db, attachments);
    if (result.deletedRow) deletedRows += 1;
    if (result.deletedObject) deletedObjects += 1;
  }
  return { deletedRows, deletedObjects };
};
