import type { BusabaseCmsField, BusabaseCmsFieldOptions } from "./source";

export const BUSABASE_CMS_SCHEMA_VERSION = 1;
export const BUSABASE_CMS_METADATA_KEY = "busabaseCms";
export const BUSABASE_CMS_ROLES = ["categories", "tags", "posts", "pages"] as const;
export const BUSABASE_CMS_SCHEMA_PROFILES = ["standard", "buda"] as const;

export type BusabaseCmsBaseRole = (typeof BUSABASE_CMS_ROLES)[number];
export type BusabaseCmsBaseIds = Record<BusabaseCmsBaseRole, string>;
export type BusabaseCmsSchemaProfile = (typeof BUSABASE_CMS_SCHEMA_PROFILES)[number];

export interface BusabaseCmsFolderMetadata {
  schemaVersion: typeof BUSABASE_CMS_SCHEMA_VERSION;
  /** Missing in metadata written before profiles were introduced; it means `standard`. */
  profile?: BusabaseCmsSchemaProfile;
  bases: BusabaseCmsBaseIds;
}

export interface BusabaseCmsFieldDefinition
  extends Omit<BusabaseCmsField, "id" | "baseId" | "position"> {}

export interface BusabaseCmsBaseDefinition {
  role: BusabaseCmsBaseRole;
  name: string;
  description: string;
  fields: BusabaseCmsFieldDefinition[];
}

const i18nName = (en: string, zhCN: string) => ({ en, "zh-CN": zhCN });

const selectOptions = (values: Array<[string, string, string]>): BusabaseCmsFieldOptions => ({
  choices: values.map(([id, en, zhCN]) => ({ id, name: `${en} / ${zhCN}` })),
});

const localeOptions = selectOptions([
  ["en", "English", "英文"],
  ["zh-CN", "Simplified Chinese", "简体中文"],
  ["zh-TW", "Traditional Chinese", "繁體中文"],
  ["ja", "Japanese", "日文"],
  ["pt", "Portuguese", "葡萄牙文"],
]);

const statusOptions = selectOptions([
  ["draft", "Draft", "草稿"],
  ["in-review", "In review", "审核中"],
  ["published", "Published", "已发布"],
  ["archived", "Archived", "已归档"],
]);

const taxonomyFields = (): BusabaseCmsFieldDefinition[] => [
  {
    slug: "name",
    name: i18nName("Name", "名称"),
    type: "text",
    required: true,
    options: {},
  },
  {
    slug: "slug",
    name: i18nName("Slug", "标识"),
    type: "text",
    required: true,
    options: {},
  },
  {
    slug: "locale",
    name: i18nName("Locale", "语言"),
    type: "select",
    required: true,
    options: localeOptions,
  },
  {
    slug: "description",
    name: i18nName("Description", "描述"),
    type: "longtext",
    required: false,
    options: {},
  },
  {
    slug: "updated-at",
    name: i18nName("Updated at", "更新时间"),
    type: "updated_time",
    required: false,
    options: {},
  },
];

const postFields = () =>
  [
    ["path", "Path", "网址", "text", true],
    ["title", "Title", "标题", "text", true],
    ["slug", "Slug", "标识", "text", true],
  ].map(([slug, en, zhCN, type, required]) => ({
    slug: slug as string,
    name: i18nName(en as string, zhCN as string),
    type: type as "text",
    required: required as boolean,
    options: {},
  })) satisfies BusabaseCmsFieldDefinition[];

