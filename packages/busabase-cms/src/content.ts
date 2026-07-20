import type { BusabaseConfig } from "busabase-sdk";
import { z } from "zod";
import { BusabaseCmsError } from "./errors";
import { createBusabaseCmsBaseResolver } from "./provision";
import type { BusabaseCmsBaseRole, BusabaseCmsSchemaProfile } from "./schema";
import {
  type BusabaseCmsClient,
  type BusabaseCmsRecord,
  type BusabaseCmsSource,
  createBusabaseCmsSource,
  createBusabaseCmsSourceFromConfig,
} from "./source";
import {
  type AttachmentFieldsDTO,
  type AttachmentVO,
  attachmentVOSchema,
  type CategoryVO,
  categoryFieldsDTOSchema,
  categoryVOSchema,
  type PageVO,
  type PostVO,
  pageFieldsDTOSchema,
  pageVOSchema,
  postFieldsDTOSchema,
  postVOSchema,
  type TagVO,
  tagFieldsDTOSchema,
  tagVOSchema,
} from "./types";

export const DEFAULT_POSTS_BASE_SLUG = "busabase-cms-posts";
export const DEFAULT_PAGES_BASE_SLUG = "busabase-cms-pages";
export const DEFAULT_CATEGORIES_BASE_SLUG = "busabase-cms-categories";
export const DEFAULT_TAGS_BASE_SLUG = "busabase-cms-tags";
const DEFAULT_PAGE_SIZE = 100;

export type CmsRecordKind = "post" | "page" | "category" | "tag";

export interface InvalidCmsRecordIssue {
  kind: CmsRecordKind;
  recordId: string;
  error: BusabaseCmsError;
}

export interface BusabaseCmsOptions {
  config?: BusabaseConfig;
  client?: BusabaseCmsClient;
  source?: BusabaseCmsSource;
  /** Stable Folder node id used to discover and remember the four CMS Base ids. */
  folderId?: string;
  /** Directly materialize missing CMS Bases/fields on first read. Requires folderId. */
  lazyCreate?: boolean;
  /** Provisioning contract for the Folder. Defaults to the reusable standard CMS schema. */
  schemaProfile?: BusabaseCmsSchemaProfile;
  baseSlugs?: {
    posts?: string;
    pages?: string;
    categories?: string;
    tags?: string;
  };
  pageSize?: number;
  invalidRecords?: "skip" | "throw";
  onInvalidRecord?: (issue: InvalidCmsRecordIssue) => void;
}

export interface BusabaseCmsPathCollection<T> {
  list: () => Promise<T[]>;
  getByPath: (path: string) => Promise<T | null>;
}

export interface BusabaseCmsTaxonomyCollection<T> {
  list: () => Promise<T[]>;
  getBySlug: (slug: string) => Promise<T | null>;
}

export interface BusabaseCms {
  posts: BusabaseCmsPathCollection<PostVO>;
  pages: BusabaseCmsPathCollection<PageVO>;
  categories: BusabaseCmsTaxonomyCollection<CategoryVO>;
  tags: BusabaseCmsTaxonomyCollection<TagVO>;
}

interface ResolvedOptions {
  source: BusabaseCmsSource;
  resolveBaseId?: (role: BusabaseCmsBaseRole) => Promise<string>;
  baseSlugs: {
    posts: string;
    pages: string;
    categories: string;
    tags: string;
  };
  pageSize: number;
  invalidRecords: "skip" | "throw";
  onInvalidRecord?: (issue: InvalidCmsRecordIssue) => void;
}

const optional = (value: string | undefined): string | null => value ?? null;

const parseJsonField = <T>(
  raw: unknown,
  fieldSlug: string,
  schema: z.ZodType<T>,
  fallback: T,
): T => {
  if (raw === undefined || raw === null || raw === "") return fallback;

  let decoded: unknown = raw;
  if (typeof raw === "string") {
    try {
      decoded = JSON.parse(raw);
    } catch (cause) {
      throw new BusabaseCmsError(`Busabase field "${fieldSlug}" contains malformed JSON`, {
        cause,
      });
    }
  }

  const parsed = schema.safeParse(decoded);
  if (!parsed.success) {
    throw new BusabaseCmsError(`Busabase field "${fieldSlug}" has an invalid shape`, {
      cause: parsed.error,
    });
  }
  return parsed.data;
};

const attachmentFromFields = (fields: AttachmentFieldsDTO): AttachmentVO =>
  attachmentVOSchema.parse({
    id: fields.id,
    attachmentId: fields.attachmentId ?? fields.id,
    assetId: fields.assetId ?? null,
    url: fields.url,
    fileName: fields.fileName ?? fields.url.split("/").at(-1) ?? "attachment",
    mimeType: fields.mimeType ?? "application/octet-stream",
    size: fields.size ?? 0,
  });

const attachmentFromLegacyUrl = (url: string): AttachmentVO =>
  attachmentVOSchema.parse({
    id: url,
    attachmentId: url,
    assetId: null,
    url,
    fileName: url.split("/").at(-1) ?? "attachment",
    mimeType: "application/octet-stream",
    size: 0,
  });

