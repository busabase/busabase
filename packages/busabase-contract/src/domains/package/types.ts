/**
 * Package domain — the `busabase-package@1` on-disk format (pure zod, client-safe).
 *
 * This is the *distribution* format (`busabase-cli publish` → a git repo →
 * `busabase-cli install`), deliberately NOT the `.bbdump` backup format: it
 * carries human-readable VO content (real `.md`, real files, slug-keyed records)
 * and has no slot at all for ids, history, permissions, vault items or webhook
 * secrets — you cannot leak what the format cannot express.
 *
 * Lives in the contract package so the CLI, the server (Phase 2's web-UI
 * install), and any future web consumer validate identically. Pure leaf: zod
 * plus sibling pure contract schemas only.
 */
import { z } from "zod";
import { fieldNameSchema, fieldTypeSchema } from "../base/contract/base-schemas";
import { viewFilterOperatorSchema } from "../base/contract/view-schemas";

export const PACKAGE_FORMAT = "busabase-package@1";

// ── Layout constants ─────────────────────────────────────────────────────────

export const PACKAGE_MANIFEST_FILENAME = "busabase.json";
export const PACKAGE_CONTENT_DIRNAME = "content";
export const PACKAGE_NODE_META_FILENAME = "_node.json";
export const PACKAGE_FOLDER_META_FILENAME = "_folder.json";
export const PACKAGE_BASE_FILENAME = "base.json";
export const PACKAGE_RECORDS_FILENAME = "records.ndjson";
/** Sidecar suffix for a `file` node: `quarterly-report.pdf.node.json`. */
export const PACKAGE_NODE_META_SUFFIX = ".node.json";

/**
 * Names the format interprets, so they cannot double as a node's own content at a
 * node directory's ROOT. Deeper levels inside a recognized file-tree node are
 * unrestricted — nothing there is interpreted.
 */
export const PACKAGE_RESERVED_FILENAMES: readonly string[] = [
  PACKAGE_MANIFEST_FILENAME,
  PACKAGE_NODE_META_FILENAME,
  PACKAGE_FOLDER_META_FILENAME,
  PACKAGE_BASE_FILENAME,
  PACKAGE_RECORDS_FILENAME,
];

/** File-tree node types: a directory whose contents are carried verbatim. */
export const PACKAGE_FILE_TREE_NODE_TYPES = ["skill", "airapp", "drive"] as const;
export type PackageFileTreeNodeType = (typeof PACKAGE_FILE_TREE_NODE_TYPES)[number];

/**
 * AI field types. Created in install's pass 2 (not pass 1) because
 * `options.ai.sourceFieldIds` references field ids that only exist once every
 * field is created.
 */
export const PACKAGE_AI_FIELD_TYPES = ["ai_summary", "ai_tags"] as const;

/**
 * Field types whose VALUES the server computes — the field *definitions* are
 * published, the values are not. Install ignores them if a hand-authored repo
 * includes them anyway.
 */
export const PACKAGE_COMPUTED_FIELD_TYPES: readonly string[] = [
  "created_time",
  "updated_time",
  "created_by",
  "updated_by",
  "auto_number",
  ...PACKAGE_AI_FIELD_TYPES,
];

/**
 * Field types deferred to install's pass 2. `relation` because
 * `options.targetBaseSlug` only resolves against a base that already exists, and
 * relations may be cyclic (A↔B), so no base ordering satisfies them at
 * `bases.create` time.
 */
export const PACKAGE_DEFERRED_FIELD_TYPES: readonly string[] = [
  "relation",
  ...PACKAGE_AI_FIELD_TYPES,
];

// ── Limits (v1 guardrails, validated before any write) ───────────────────────

/**
 * Per-file ceiling. Mirrors the server's real attachment ceiling
 * (open-domains/attachments `MAX_FILE_SIZE` = 25MB, itself duplicated as
 * `MAX_ATTACHMENT_BYTES` in busabase-core's `domains/base/field-types.ts`), so a
 * package can never carry a file the target would refuse to store. Duplicated as a
 * local constant for the same reason field-types.ts duplicates it: importing the
 * server-only upload logic would leak it into the client bundle.
 */
