/**
 * Per-operation Zod schemas for `busabase_commits.payload`.
 *
 * `payload` is a discriminated union stored as untyped jsonb, with the
 * discriminator sitting in the sibling `operation` enum column. Historically
 * nothing validated it: every merge handler simply did
 * `headCommit.payload as { … }`, so a malformed commit was only discovered at
 * merge time — far from wherever it was written.
 *
 * This module is the enforcement layer for that union. It is deliberately
 * **server-only** and lives in `busabase-core`, NOT in `busabase-contract`:
 *
 *  - the contract package is pulled into the browser bundle and drives the
 *    mobile client's generated types, and none of these shapes belong there;
 *  - more importantly, the client-facing `commitSchema.payload` VO must stay
 *    loose (`z.record(z.string(), z.unknown())`). History and approval-detail
 *    screens read commits that were written *before* this validation existed,
 *    whose shapes carry no guarantee. Tightening the VO would turn a legacy row
 *    into a 500 on a read-only page. See the comment on `commitSchema.payload`.
 *
 * So the asymmetry is intentional:
 *
 *   write  (`insertCommit`)        → STRICT   (nothing malformed enters the db)
 *   merge  (`parseCommitPayload`)  → STRICT   (only ever sees freshly-written,
 *                                              already-validated payloads — a
 *                                              merge acts on an `in_review` CR,
 *                                              it never re-merges old commits)
 *   read   (`CommitVO.payload`)    → LOOSE    (must survive arbitrary history)
 *
 * ── Why every object here is `z.looseObject` ────────────────────────────────
 * Unknown keys are **kept**, not stripped. Several payloads are genuinely
 * supersets of what their merge handler reads — `node_rename` stores the whole
 * `nodeOperationInputSchema` variant (including `kind` and `nodeId`) while
 * `mergeNodeRename` only reads `{ slug, name, description }`. A strict object
 * would reject those; a stripping object would silently delete data from an
 * append-only ledger. Loose objects validate the keys we know about and leave
 * everything else alone.
 *
 * ── Where each shape came from ──────────────────────────────────────────────
 * Shapes were read off the WRITE sites (what actually goes into the column),
 * and cross-checked against the READ sites (what the merge handlers assert).
 * Where the two disagreed, the write side won — see the per-kind notes.
 */
import { fieldTypeSchema } from "busabase-contract/domains/base/contract/base-schemas";
import { iStringSchema } from "openlib/i18n/i-string";
import { z } from "zod";
import type { busabaseOperationKindEnum } from "../db/schema";

/**
 * The closed set of operation kinds that can actually be stored, taken from the
 * database enum. NOT `OperationKind` from the contract: that type is widened
 * with template literals (`` `${string}_file_create` ``) by the node-type
 * registry, which cannot key a `Record<…>` and so would silently defeat the
 * exhaustiveness gate below.
 */
export type CommitOperationKind = (typeof busabaseOperationKindEnum.enumValues)[number];

/**
 * The three families the merge dispatcher routes by regex rather than by an
 * exact kind (`/^[a-z0-9-]+_file_(create|update|delete)$/` etc.). Their handlers
 * are generic across the family, so they parse against the family's key union —
 * every member maps to the same schema, so the inferred payload type collapses
 * to one shape instead of a 38-way union.
 */
export type FileTreeFileOperationKind = Extract<
  CommitOperationKind,
  `${string}_file_create` | `${string}_file_update` | `${string}_file_delete`
>;
export type FileTreeMetadataOperationKind = Extract<
  CommitOperationKind,
  `${string}_metadata_update`
>;
export type RichNodeDocumentOperationKind = Extract<
  CommitOperationKind,
  `${string}_document_update`
>;

// ── Shared leaves ────────────────────────────────────────────────────────────

/** Record field values: a slug → value map. Values are field-type dependent. */
const recordFieldValues = z.record(z.string(), z.unknown());

