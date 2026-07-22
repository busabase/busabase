import type {
  SeedBaseDef,
  SeedFieldDef,
  SeedRecordDef,
  SeedScenario,
  SeedViewDef,
} from "../seed-types";

export const CMS_DEMO_FOLDER_NODE_ID = "nod_cms";
export const CMS_DEMO_POSTS_BASE_ID = "bse_local_blog";
export const CMS_DEMO_PAGES_BASE_ID = "bse_local_seo_pages";
export const CMS_DEMO_AGENT_INTEGRATIONS_BASE_ID = "bse_local_agent_integrations";
export const CMS_DEMO_CATEGORIES_BASE_ID = "bsemru0o3pqqmhjhe7";
export const CMS_DEMO_TAGS_BASE_ID = "bsemru0o3xe7ien4w6";

export const CMS_DEMO_BASE_IDS = {
  categories: CMS_DEMO_CATEGORIES_BASE_ID,
  tags: CMS_DEMO_TAGS_BASE_ID,
  posts: CMS_DEMO_POSTS_BASE_ID,
  pages: CMS_DEMO_PAGES_BASE_ID,
} as const;

const REMOVED_SECOND_CMS_FOLDER_ID = "nodmru0gtq2tdiukii";
const REMOVED_SECOND_CMS_BASE_IDS = new Set([
  "bsemru0o3pqqmhjhe7",
  "bsemru0o3xe7ien4w6",
  "bsemru0o44qq1tappa",
  "bsemru0o4cbj6osco8",
]);

