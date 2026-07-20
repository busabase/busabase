import { z } from "zod";

const contentPathSchema = z.string().startsWith("/");
const optionalTextSchema = z.string().min(1).nullable();
const rawFieldsSchema = z.record(z.string(), z.unknown());

export const attachmentVOSchema = z.object({
  id: z.string(),
  attachmentId: z.string(),
  assetId: z.string().nullable(),
  url: z.url(),
  fileName: z.string(),
  mimeType: z.string(),
  size: z.number().nonnegative(),
});

export const attachmentFieldsDTOSchema = z
  .object({
    id: z.string(),
    attachmentId: z.string().optional(),
    assetId: z.string().optional(),
    url: z.url(),
    fileName: z.string().optional(),
    mimeType: z.string().optional(),
    size: z.number().nonnegative().optional(),
  })
  .passthrough();

export const relationFieldsDTOSchema = z.union([z.string(), z.array(z.string())]);

export const postFieldsDTOSchema = z
  .object({
    path: contentPathSchema,
    title: z.string().min(1),
    slug: z.string().min(1),
    locale: z.string().min(1),
    status: z.literal("published"),
    description: z.string().optional(),
    body: z.string().min(1),
    "cover-image": z
      .union([attachmentFieldsDTOSchema, z.array(attachmentFieldsDTOSchema), z.url()])
      .optional(),
    attachments: z.array(attachmentFieldsDTOSchema).optional().default([]),
    author: z.string().optional(),
    categories: relationFieldsDTOSchema.optional(),
    tags: relationFieldsDTOSchema.optional(),
    "published-at": z.string().optional(),
    "canonical-url": z.url().optional(),
    "legacy-paths": z.unknown().optional(),
    "seo-title": z.string().optional(),
    "seo-description": z.string().optional(),
    "schema-version": z.number().int().positive().optional().default(1),
    "updated-at": z.string().optional(),
  })
  .passthrough();

export const postVOSchema = z.object({
  id: z.string(),
  path: contentPathSchema,
  title: z.string(),
  slug: z.string(),
  locale: z.string(),
  status: z.literal("published"),
  description: optionalTextSchema,
  body: z.string(),
  coverImage: attachmentVOSchema.nullable(),
  attachments: z.array(attachmentVOSchema),
  author: optionalTextSchema,
  categoryIds: z.array(z.string()),
  tagIds: z.array(z.string()),
  publishedAt: optionalTextSchema,
  canonicalUrl: optionalTextSchema,
  legacyPaths: z.array(z.string()),
  seoTitle: optionalTextSchema,
  seoDescription: optionalTextSchema,
  schemaVersion: z.number().int().positive(),
  updatedAt: z.string(),
  rawFields: rawFieldsSchema,
});

export const pageFieldsDTOSchema = z
  .object({
    path: contentPathSchema,
    title: z.string().min(1),
    slug: z.string().min(1),
    locale: z.string().min(1),
    status: z.literal("published"),
    template: z.enum(["standard", "landing", "product", "use-case"]).optional(),
    body: z.string().min(1),
    hero: z.unknown().optional(),
    features: z.unknown().optional(),
    faqs: z.unknown().optional(),
    "canonical-url": z.url().optional(),
    "legacy-paths": z.unknown().optional(),
    "seo-title": z.string().optional(),
    "seo-description": z.string().optional(),
    "schema-version": z.number().int().positive().optional().default(1),
    "updated-at": z.string().optional(),
  })
  .passthrough();

export const pageVOSchema = z.object({
  id: z.string(),
  path: contentPathSchema,
  title: z.string(),
  slug: z.string(),
  locale: z.string(),
  status: z.literal("published"),
  template: z.enum(["standard", "landing", "product", "use-case"]).nullable(),
  body: z.string(),
  hero: z.unknown(),
  features: z.unknown(),
  faqs: z.unknown(),
  canonicalUrl: optionalTextSchema,
  legacyPaths: z.array(z.string()),
  seoTitle: optionalTextSchema,
  seoDescription: optionalTextSchema,
  schemaVersion: z.number().int().positive(),
  updatedAt: z.string(),
  rawFields: rawFieldsSchema,
});

export const taxonomyFieldsDTOSchema = z
  .object({
    name: z.string().min(1),
    slug: z.string().min(1),
    locale: z.string().min(1),
    description: z.string().optional(),
    "updated-at": z.string().optional(),
  })
  .passthrough();

const taxonomyVOSchema = z.object({
  id: z.string(),
  name: z.string(),
  slug: z.string(),
  locale: z.string(),
  description: optionalTextSchema,
  updatedAt: z.string(),
  rawFields: rawFieldsSchema,
});

export const categoryFieldsDTOSchema = taxonomyFieldsDTOSchema;
export const tagFieldsDTOSchema = taxonomyFieldsDTOSchema;
export const categoryVOSchema = taxonomyVOSchema;
export const tagVOSchema = taxonomyVOSchema;

export type AttachmentFieldsDTO = z.infer<typeof attachmentFieldsDTOSchema>;
export type AttachmentVO = z.infer<typeof attachmentVOSchema>;
export type RelationFieldsDTO = z.infer<typeof relationFieldsDTOSchema>;
export type PostFieldsDTO = z.infer<typeof postFieldsDTOSchema>;
export type PostVO = z.infer<typeof postVOSchema>;
export type PageFieldsDTO = z.infer<typeof pageFieldsDTOSchema>;
export type PageVO = z.infer<typeof pageVOSchema>;
export type CategoryFieldsDTO = z.infer<typeof categoryFieldsDTOSchema>;
export type CategoryVO = z.infer<typeof categoryVOSchema>;
export type TagFieldsDTO = z.infer<typeof tagFieldsDTOSchema>;
export type TagVO = z.infer<typeof tagVOSchema>;