/** Field `options` blobs are validated by the contract at the input boundary. */
const fieldOptions = z.record(z.string(), z.unknown());

/** A view `config`; already validated by `viewConfigSchema` at input time. */
const viewConfig = z.record(z.string(), z.unknown());

/**
 * `base_add_field` / `base_update_field` / `base_delete_field` /
 * `base_restore_field` all persist the same field-definition snapshot; only the
 * required subset differs, which is enforced per kind below.
 */
const fieldDefinition = {
  fieldId: z.string().optional(),
  name: iStringSchema.optional(),
  slug: z.string().optional(),
  type: fieldTypeSchema.optional(),
  required: z.boolean().optional(),
  options: fieldOptions.optional(),
};

/** Structural node-tree operations write the raw contract input variant. */
const nodeCreatePayload = z.looseObject({
  // `kind: "create"` is present when written through `nodes.createChangeRequest`
  // (which stores the raw operation object) and through `createNodeChangeRequest`
  // in cr-lifecycle; `recordMergedNodeCreate` sets it too. Optional rather than
  // required because it is redundant with the `operation` column itself.
  kind: z.literal("create").optional(),
  ref: z.string().optional(),
  parentNodeId: z.string().optional(),
  parentNodeRef: z.string().optional(),
  nodeType: z.string(),
  slug: z.string(),
  name: z.string(),
  description: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  fields: z
    .array(
      z.looseObject({
        slug: z.string(),
        name: iStringSchema,
        type: fieldTypeSchema.optional(),
        required: z.boolean().optional(),
        options: fieldOptions.optional(),
      }),
    )
    .optional(),
  // Doc-only initial body carried through a pending review.
  body: z.string().optional(),
  // Drive/Skill/AirApp-only initial files carried through a pending review.
  initialFiles: z
    .array(
      z.looseObject({
        path: z.string(),
        content: z.string().optional(),
        assetId: z.string().optional(),
        displayName: z.string().optional(),
        mimeType: z.string().optional(),
      }),
    )
    .optional(),
  mergeMode: z.enum(["merge", "replace"]).optional(),
});

/**
 * File-tree file writes (`skill_/drive_/airapp_file_{create,update,delete}`).
 * `delete` writes the same object with `nextContent`/`encoding`/`mimeType` all
 * null, so one schema covers the family.
 *
 * Write side (`domains/filetree/handlers.ts`) never emits `nextContentBase64`
 * or `encoding: "base64"`, but the merge handler asserts both — kept optional
 * here so the reader's contract is representable, see notes below.
 */
const fileTreeFilePayload = z.looseObject({
  filePath: z.string().nullable().optional(),
  baseContentHash: z.string().nullable().optional(),
  nextContent: z.string().nullable().optional(),
  nextContentBase64: z.string().nullable().optional(),
  encoding: z.enum(["utf8", "asset", "base64"]).nullable().optional(),
  mimeType: z.string().nullable().optional(),
  assetId: z.string().nullable().optional(),
  displayName: z.string().nullable().optional(),
});

/** `*_metadata_update` for every file-tree node type. */
const fileTreeMetadataPayload = z.looseObject({
  metadata: z.record(z.string(), z.unknown()).optional(),
});

/** `*_document_update` for the rich-node types (whiteboard/workflow/html). */
const richNodeDocumentPayload = z.looseObject({
  // Shape is per-node-type and already validated by the content contract
  // (`parseWhiteboardDocument` / `parseWorkflowDocument` / `parseHtmlDocument`)
  // before the commit is written; re-validating it here would duplicate that
  // and couple this module to three document schemas.
  document: z.unknown(),
});

/** Base archive/restore snapshots. */
const baseIdentityPayload = z.looseObject({
  baseId: z.string(),
  slug: z.string(),
});

/** View snapshots. create/delete/restore carry `slug`; update does not. */
const viewSnapshot = {
  config: viewConfig.optional(),
  description: z.string().nullable().optional(),
  name: z.string().optional(),
  type: z.string().optional(),
};