const i18nName = (en: string, zhCN: string) => ({ en, "zh-CN": zhCN });
const selectOptions = (values: Array<[string, string, string]>) => ({
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

const taxonomyFields: SeedFieldDef[] = [
  {
    id: "bsf_cms_taxonomy_name",
    slug: "name",
    name: i18nName("Name", "名称"),
    type: "text",
    required: true,
    options: {},
  },
  {
    id: "bsf_cms_taxonomy_slug",
    slug: "slug",
    name: i18nName("Slug", "标识"),
    type: "text",
    required: true,
    options: {},
  },
  {
    id: "bsf_cms_taxonomy_locale",
    slug: "locale",
    name: i18nName("Locale", "语言"),
    type: "select",
    required: true,
    options: localeOptions,
  },
  {
    id: "bsf_cms_taxonomy_description",
    slug: "description",
    name: i18nName("Description", "描述"),
    type: "longtext",
    required: false,
    options: {},
  },
  {
    id: "bsf_cms_taxonomy_updated_at",
    slug: "updated-at",
    name: i18nName("Updated at", "更新时间"),
    type: "updated_time",
    required: false,
    options: {},
  },
];

const categoriesBase: SeedBaseDef = {
  id: CMS_DEMO_CATEGORIES_BASE_ID,
  nodeId: "nodmru0o3pqs8ohdnw",
  slug: "nextjs-fumadocs-demo-cms-categories",
  name: "Categories",
  description: "Reusable categories for Posts and Pages.",
  folderNodeId: CMS_DEMO_FOLDER_NODE_ID,
  useCases: ["blog", "content", "seo-pages"],
  fields: taxonomyFields.map((field) => ({
    ...field,
    id: field.id.replace("taxonomy", "category"),
  })),
};

const tagsBase: SeedBaseDef = {
  id: CMS_DEMO_TAGS_BASE_ID,
  nodeId: "nodmru0o3xerccr6mj",
  slug: "nextjs-fumadocs-demo-cms-tags",
  name: "Tags",
  description: "Reusable localized tags for CMS content.",
  folderNodeId: CMS_DEMO_FOLDER_NODE_ID,
  useCases: ["blog", "content"],
  fields: taxonomyFields.map((field) => ({ ...field, id: field.id.replace("taxonomy", "tag") })),
};

export const CMS_DEMO_CATEGORY_RECORD_IDS = {
  guidesEn: "recmru9pjpzv050y18",
  architectureEn: "recmrufvfxy9uz6pcl",
  guidesZh: "recmru9pjs2q6xh3qq",
  architectureZh: "recmrufvgkkbyhr5rj",
} as const;

export const CMS_DEMO_TAG_RECORD_IDS = {
  nextEn: "recmru9pjtouz9mpmn",
  nextZh: "recmru9pjv7qasa3bx",
  workflowEn: "recmrufvh5a0jmw5xy",
  workflowZh: "recmrufvhos9mdz5u9",
  openApiEn: "recmrufvi8y96279us",
  openApiZh: "recmrufvitxexrhbak",
} as const;

const taxonomyRecord = (
  id: string,
  baseId: string,
  name: string,
  slug: string,
  locale: "en" | "zh-CN",
  description: string,
  minutesAgo: number,
): SeedRecordDef => ({
  id,
  baseId,
  commitId: `cmt_${id}`,
  naturalKey: { fields: { name, locale } },
  fields: { name, slug, locale, description },
  message: `Seed CMS taxonomy ${locale}/${slug}`,
  author: "seed-cms",
  minutesAgo,
  useCases: ["blog", "content", "seo-pages"],
});

const taxonomyRecords: SeedRecordDef[] = [
  taxonomyRecord(
    CMS_DEMO_CATEGORY_RECORD_IDS.guidesEn,
    CMS_DEMO_CATEGORIES_BASE_ID,
    "Guides",
    "guides",
    "en",
    "Practical implementation and operating guides.",
    190,
  ),
  taxonomyRecord(
    CMS_DEMO_CATEGORY_RECORD_IDS.architectureEn,
    CMS_DEMO_CATEGORIES_BASE_ID,
    "Architecture",
    "architecture",
    "en",
    "Content architecture, APIs, and delivery systems.",
    189,
  ),
  taxonomyRecord(
    CMS_DEMO_CATEGORY_RECORD_IDS.guidesZh,
    CMS_DEMO_CATEGORIES_BASE_ID,
    "指南",
    "guides",
    "zh-CN",
    "实用的实现与运营指南。",
    188,
  ),
  taxonomyRecord(
    CMS_DEMO_CATEGORY_RECORD_IDS.architectureZh,
    CMS_DEMO_CATEGORIES_BASE_ID,
    "架构",
    "architecture",
    "zh-CN",
    "内容架构、API 与交付系统。",
    187,
  ),
  taxonomyRecord(
    CMS_DEMO_TAG_RECORD_IDS.nextEn,
    CMS_DEMO_TAGS_BASE_ID,
    "Next.js",
    "nextjs",
    "en",
    "Next.js integration, routing, metadata, and rendering.",
    186,
  ),
  taxonomyRecord(
    CMS_DEMO_TAG_RECORD_IDS.nextZh,
    CMS_DEMO_TAGS_BASE_ID,
    "Next.js",
    "nextjs",
    "zh-CN",
    "Next.js 集成、路由、元数据与内容渲染。",
    185,
  ),
  taxonomyRecord(
    CMS_DEMO_TAG_RECORD_IDS.workflowEn,
    CMS_DEMO_TAGS_BASE_ID,
    "Workflow",
    "workflow",
    "en",
    "Editorial review and content operations workflows.",
    184,
  ),
  taxonomyRecord(
    CMS_DEMO_TAG_RECORD_IDS.workflowZh,
    CMS_DEMO_TAGS_BASE_ID,
    "工作流",
    "workflow",
    "zh-CN",
    "编辑审核与内容运营工作流。",
    183,
  ),
  taxonomyRecord(
    CMS_DEMO_TAG_RECORD_IDS.openApiEn,
    CMS_DEMO_TAGS_BASE_ID,
    "OpenAPI",
    "openapi",
    "en",
    "OpenAPI, SDK, CLI, and integration surfaces.",
    182,
  ),
  taxonomyRecord(
    CMS_DEMO_TAG_RECORD_IDS.openApiZh,
    CMS_DEMO_TAGS_BASE_ID,
    "OpenAPI",
    "openapi",
    "zh-CN",
    "OpenAPI、SDK、CLI 与集成接口。",
    181,
  ),
];

const standardPostFields = (): SeedFieldDef[] => [
  {
    id: "bsf_blog_path",
    slug: "path",
    name: i18nName("Path", "网址"),
    type: "text",
    required: true,
    options: {},
  },
  {
    id: "bsf_blog_slug",
    slug: "slug",
    name: i18nName("Slug", "标识"),
    type: "text",
    required: true,
    options: {},
  },
  {
    id: "bsf_blog_locale",
    slug: "locale",
    name: i18nName("Locale", "语言"),
    type: "select",
    required: true,
    options: localeOptions,
  },
  {
    id: "bsf_blog_status",
    slug: "status",
    name: i18nName("Status", "状态"),
    type: "select",
    required: true,
    options: statusOptions,
  },
  {
    id: "bsf_blog_description",
    slug: "description",
    name: i18nName("Excerpt", "摘要"),
    type: "longtext",
    required: false,
    options: {},
  },
  {
    id: "bsf_blog_cover_image_standard",
    slug: "cover-image",
    name: i18nName("Cover image", "封面图片"),
    type: "attachment",
    required: false,
    options: {
      attachment: { maxFiles: 1, allowedMimeTypes: ["image/*"], maxFileSize: 10 * 1024 * 1024 },
    },
  },
  {
    id: "bsf_blog_attachments",
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
    id: "bsf_blog_author",
    slug: "author",
    name: i18nName("Author", "作者"),
    type: "text",
    required: false,
    options: {},
  },
  {
    id: "bsf_blog_categories",
    slug: "categories",
    name: i18nName("Categories", "分类"),
    type: "relation",
    required: false,
    options: { targetBaseId: CMS_DEMO_CATEGORIES_BASE_ID, multiple: true },
  },
  {
    id: "bsf_blog_tags",
    slug: "tags",
    name: i18nName("Tags", "标签"),
    type: "relation",
    required: false,
    options: { targetBaseId: CMS_DEMO_TAGS_BASE_ID, multiple: true },
  },
  {
    id: "bsf_blog_published_at",
    slug: "published-at",
    name: i18nName("Published at", "发布时间"),
    type: "date",
    required: false,
    options: {},
  },
  {
    id: "bsf_blog_canonical_url",
    slug: "canonical-url",
    name: i18nName("Canonical URL", "规范网址"),
    type: "url",
    required: false,
    options: {},
  },
  {
    id: "bsf_blog_legacy_paths",
    slug: "legacy-paths",
    name: i18nName("Legacy paths", "旧网址"),
    type: "json",
    required: false,
    options: {},
  },
  {
    id: "bsf_blog_seo_title",
    slug: "seo-title",
    name: i18nName("SEO title", "SEO 标题"),
    type: "text",
    required: false,
    options: {},
  },
  {
    id: "bsf_blog_seo_description",
    slug: "seo-description",
    name: i18nName("SEO description", "SEO 描述"),
    type: "longtext",
    required: false,
    options: {},
  },
  {
    id: "bsf_blog_schema_version",
    slug: "schema-version",
    name: i18nName("Schema version", "结构版本"),
    type: "number",
    required: true,
    options: {},
  },
  {
    id: "bsf_blog_updated_at",
    slug: "updated-at",
    name: i18nName("Updated at", "更新时间"),
    type: "updated_time",
    required: false,
    options: {},
  },
];

const standardPageFields = (): SeedFieldDef[] => [
  {
    id: "bsf_seo_path",
    slug: "path",
    name: i18nName("Path", "网址"),
    type: "text",
    required: true,
    options: {},
  },
  {
    id: "bsf_seo_locale",
    slug: "locale",
    name: i18nName("Locale", "语言"),
    type: "select",
    required: true,
    options: localeOptions,
  },
  {
    id: "bsf_seo_status",
    slug: "status",
    name: i18nName("Status", "状态"),
    type: "select",
    required: true,
    options: statusOptions,
  },
  {
    id: "bsf_seo_template",
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
    id: "bsf_seo_body",
    slug: "body",
    name: i18nName("Body", "正文"),
    type: "html",
    required: true,
    options: {},
  },
  {
    id: "bsf_seo_hero",
    slug: "hero",
    name: i18nName("Hero", "首屏"),
    type: "json",
    required: false,
    options: {},
  },
  {
    id: "bsf_seo_features",
    slug: "features",
    name: i18nName("Features", "功能"),
    type: "json",
    required: false,
    options: {},
  },
  {
    id: "bsf_seo_faqs",
    slug: "faqs",
    name: i18nName("FAQs", "常见问题"),
    type: "json",
    required: false,
    options: {},
  },
  {
    id: "bsf_seo_canonical_url",
    slug: "canonical-url",
    name: i18nName("Canonical URL", "规范网址"),
    type: "url",
    required: false,
    options: {},
  },
  {
    id: "bsf_seo_legacy_paths",
    slug: "legacy-paths",
    name: i18nName("Legacy paths", "旧网址"),
    type: "json",
    required: false,
    options: {},
  },
  {
    id: "bsf_seo_seo_title",
    slug: "seo-title",
    name: i18nName("SEO title", "SEO 标题"),
    type: "text",
    required: false,
    options: {},
  },
  {
    id: "bsf_seo_seo_description",
    slug: "seo-description",
    name: i18nName("SEO description", "SEO 描述"),
    type: "longtext",
    required: false,
    options: {},
  },
  {
    id: "bsf_seo_schema_version",
    slug: "schema-version",
    name: i18nName("Schema version", "结构版本"),
    type: "number",
    required: true,
    options: {},
  },
  {
    id: "bsf_seo_updated_at",
    slug: "updated-at",
    name: i18nName("Updated at", "更新时间"),
    type: "updated_time",
    required: false,
    options: {},
  },
];

const mergeFields = (legacy: SeedFieldDef[], standard: SeedFieldDef[]) => {
  const standardBySlug = new Map(standard.map((field) => [field.slug, field]));
  const merged = legacy.map((field) => standardBySlug.get(field.slug) ?? field);
  const legacySlugs = new Set(legacy.map((field) => field.slug));
  return [...merged, ...standard.filter((field) => !legacySlugs.has(field.slug))];
};

const absoluteAttachmentUrls = (raw: unknown) =>
  Array.isArray(raw)
    ? raw.map((item) => {
        if (!item || typeof item !== "object") return item;
        const value = item as Record<string, unknown>;
        const url = typeof value.url === "string" ? value.url : "";
        return { ...value, url: url.startsWith("/") ? `https://demo.busabase.com${url}` : url };
      })
    : [];

const slugify = (value: string, fallback: string) => {
  const slug = value
    .normalize("NFKD")
    .toLocaleLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || fallback.toLocaleLowerCase().replace(/[^a-z0-9]+/g, "-");
};

const standardStatuses = new Set(["draft", "in-review", "published", "archived"]);

const postStatus = (value: unknown) => {
  if (typeof value === "string" && standardStatuses.has(value)) return value;
  return value === "drafting" ? "in-review" : "draft";
};

const pageStatus = (value: unknown) => {
  if (value === "live") return "published";
  return typeof value === "string" && standardStatuses.has(value) ? value : "draft";
};

const pageTemplate = (value: unknown) => {
  if (value === "use-case") return "use-case";
  if (value === "feature") return "product";
  if (value === "comparison") return "landing";
  return "standard";
};

const tagIds = (raw: unknown) => {
  const lookup: Record<string, string> = {
    agents: CMS_DEMO_TAG_RECORD_IDS.workflowEn,
    video: CMS_DEMO_TAG_RECORD_IDS.nextEn,
    policy: CMS_DEMO_TAG_RECORD_IDS.openApiEn,
  };
  return Array.isArray(raw)
    ? raw.flatMap((value) => (typeof value === "string" && lookup[value] ? [lookup[value]] : []))
    : [];
};

const standardizePostRecord = (record: SeedRecordDef): SeedRecordDef => {
  const fields = record.fields;
  const title = String(fields.title ?? "Untitled post");
  const slug = slugify(title, record.id);
  const cover = absoluteAttachmentUrls(fields.cover_image);
  const description = String(fields.ai_summary ?? fields.body ?? "")
    .replace(/\s+/g, " ")
    .slice(0, 220);
  const legacyTags = Array.isArray(fields.legacy_tags)
    ? fields.legacy_tags
    : Array.isArray(fields.tags)
      ? fields.tags
      : [];
  return {
    ...record,
    naturalKey: { fields: { title } },
    fields: {
      ...fields,
      path: `/blog/${slug}`,
      slug,
      locale: "en",
      status: postStatus(fields.status),
      description,
      "cover-image": cover,
      attachments: cover,
      author: "Busabase",
      categories: [
        legacyTags.includes("policy")
          ? CMS_DEMO_CATEGORY_RECORD_IDS.guidesEn
          : CMS_DEMO_CATEGORY_RECORD_IDS.architectureEn,
      ],
      legacy_tags: legacyTags,
      tags: tagIds(legacyTags),
      "published-at": fields.publish_date,
      "canonical-url": `https://busabase-cms-example.vercel.app/blog/${slug}`,
      "legacy-paths": JSON.stringify([]),
      "seo-title": title,
      "seo-description": description,
      "schema-version": 1,
    },
  };
};

const standardizePageRecord = (record: SeedRecordDef): SeedRecordDef => {
  const fields = record.fields;
  const rawPath = String(fields.path ?? fields.slug ?? "/");
  const path = rawPath.startsWith("/") ? rawPath : `/${rawPath}`;
  const slug = path.split("/").filter(Boolean).at(-1) ?? "home";
  const title = String(fields.title ?? slug);
  const description = String(fields.meta_description ?? "");
  return {
    ...record,
    naturalKey: { fields: { title } },
    fields: {
      ...fields,
      path,
      slug,
      locale: fields.locale ?? "en",
      status: pageStatus(fields.status),
      template: pageTemplate(fields.category),
      body: fields.html_body,
      hero: JSON.stringify({ headline: title, description }),
      features: JSON.stringify([]),
      faqs: JSON.stringify([]),
      "legacy-paths": JSON.stringify([]),
      "seo-title": title,
      "seo-description": description,
      "schema-version": 1,
    },
  };
};

const standardizeBlogViews = (view: SeedViewDef): SeedViewDef => {
  if (view.baseId !== CMS_DEMO_POSTS_BASE_ID) return view;
  return {
    ...view,
    config: {
      ...view.config,
      filters: view.config.filters.map((filter) =>
        filter.fieldSlug === "status" && filter.value === "drafting"
          ? { ...filter, value: "in-review" }
          : filter,
      ),
    },
  };
};

/**
 * Upgrade the existing demo CMS in place. This intentionally preserves the
 * legacy Blog Posts, Pages, and Agent Integrations Base/record identities while
 * adding the standard Busabase CMS contract and taxonomy Bases around them.
 */
export const withCmsDemoStandard = (existingScenario: SeedScenario): SeedScenario => {
  const bases = (existingScenario.bases ?? []).filter(
    (base) =>
      !REMOVED_SECOND_CMS_BASE_IDS.has(base.id) &&
      base.id !== CMS_DEMO_CATEGORIES_BASE_ID &&
      base.id !== CMS_DEMO_TAGS_BASE_ID,
  );
  const taxonomyRecordIds = new Set<string>(Object.values(CMS_DEMO_CATEGORY_RECORD_IDS));
  for (const id of Object.values(CMS_DEMO_TAG_RECORD_IDS)) taxonomyRecordIds.add(id);
  const records = (existingScenario.records ?? []).filter(
    (record) =>
      !REMOVED_SECOND_CMS_BASE_IDS.has(record.baseId) && !taxonomyRecordIds.has(record.id),
  );

  const standardizedRecords = records.map((record) => {
    if (record.baseId === CMS_DEMO_POSTS_BASE_ID) return standardizePostRecord(record);
    if (record.baseId === CMS_DEMO_PAGES_BASE_ID) return standardizePageRecord(record);
    return record;
  });
  const standardizedRecordById = new Map(standardizedRecords.map((record) => [record.id, record]));

  return {
    ...existingScenario,
    folders: (existingScenario.folders ?? [])
      .filter((folder) => folder.nodeId !== REMOVED_SECOND_CMS_FOLDER_ID)
      .map((folder) =>
        folder.nodeId === CMS_DEMO_FOLDER_NODE_ID
          ? {
              ...folder,
              metadata: {
                ...(folder.metadata ?? {}),
                busabaseCms: {
                  schemaVersion: 1,
                  profile: "standard",
                  bases: CMS_DEMO_BASE_IDS,
                },
              },
            }
          : folder,
      ),
    bases: [
      ...bases.map((base) => {
        if (base.id === CMS_DEMO_POSTS_BASE_ID) {
          const legacyTagField = base.fields.find((field) => field.slug === "tags");
          const hasLegacyTagField = base.fields.some((field) => field.slug === "legacy_tags");
          return {
            ...base,
            name: "Posts",
            description: "Markdown posts published by the Busabase CMS example.",
            fields: mergeFields(
              [
                ...base.fields,
                ...(legacyTagField && legacyTagField.type !== "relation" && !hasLegacyTagField
                  ? [
                      {
                        ...legacyTagField,
                        id: "bsf_blog_legacy_tags",
                        slug: "legacy_tags",
                        name: "Legacy Tags",
                      },
                    ]
                  : []),
              ],
              standardPostFields(),
            ),
          };
        }
        if (base.id === CMS_DEMO_PAGES_BASE_ID) {
          return { ...base, fields: mergeFields(base.fields, standardPageFields()) };
        }
        return base;
      }),
      categoriesBase,
      tagsBase,
    ],
    records: [...standardizedRecords, ...taxonomyRecords],
    views: (existingScenario.views ?? []).map(standardizeBlogViews),
    changeRequests: (existingScenario.changeRequests ?? []).map((changeRequest) => {
      if (changeRequest.baseId !== CMS_DEMO_POSTS_BASE_ID) return changeRequest;
      return {
        ...changeRequest,
        operations: changeRequest.operations.map((operation) => {
          if (operation.operation !== "record_create" && operation.operation !== "record_update") {
            return operation;
          }
          const current = operation.targetRecordId
            ? standardizedRecordById.get(operation.targetRecordId)?.fields
            : undefined;
          const standardize = (fields: Record<string, unknown>) =>
            standardizePostRecord({
              id: operation.targetRecordId ?? operation.id,
              baseId: CMS_DEMO_POSTS_BASE_ID,
              commitId: operation.commitId,
              fields: { ...(current ?? {}), ...fields },
              message: operation.message,
              author: operation.author,
              minutesAgo: changeRequest.minutesAgo,
              useCases: operation.operation === "record_create" ? changeRequest.useCases : [],
            }).fields;
          return {
            ...operation,
            fields: standardize(operation.fields),
            baseFields: operation.baseFields
              ? standardize(operation.baseFields)
              : operation.baseFields,
          };
        }),
      };
    }),
  };
};