const buildPostFields = (
  baseIds: Partial<Pick<BusabaseCmsBaseIds, "categories" | "tags">>,
): BusabaseCmsFieldDefinition[] => [
  ...postFields(),
  {
    slug: "locale",
    name: i18nName("Locale", "语言"),
    type: "select",
    required: true,
    options: localeOptions,
  },
  {
    slug: "status",
    name: i18nName("Status", "状态"),
    type: "select",
    required: true,
    options: statusOptions,
  },
  {
    slug: "description",
    name: i18nName("Excerpt", "摘要"),
    type: "longtext",
    required: false,
    options: {},
  },
  {
    slug: "body",
    name: i18nName("Body", "正文"),
    type: "markdown",
    required: true,
    options: {},
  },
  {
    slug: "cover-image",
    name: i18nName("Cover image", "封面图片"),
    type: "attachment",
    required: false,
    options: {
      attachment: { maxFiles: 1, allowedMimeTypes: ["image/*"], maxFileSize: 10 * 1024 * 1024 },
    },
  },
  {
    slug: "attachments",
    name: i18nName("Attachments", "附件"),
    type: "attachment",
    required: false,
    options: {
      attachment: {
        maxFiles: 20,
        allowedMimeTypes: ["image/*", "application/pdf"],
        maxFileSize: 20 * 1024 * 1024,
      },
    },
  },
  {
    slug: "author",
    name: i18nName("Author", "作者"),
    type: "text",
    required: false,
    options: {},
  },
  {
    slug: "categories",
    name: i18nName("Categories", "分类"),
    type: "relation",
    required: false,
    options: {
      ...(baseIds.categories ? { targetBaseId: baseIds.categories } : {}),
      multiple: true,
    },
  },
  {
    slug: "tags",
    name: i18nName("Tags", "标签"),
    type: "relation",
    required: false,
    options: { ...(baseIds.tags ? { targetBaseId: baseIds.tags } : {}), multiple: true },
  },
  {
    slug: "published-at",
    name: i18nName("Published at", "发布时间"),
    type: "date",
    required: false,
    options: {},
  },
  {
    slug: "canonical-url",
    name: i18nName("Canonical URL", "规范网址"),
    type: "url",
    required: false,
    options: {},
  },
  {
    slug: "legacy-paths",
    name: i18nName("Legacy paths", "旧网址"),
    type: "json",
    required: false,
    options: {},
  },
  {
    slug: "seo-title",
    name: i18nName("SEO title", "SEO 标题"),
    type: "text",
    required: false,
    options: {},
  },
  {
    slug: "seo-description",
    name: i18nName("SEO description", "SEO 描述"),
    type: "longtext",
    required: false,
    options: {},
  },
  {
    slug: "schema-version",
    name: i18nName("Schema version", "结构版本"),
    type: "number",
    required: true,
    options: {},
  },
  {
    slug: "updated-at",
    name: i18nName("Updated at", "更新时间"),
    type: "updated_time",
    required: false,
    options: {},
  },
];

const pageFields = (): BusabaseCmsFieldDefinition[] => [
  {
    slug: "path",
    name: i18nName("Path", "网址"),
    type: "text",
    required: true,
    options: {},
  },
  {
    slug: "title",
    name: i18nName("Title", "标题"),
    type: "text",
    required: true,
    options: {},
  },
  {
    slug: "slug",
    name: i18nName("Slug", "标识"),
    type: "text",
    required: true,
    options: {},
  },
  {
    slug: "locale",
    name: i18nName("Locale", "语言"),
    type: "select",
    required: true,
    options: localeOptions,
  },
  {
    slug: "status",
    name: i18nName("Status", "状态"),
    type: "select",
    required: true,
    options: statusOptions,
  },
  {
    slug: "template",
    name: i18nName("Template", "模板"),
    type: "select",
    required: true,
    options: selectOptions([
      ["standard", "Standard", "标准"],
      ["landing", "Landing", "落地页"],
      ["product", "Product", "产品"],
      ["use-case", "Use case", "使用场景"],
    ]),
  },
  {
    slug: "body",
    name: i18nName("Body", "正文"),
    type: "html",
    required: true,
    options: {},
  },
  {
    slug: "hero",
    name: i18nName("Hero", "首屏"),
    type: "json",
    required: false,
    options: {},
  },
  {
    slug: "features",
    name: i18nName("Features", "功能"),
    type: "json",
    required: false,
    options: {},
  },
  {
    slug: "faqs",
    name: i18nName("FAQs", "常见问题"),
    type: "json",
    required: false,
    options: {},
  },
  {
    slug: "canonical-url",
    name: i18nName("Canonical URL", "规范网址"),
    type: "url",
    required: false,
    options: {},
  },
  {
    slug: "legacy-paths",
    name: i18nName("Legacy paths", "旧网址"),
    type: "json",
    required: false,
    options: {},
  },
  {
    slug: "seo-title",
    name: i18nName("SEO title", "SEO 标题"),
    type: "text",
    required: false,
    options: {},
  },
  {
    slug: "seo-description",
    name: i18nName("SEO description", "SEO 描述"),
    type: "longtext",
    required: false,
    options: {},
  },
  {
    slug: "schema-version",
    name: i18nName("Schema version", "结构版本"),
    type: "number",
    required: true,
    options: {},
  },
  {
    slug: "updated-at",
    name: i18nName("Updated at", "更新时间"),
    type: "updated_time",
    required: false,
    options: {},
  },
];