// ── The registry ─────────────────────────────────────────────────────────────

/**
 * One schema per operation kind.
 *
 * `satisfies Record<CommitOperationKind, …>` is the exhaustiveness gate: adding
 * a value to `busabaseOperationKindEnum` without adding a schema here is a
 * compile error, not a runtime surprise at merge time.
 */
export const COMMIT_PAYLOAD_SCHEMAS = {
  // ── Records ───────────────────────────────────────────────────────────────
  // Written by record-ops (`parsed.fields`) and by the 3-way auto-merge in
  // merge/record.ts. Always a slug → value map; keys are user-defined so no
  // stronger shape exists.
  record_create: recordFieldValues,
  record_update: recordFieldValues,
  // record_delete/record_restore snapshot the record's field values at the time
  // of the request (`headCommit.payload` of the target record's head commit).
  // Their merge handlers take `_headCommit` and read nothing from it.
  record_delete: recordFieldValues,
  record_restore: recordFieldValues,
  // No current write path emits `record_variant` — it exists in the enum and is
  // merged through `mergeRecordCreate` (same field-value map), and appears in
  // seeded/demo data. Typed as the record shape it is merged as.
  record_variant: recordFieldValues,

  // ── Views ─────────────────────────────────────────────────────────────────
  view_create: z.looseObject({ ...viewSnapshot, name: z.string(), slug: z.string() }),
  view_update: z.looseObject(viewSnapshot),
  view_delete: z.looseObject({ ...viewSnapshot, slug: z.string() }),
  view_restore: z.looseObject({ ...viewSnapshot, slug: z.string() }),

  // ── Node tree ─────────────────────────────────────────────────────────────
  node_create: nodeCreatePayload,
  // `nodes.ts` stores the raw `nodeOperationInputSchema` variant, so `kind` and
  // `nodeId` ARE present on the row even though `mergeNodeRename` reads only
  // slug/name/description.
  node_rename: z.looseObject({
    kind: z.literal("rename").optional(),
    nodeId: z.string().optional(),
    slug: z.string().optional(),
    name: z.string().optional(),
    description: z.string().optional(),
  }),
  node_delete: z.looseObject({
    kind: z.literal("delete").optional(),
    nodeId: z.string().optional(),
  }),
  node_restore: z.looseObject({
    kind: z.literal("restore").optional(),
    nodeId: z.string().optional(),
  }),
  node_move: z.looseObject({
    kind: z.literal("move").optional(),
    nodeId: z.string().optional(),
    parentNodeId: z.string().optional(),
    parentNodeRef: z.string().optional(),
    position: z.number().int().optional(),
  }),

  // ── File trees (skill / drive / airapp) ───────────────────────────────────
  skill_file_create: fileTreeFilePayload,
  skill_file_update: fileTreeFilePayload,
  skill_file_delete: fileTreeFilePayload,
  skill_metadata_update: fileTreeMetadataPayload,
  drive_file_create: fileTreeFilePayload,
  drive_file_update: fileTreeFilePayload,
  drive_file_delete: fileTreeFilePayload,
  drive_metadata_update: fileTreeMetadataPayload,
  airapp_file_create: fileTreeFilePayload,
  airapp_file_update: fileTreeFilePayload,
  airapp_file_delete: fileTreeFilePayload,
  airapp_metadata_update: fileTreeMetadataPayload,

  // ── Rich-node content ─────────────────────────────────────────────────────
  doc_update: z.looseObject({ body: z.string() }),
  whiteboard_document_update: richNodeDocumentPayload,
  workflow_document_update: richNodeDocumentPayload,
  html_document_update: richNodeDocumentPayload,

  // ── Base schema operations ────────────────────────────────────────────────
  // `mergeBaseAddField` requires name + slug, so they are required here.
  base_add_field: z.looseObject({
    ...fieldDefinition,
    name: iStringSchema,
    slug: z.string(),
  }),
  // `mergeBaseDeleteField` requires fieldId.
  base_delete_field: z.looseObject({ ...fieldDefinition, fieldId: z.string() }),
  // `mergeBaseUpdateField` requires fieldId.
  base_update_field: z.looseObject({ ...fieldDefinition, fieldId: z.string() }),
  // `mergeBaseConvertField` requires fieldId + fromType + newType.
  base_convert_field: z.looseObject({
    fieldId: z.string(),
    slug: z.string().optional(),
    fromType: fieldTypeSchema,
    newType: fieldTypeSchema,
    selectChoiceMode: z.enum(["auto_create", "null_on_missing"]).optional(),
    choices: z
      .array(
        z.looseObject({
          id: z.string(),
          name: z.string(),
          color: z.string().optional(),
        }),
      )
      .optional(),
  }),
  base_reorder_fields: z.looseObject({ fieldIds: z.array(z.string()) }),
  // `mergeBaseRestoreField` requires fieldId; the writer stores the whole
  // field-definition snapshot alongside it.
  base_restore_field: z.looseObject({ ...fieldDefinition, fieldId: z.string() }),
  base_archive: baseIdentityPayload,
  base_restore: baseIdentityPayload,
} satisfies Record<CommitOperationKind, z.ZodType>;