export const PACKAGE_MAX_FILE_BYTES = 25 * 1024 * 1024;
/** Total unpacked size across the whole package. */
export const PACKAGE_MAX_TOTAL_BYTES = 250 * 1024 * 1024;
export const PACKAGE_MAX_FILE_COUNT = 5000;
export const PACKAGE_MAX_RECORDS_PER_BASE = 50_000;

// ── Manifest — `busabase.json` ───────────────────────────────────────────────

export const PackageManifestSchema = z.object({
  format: z.literal(PACKAGE_FORMAT),
  /** Default `--into-folder` name. Not the repo name — a repo can host many packages. */
  name: z.string().min(1),
  description: z.string().default(""),
  /**
   * Informational / reserved for a future marketplace index. The real version pin
   * is always the git ref in the install URL.
   */
  version: z.string().optional(),
  author: z.string().optional(),
  license: z.string().optional(),
  homepage: z.string().url().optional(),
  tags: z.array(z.string()).default([]),
});
export type PackageManifest = z.infer<typeof PackageManifestSchema>;

// ── Sidecars ─────────────────────────────────────────────────────────────────

/** `_node.json` — marks a directory as a verbatim-content file-tree node. */
export const PackageFileTreeNodeMetaSchema = z.object({
  type: z.enum(PACKAGE_FILE_TREE_NODE_TYPES),
  name: z.string().min(1),
  description: z.string().default(""),
  position: z.number().int().optional(),
});
export type PackageFileTreeNodeMeta = z.infer<typeof PackageFileTreeNodeMetaSchema>;

/** `_folder.json` — optional; also how an empty folder survives git. */
export const PackageFolderMetaSchema = z.object({
  /** Defaults to the humanized slug when absent. */
  name: z.string().optional(),
  description: z.string().default(""),
  position: z.number().int().optional(),
});
export type PackageFolderMeta = z.infer<typeof PackageFolderMetaSchema>;

/** `<filename>.node.json` — optional display metadata for a `file` node. */
export const PackageFileNodeMetaSchema = PackageFolderMetaSchema;
export type PackageFileNodeMeta = z.infer<typeof PackageFileNodeMetaSchema>;

/** YAML frontmatter of a `*.md` doc node. */
export const PackageDocFrontmatterSchema = z.object({
  name: z.string().min(1),
  description: z.string().default(""),
  position: z.number().int().optional(),
});
export type PackageDocFrontmatter = z.infer<typeof PackageDocFrontmatterSchema>;

// ── Base serialization — `base.json` ─────────────────────────────────────────

/**
 * Field options as carried by the package. Mirrors the API's `fieldOptionsSchema`
 * except for the three id-bearing keys, which cannot survive a re-id'ing install:
 *
 * | API                       | Package                  | Resolved by |
 * | ------------------------- | ------------------------ | ----------- |
 * | `options.targetBaseId`    | `options.targetBaseSlug` | the SERVER (native alias) |
 * | `options.inverseFieldId`  | `options.inverseFieldSlug`   | install, pass 3 |
 * | `options.ai.sourceFieldIds` | `options.ai.sourceFieldSlugs` | install, pass 3 |
 *
 * `inverseFieldSlug` and `ai.sourceFieldSlugs` are **package-only** keys — the API
 * has no slug alias for them. Install MUST strip both before the options reach the
 * server and patch in the resolved ids afterwards.
 *
 * Everything else (`choices` incl. its ids, `multiple`, `number`, `code`, `embed`,
 * `attachment`) is carried verbatim — field options are stored verbatim server-side,
 * so choice ids survive and record values referencing them need no remap.
 */