const normalizeCoverImage = (
  raw: AttachmentFieldsDTO | AttachmentFieldsDTO[] | string | undefined,
): AttachmentVO | null => {
  if (!raw) return null;
  if (typeof raw === "string") return attachmentFromLegacyUrl(raw);
  const first = Array.isArray(raw) ? raw[0] : raw;
  return first ? attachmentFromFields(first) : null;
};

const normalizeAttachments = (raw: AttachmentFieldsDTO[]): AttachmentVO[] =>
  raw.map(attachmentFromFields);

const normalizeRelationIds = (raw: string | string[] | undefined): string[] => {
  if (!raw) return [];
  return [...new Set(Array.isArray(raw) ? raw : [raw])];
};

const isPublishedRecord = (record: BusabaseCmsRecord): boolean =>
  record.status === "active" && record.headCommit.fields.status === "published";

export const mapPublishedPostRecord = (record: BusabaseCmsRecord): PostVO | null => {
  if (!isPublishedRecord(record)) return null;

  const parsed = postFieldsDTOSchema.safeParse(record.headCommit.fields);
  if (!parsed.success) {
    throw new BusabaseCmsError(`Published Busabase Post record ${record.id} is invalid`, {
      cause: parsed.error,
    });
  }
  const fields = parsed.data;

  return postVOSchema.parse({
    id: record.id,
    path: fields.path,
    title: fields.title,
    slug: fields.slug,
    locale: fields.locale,
    status: fields.status,
    description: optional(fields.description),
    body: fields.body,
    coverImage: normalizeCoverImage(fields["cover-image"]),
    attachments: normalizeAttachments(fields.attachments),
    author: optional(fields.author),
    categoryIds: normalizeRelationIds(fields.categories),
    tagIds: normalizeRelationIds(fields.tags),
    publishedAt: optional(fields["published-at"]),
    canonicalUrl: optional(fields["canonical-url"]),
    legacyPaths: parseJsonField(fields["legacy-paths"], "legacy-paths", z.array(z.string()), []),
    seoTitle: optional(fields["seo-title"]),
    seoDescription: optional(fields["seo-description"]),
    schemaVersion: fields["schema-version"],
    updatedAt: fields["updated-at"] ?? record.updatedAt,
    rawFields: record.headCommit.fields,
  });
};

export const mapPublishedPageRecord = (record: BusabaseCmsRecord): PageVO | null => {
  if (!isPublishedRecord(record)) return null;

  const parsed = pageFieldsDTOSchema.safeParse(record.headCommit.fields);
  if (!parsed.success) {
    throw new BusabaseCmsError(`Published Busabase Page record ${record.id} is invalid`, {
      cause: parsed.error,
    });
  }
  const fields = parsed.data;

  return pageVOSchema.parse({
    id: record.id,
    path: fields.path,
    title: fields.title,
    slug: fields.slug,
    locale: fields.locale,
    status: fields.status,
    template: optional(fields.template),
    body: fields.body,
    hero: parseJsonField(fields.hero, "hero", z.unknown(), null),
    features: parseJsonField(fields.features, "features", z.unknown(), []),
    faqs: parseJsonField(fields.faqs, "faqs", z.unknown(), []),
    canonicalUrl: optional(fields["canonical-url"]),
    legacyPaths: parseJsonField(fields["legacy-paths"], "legacy-paths", z.array(z.string()), []),
    seoTitle: optional(fields["seo-title"]),
    seoDescription: optional(fields["seo-description"]),
    schemaVersion: fields["schema-version"],
    updatedAt: fields["updated-at"] ?? record.updatedAt,
    rawFields: record.headCommit.fields,
  });
};

const mapTaxonomyRecord = (
  record: BusabaseCmsRecord,
  kind: "Category" | "Tag",
): CategoryVO | TagVO | null => {
  if (record.status !== "active") return null;
  const schema = kind === "Category" ? categoryFieldsDTOSchema : tagFieldsDTOSchema;
  const parsed = schema.safeParse(record.headCommit.fields);
  if (!parsed.success) {
    throw new BusabaseCmsError(`Active Busabase ${kind} record ${record.id} is invalid`, {
      cause: parsed.error,
    });
  }
  const fields = parsed.data;
  const value = {
    id: record.id,
    name: fields.name,
    slug: fields.slug,
    locale: fields.locale,
    description: optional(fields.description),
    updatedAt: fields["updated-at"] ?? record.updatedAt,
    rawFields: record.headCommit.fields,
  };
  return kind === "Category" ? categoryVOSchema.parse(value) : tagVOSchema.parse(value);
};

export const mapActiveCategoryRecord = (record: BusabaseCmsRecord): CategoryVO | null =>
  mapTaxonomyRecord(record, "Category");

export const mapActiveTagRecord = (record: BusabaseCmsRecord): TagVO | null =>
  mapTaxonomyRecord(record, "Tag");