// ── Parsing helpers ──────────────────────────────────────────────────────────

/** Narrow an arbitrary operation string to a kind we have a schema for. */
const schemaFor = (operation: string) =>
  COMMIT_PAYLOAD_SCHEMAS[operation as CommitOperationKind] as z.ZodType | undefined;

export class CommitPayloadError extends Error {
  constructor(
    readonly operation: string,
    readonly issues: string,
  ) {
    super(`Invalid "${operation}" commit payload: ${issues}`);
    this.name = "CommitPayloadError";
  }
}

const formatIssues = (error: z.ZodError): string =>
  error.issues
    .map((issue) => `${issue.path.length > 0 ? issue.path.join(".") : "<root>"}: ${issue.message}`)
    .join("; ");

/**
 * Validate a commit payload against its operation's schema, throwing a message
 * that names the operation and the offending path.
 *
 * Returns the ORIGINAL payload object, never Zod's output. The schemas are all
 * loose so nothing would be stripped anyway, but returning the input makes it
 * structurally impossible for validation to mutate an append-only ledger entry.
 */
export const assertCommitPayload = (
  operation: string,
  payload: Record<string, unknown>,
): Record<string, unknown> => {
  const schema = schemaFor(operation);
  if (!schema) {
    throw new CommitPayloadError(
      operation,
      "unknown operation kind — no payload schema registered",
    );
  }
  const result = schema.safeParse(payload);
  if (!result.success) {
    throw new CommitPayloadError(operation, formatIssues(result.error));
  }
  return payload;
};

/**
 * Merge-path counterpart: parse a stored payload into its typed shape.
 *
 * Strict on purpose. Everything a merge can reach was written through
 * `insertCommit` and therefore already validated — a merge only ever acts on an
 * `in_review` change request's fresh commits, it never re-merges historical
 * ones. So a failure here means a genuinely corrupt row, which should be loud
 * rather than silently coerced.
 */
export const parseCommitPayload = <K extends CommitOperationKind>(
  operation: K,
  payload: unknown,
): z.infer<(typeof COMMIT_PAYLOAD_SCHEMAS)[K]> => {
  const schema = schemaFor(operation);
  if (!schema) {
    throw new CommitPayloadError(
      operation,
      "unknown operation kind — no payload schema registered",
    );
  }
  const result = schema.safeParse(payload);
  if (!result.success) {
    throw new CommitPayloadError(operation, formatIssues(result.error));
  }
  return result.data as z.infer<(typeof COMMIT_PAYLOAD_SCHEMAS)[K]>;
};