export const PackageFieldOptionsSchema = z
  .object({
    ai: z
      .object({
        model: z.string().optional(),
        prompt: z.string().optional(),
        reviewRequired: z.boolean().optional(),
        /** Package-only — replaces `ai.sourceFieldIds`. */
        sourceFieldSlugs: z.array(z.string()).optional(),
      })
      .optional(),
    attachment: z
      .object({
        maxFiles: z.number().int().positive().optional(),
        allowedMimeTypes: z.array(z.string()).optional(),
        maxFileSize: z.number().int().positive().optional(),
      })
      .optional(),
    choices: z
      .array(
        z.object({
          color: z.string().optional(),
          id: z.string(),
          name: z.string(),
        }),
      )
      .optional(),
    code: z
      .object({
        language: z.string().optional(),
      })
      .optional(),
    embed: z
      .object({
        aspectRatio: z.enum(["16:9", "4:3", "1:1"]).optional(),
        height: z.number().int().positive().max(1200).optional(),
        providers: z.array(z.string()).optional(),
      })
      .optional(),
    /** Package-only — replaces `inverseFieldId`. */
    inverseFieldSlug: z.string().optional(),
    multiple: z.boolean().optional(),
    number: z
      .object({
        format: z.enum(["plain", "currency"]).optional(),
        currency: z.string().optional(),
        locale: z.string().optional(),
      })
      .optional(),
    /** Native API alias — the server resolves it to `targetBaseId`. */
    targetBaseSlug: z.string().optional(),
  })
  .default({});
export type PackageFieldOptions = z.infer<typeof PackageFieldOptionsSchema>;

/** The package-only option keys, which must never reach the API. */
export const PACKAGE_ONLY_FIELD_OPTION_KEYS = ["inverseFieldSlug"] as const;
export const PACKAGE_ONLY_AI_OPTION_KEYS = ["sourceFieldSlugs"] as const;

export const PackageBaseFieldSchema = z.object({
  slug: z.string().min(1),
  name: fieldNameSchema,
  type: fieldTypeSchema,
  required: z.boolean().default(false),
  position: z.number().int(),
  options: PackageFieldOptionsSchema,
});
export type PackageBaseField = z.infer<typeof PackageBaseFieldSchema>;

/** View filter minus the optional, server-populated `fieldId`. */
export const PackageViewFilterSchema = z.object({
  fieldSlug: z.string().min(1),
  operator: viewFilterOperatorSchema,
  value: z.unknown().optional(),
});

/** View sort minus the optional, server-populated `fieldId`. */
export const PackageViewSortSchema = z.object({
  direction: z.enum(["asc", "desc"]),
  fieldSlug: z.string().min(1),
});

export const PackageViewConfigSchema = z.object({
  filters: z.array(PackageViewFilterSchema).default([]),
  sorts: z.array(PackageViewSortSchema).default([]),
  visibleFieldSlugs: z.array(z.string()).nullable().optional(),
});
export type PackageViewConfig = z.infer<typeof PackageViewConfigSchema>;

export const PackageViewSchema = z.object({
  slug: z.string().min(1),
  name: z.string().min(1),
  description: z.string().default(""),
  type: z.literal("table").default("table"),
  config: PackageViewConfigSchema.default({ filters: [], sorts: [] }),
});
export type PackageView = z.infer<typeof PackageViewSchema>;

export const PackageBaseSchema = z.object({
  name: z.string().min(1),
  description: z.string().default(""),
  position: z.number().int().optional(),
  /**
   * Informational only — `reviewPolicy` is NOT settable via `bases.create`, so
   * install cannot apply it and warns when it differs from the target's default.
   */
  reviewPolicy: z
    .object({
      kind: z.literal("single"),
      requiredApprovals: z.number(),
    })
    .optional(),
  fields: z.array(PackageBaseFieldSchema).default([]),
  views: z.array(PackageViewSchema).default([]),
});
export type PackageBase = z.infer<typeof PackageBaseSchema>;

// ── Records — `records.ndjson` ───────────────────────────────────────────────

/**
 * One record per line. `key` is a package-local stable identifier (publish uses the
 * SOURCE record id: stable across re-publishes → clean git diffs, unique
 * package-wide, and meaningless to the target — install always mints new ids).
 *
 * `fields` is slug-keyed. Relation values are arrays of record `key`s (possibly
 * pointing into another base's `records.ndjson` in the same package), resolved by
 * install's pass 5.
 */
export const PackageRecordLineSchema = z.object({
  key: z.string().min(1),
  fields: z.record(z.string(), z.unknown()).default({}),
});
export type PackageRecordLine = z.infer<typeof PackageRecordLineSchema>;