const resolveOptions = (options: BusabaseCmsOptions): ResolvedOptions => {
  const pageSize = options.pageSize ?? DEFAULT_PAGE_SIZE;
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100) {
    throw new BusabaseCmsError("pageSize must be an integer between 1 and 100");
  }
  if (options.source && (options.client || options.config)) {
    throw new BusabaseCmsError("Provide source or client/config, not both");
  }
  if (options.client && options.config) {
    throw new BusabaseCmsError("Provide client or config, not both");
  }
  if (options.lazyCreate && !options.folderId) {
    throw new BusabaseCmsError("lazyCreate requires folderId");
  }
  if (
    options.source &&
    options.lazyCreate &&
    (!options.source.getBaseById ||
      !options.source.getNode ||
      !options.source.listDirectChildren ||
      !options.source.createBase ||
      !options.source.createField ||
      !options.source.updateNodeMetadata)
  ) {
    throw new BusabaseCmsError(
      "lazyCreate with a custom source requires node, Base, field, and metadata provisioning methods",
    );
  }

  const source =
    options.source ??
    (options.client
      ? createBusabaseCmsSource(options.client)
      : createBusabaseCmsSourceFromConfig(options.config));

  return {
    source,
    resolveBaseId: options.folderId
      ? createBusabaseCmsBaseResolver({
          source,
          folderId: options.folderId,
          lazyCreate: options.lazyCreate ?? false,
          schemaProfile: options.schemaProfile ?? "standard",
        })
      : undefined,
    baseSlugs: {
      posts: options.baseSlugs?.posts ?? DEFAULT_POSTS_BASE_SLUG,
      pages: options.baseSlugs?.pages ?? DEFAULT_PAGES_BASE_SLUG,
      categories: options.baseSlugs?.categories ?? DEFAULT_CATEGORIES_BASE_SLUG,
      tags: options.baseSlugs?.tags ?? DEFAULT_TAGS_BASE_SLUG,
    },
    pageSize,
    invalidRecords: options.invalidRecords ?? "skip",
    onInvalidRecord: options.onInvalidRecord,
  };
};

const listAllRecords = async (
  options: ResolvedOptions,
  role: BusabaseCmsBaseRole,
): Promise<BusabaseCmsRecord[]> => {
  const baseSlug = options.baseSlugs[role];
  const baseId = options.resolveBaseId
    ? await options.resolveBaseId(role)
    : (await options.source.getBaseBySlug(baseSlug))?.id;
  if (!baseId) throw new BusabaseCmsError(`Busabase Base "${baseSlug}" was not found`);

  const records: BusabaseCmsRecord[] = [];
  const visitedCursors = new Set<string>();
  let cursor: string | undefined;

  do {
    const page = await options.source.listRecordsPage({
      baseId,
      limit: options.pageSize,
      cursor,
    });
    records.push(...page.records);

    if (!page.nextCursor) break;
    if (visitedCursors.has(page.nextCursor)) {
      throw new BusabaseCmsError(`Busabase returned a repeated cursor for Base "${baseSlug}"`);
    }
    visitedCursors.add(page.nextCursor);
    cursor = page.nextCursor;
  } while (cursor);

  return records;
};

const mapValidRecords = <T>(
  options: ResolvedOptions,
  records: BusabaseCmsRecord[],
  kind: CmsRecordKind,
  mapper: (record: BusabaseCmsRecord) => T | null,
): T[] =>
  records.flatMap((record) => {
    try {
      const content = mapper(record);
      return content ? [content] : [];
    } catch (cause) {
      const error =
        cause instanceof BusabaseCmsError
          ? cause
          : new BusabaseCmsError(`Could not map Busabase record ${record.id}`, { cause });
      if (options.invalidRecords === "throw") throw error;

      const issue = { kind, recordId: record.id, error } satisfies InvalidCmsRecordIssue;
      if (options.onInvalidRecord) options.onInvalidRecord(issue);
      else console.warn(`[busabase-cms] Skipping invalid ${kind} record ${record.id}`, error);
      return [];
    }
  });

export const createBusabaseCms = (options: BusabaseCmsOptions = {}): BusabaseCms => {
  const resolved = resolveOptions(options);

  const listPosts = async () =>
    mapValidRecords(
      resolved,
      await listAllRecords(resolved, "posts"),
      "post",
      mapPublishedPostRecord,
    );
  const listPages = async () =>
    mapValidRecords(
      resolved,
      await listAllRecords(resolved, "pages"),
      "page",
      mapPublishedPageRecord,
    );
  const listCategories = async () =>
    mapValidRecords(
      resolved,
      await listAllRecords(resolved, "categories"),
      "category",
      mapActiveCategoryRecord,
    );
  const listTags = async () =>
    mapValidRecords(resolved, await listAllRecords(resolved, "tags"), "tag", mapActiveTagRecord);

  return {
    posts: {
      list: listPosts,
      getByPath: async (path) => (await listPosts()).find((post) => post.path === path) ?? null,
    },
    pages: {
      list: listPages,
      getByPath: async (path) => (await listPages()).find((page) => page.path === path) ?? null,
    },
    categories: {
      list: listCategories,
      getBySlug: async (slug) =>
        (await listCategories()).find((category) => category.slug === slug) ?? null,
    },
    tags: {
      list: listTags,
      getBySlug: async (slug) => (await listTags()).find((tag) => tag.slug === slug) ?? null,
    },
  };
};