const replaceField = (
  fields: BusabaseCmsFieldDefinition[],
  slug: string,
  replacement: BusabaseCmsFieldDefinition,
) => fields.map((field) => (field.slug === slug ? replacement : field));

const buildBudaPostFields = (baseIds: Partial<Pick<BusabaseCmsBaseIds, "categories" | "tags">>) => {
  let fields = buildPostFields(baseIds).filter(
    (field) => !["legacy-paths", "seo-title", "seo-description"].includes(field.slug),
  );
  fields = replaceField(fields, "cover-image", {
    slug: "cover-image",
    name: i18nName("Cover image", "封面图片"),
    type: "text",
    required: false,
    options: {},
  });
  fields = replaceField(fields, "attachments", {
    slug: "attachments",
    name: i18nName("Attachments", "附件"),
    type: "attachment",
    required: false,
    options: {
      attachment: {
        maxFiles: 10,
        allowedMimeTypes: ["image/png", "image/jpeg", "image/webp", "image/svg+xml"],
        maxFileSize: 10 * 1024 * 1024,
      },
    },
  });
  return [
    ...fields,
    {
      slug: "keywords",
      name: i18nName("Keywords", "关键词"),
      type: "json",
      required: false,
      options: {},
    },
    {
      slug: "source-path",
      name: i18nName("Source path", "来源路径"),
      type: "text",
      required: false,
      options: {},
    },
  ] satisfies BusabaseCmsFieldDefinition[];
};

const buildBudaPageFields = () => {
  const fields = pageFields().filter(
    (field) => !["template", "legacy-paths", "seo-title", "seo-description"].includes(field.slug),
  );
  const common = replaceField(
    replaceField(fields, "body", {
      slug: "body",
      name: i18nName("Body", "正文"),
      type: "html",
      required: true,
      options: {},
    }),
    "hero",
    {
      slug: "hero",
      name: i18nName("Hero", "首屏"),
      type: "json",
      required: true,
      options: {},
    },
  );
  const extra = [
    ["route", "Route", "路由", "text"],
    ["meta-title", "Meta title", "Meta 标题", "text"],
    ["meta-description", "Meta description", "Meta 描述", "longtext"],
    ["problem", "Problem", "问题", "json"],
    ["messaging", "Messaging", "文案", "json"],
    ["use-cases", "Use cases", "使用场景", "json"],
    ["section-copy", "Section copy", "分区文案", "json"],
    ["final-cta", "Final CTA", "最终行动号召", "json"],
    ["source-icp-id", "Source ICP ID", "来源 ICP ID", "text"],
    ["source-path", "Source path", "来源路径", "text"],
  ].map(([slug, en, zhCN, type]) => ({
    slug: slug as string,
    name: i18nName(en as string, zhCN as string),
    type: type as "text" | "longtext" | "json",
    required: false,
    options: {},
  })) satisfies BusabaseCmsFieldDefinition[];
  return [...common, ...extra];
};

export const getBusabaseCmsBaseDefinition = (
  role: BusabaseCmsBaseRole,
  baseIds: Partial<BusabaseCmsBaseIds> = {},
  profile: BusabaseCmsSchemaProfile = "standard",
): BusabaseCmsBaseDefinition => {
  if (role === "categories" || role === "tags") {
    return {
      role,
      name: role === "categories" ? "Categories / 分类" : "Tags / 标签",
      description:
        role === "categories"
          ? "Reusable content categories / 可复用的内容分类"
          : "Reusable content tags / 可复用的内容标签",
      fields: taxonomyFields(),
    };
  }
  if (role === "posts") {
    return {
      role,
      name: "Posts / 文章",
      description: "Publishable Markdown posts / 可发布的 Markdown 文章",
      fields: profile === "buda" ? buildBudaPostFields(baseIds) : buildPostFields(baseIds),
    };
  }
  return {
    role,
    name: "Pages / 页面",
    description: "Publishable HTML pages / 可发布的 HTML 页面",
    fields: profile === "buda" ? buildBudaPageFields() : pageFields(),
  };
};
