// NOTE: isomorphic-pure-ish single source of demo/seed CONTENT. It only depends
// on ../context (the `DemoUseCase` tag union) and ../types (VO shapes). It never
// touches the db, drizzle, storage, or node-only APIs, so both the server seed
// path (`logic/store.ts`, which inserts these rows) and the stateless demo read
// layer (`logic/demo-store.ts`, which returns them as VOs) consume ONE source.
//
// The stateless `?demo` router never persists, so the demo side is modeled
// directly as View Objects (VO): there is no PO→VO hydration to mirror, and the
// shapes here match exactly what `hydrateChangeRequest` / `hydrateRecord` return.

import type {
  AuditEventVO,
  BaseFieldVO,
  BaseVO,
  ChangeRequestVO,
  CommitVO,
  NodeVO,
  OperationVO,
  RecordVO,
  ReviewVO,
  ViewVO,
} from "busabase-contract/types";
import type { DemoUseCase } from "../context";
import {
  AGENT_INTEGRATIONS_BASES,
  AGENT_INTEGRATIONS_RECORDS,
  AGENT_INTEGRATIONS_VIEWS,
} from "./scenarios/agent-integrations";
import { CROSS_FUNCTIONAL_BASES, CROSS_FUNCTIONAL_RECORDS } from "./scenarios/cross-functional";
import {
  DIRECTORY_LISTINGS_BASES,
  DIRECTORY_LISTINGS_RECORDS,
  DIRECTORY_LISTINGS_VIEWS,
} from "./scenarios/directory-listing";
import {
  FINANCE_BASES,
  FINANCE_CHANGE_REQUESTS,
  FINANCE_FOLDERS,
  FINANCE_RECORDS,
  FINANCE_VIEWS,
} from "./scenarios/finance-invoice";
import { readmeScenario } from "./scenarios/readme-scenarios";
import type {
  SeedBaseDef,
  SeedChangeRequestDef,
  SeedFieldDef,
  SeedFolderDef,
  SeedRecordDef,
  SeedScenario,
  SeedViewDef,
} from "./seed-types";

export const DEMO_ACTOR_ID = "local-admin";
const REVIEW_POLICY = { kind: "single" as const, requiredApprovals: 1 };

// ── Shared identifiers (kept identical to the legacy store.ts seed so demo and
// real local data reference the same nodes/bases/records) ────────────────────
export const DEMO_ROOT_NODE_ID = "nod_root";
export const DEMO_CMS_FOLDER_NODE_ID = "nod_cms";
export const DEMO_LAB_FOLDER_NODE_ID = "nod_lab";
export const DEMO_CONTENT_FOLDER_NODE_ID = "nod_content";
export const DEMO_CRM_FOLDER_NODE_ID = "nod_crm";
export const DEMO_BLOG_BASE_ID = "bse_local_blog";
export const DEMO_BLOG_BASE_NODE_ID = "nod_base_blog";
export const DEMO_SOCIAL_BASE_ID = "bse_local_social";
export const DEMO_SOCIAL_BASE_NODE_ID = "nod_base_social";
export const DEMO_NEWSLETTER_BASE_ID = "bse_local_newsletter";
export const DEMO_NEWSLETTER_BASE_NODE_ID = "nod_base_newsletter";
export const DEMO_MEDIA_ASSETS_BASE_ID = "bse_local_media_assets";
export const DEMO_MEDIA_ASSETS_BASE_NODE_ID = "nod_base_media_assets";
export const DEMO_FIELD_TYPE_LAB_BASE_ID = "bse_local_field_type_lab";
export const DEMO_FIELD_TYPE_LAB_BASE_NODE_ID = "nod_base_field_type_lab";
export const DEMO_CRM_COMPANIES_BASE_ID = "bse_local_crm_companies";
export const DEMO_CRM_COMPANIES_BASE_NODE_ID = "nod_base_crm_companies";
export const DEMO_CRM_CONTACTS_BASE_ID = "bse_local_crm_contacts";
export const DEMO_CRM_CONTACTS_BASE_NODE_ID = "nod_base_crm_contacts";
export const DEMO_CRM_DEALS_BASE_ID = "bse_local_crm_deals";
export const DEMO_CRM_DEALS_BASE_NODE_ID = "nod_base_crm_deals";

const BLOG_APPROVAL_RECORD_ID = "rec_seed_blog_approval";
const BLOG_APPROVAL_COMMIT_ID = "cmt_seed_blog_approval";
const BLOG_PRIVATE_RECORD_ID = "rec_seed_blog_private";
const BLOG_PRIVATE_COMMIT_ID = "cmt_seed_blog_private";
const SOCIAL_THREAD_RECORD_ID = "rec_seed_social_thread";
const SOCIAL_THREAD_COMMIT_ID = "cmt_seed_social_thread";
const SOCIAL_STALE_RECORD_ID = "rec_seed_social_stale";
const SOCIAL_STALE_COMMIT_ID = "cmt_seed_social_stale";
const NEWSLETTER_RECORD_ID = "rec_seed_newsletter_founders";
const NEWSLETTER_COMMIT_ID = "cmt_seed_newsletter_founders";
const NEWSLETTER_REGULATION_RECORD_ID = "rec_seed_newsletter_regulation";
const NEWSLETTER_REGULATION_COMMIT_ID = "cmt_seed_newsletter_regulation";
const NEWSLETTER_STACK_RECORD_ID = "rec_seed_newsletter_stack";
const NEWSLETTER_STACK_COMMIT_ID = "cmt_seed_newsletter_stack";
const MEDIA_CLIP_RECORD_ID = "rec_seed_media_clip_review";
const MEDIA_CLIP_COMMIT_ID = "cmt_seed_media_clip_review";
const FIELD_TYPE_LAB_RECORD_ID = "rec_seed_field_type_lab";
const FIELD_TYPE_LAB_COMMIT_ID = "cmt_seed_field_type_lab";
const FIELD_TYPE_LAB_VIEW_ID = "viw_seed_field_type_lab_all";
// CRM record ids (Companies ← Contacts, Companies ← Deals → Contacts).
const CRM_COMPANY_ACME_ID = "rec_seed_crm_company_acme";
const CRM_COMPANY_NORTHWIND_ID = "rec_seed_crm_company_northwind";
const CRM_COMPANY_GLOBEX_ID = "rec_seed_crm_company_globex";
const CRM_CONTACT_ALICE_ID = "rec_seed_crm_contact_alice";
const CRM_CONTACT_BOB_ID = "rec_seed_crm_contact_bob";
const CRM_CONTACT_CAROL_ID = "rec_seed_crm_contact_carol";
const CRM_CONTACT_DAN_ID = "rec_seed_crm_contact_dan";
const CRM_DEAL_ACME_ID = "rec_seed_crm_deal_acme";
const CRM_DEAL_NORTHWIND_ID = "rec_seed_crm_deal_northwind";
const CRM_DEAL_GLOBEX_ID = "rec_seed_crm_deal_globex";

/** Sidebar folders that group the seeded bases. */
export const DEMO_FOLDERS: SeedFolderDef[] = [
  {
    nodeId: DEMO_CMS_FOLDER_NODE_ID,
    slug: "cms",
    name: "CMS",
    description: "Website content — blog articles and reviewed landing pages.",
    position: 0,
  },
  {
    nodeId: DEMO_CONTENT_FOLDER_NODE_ID,
    slug: "marketing",
    name: "Marketing",
    description: "Social posts, newsletters, and media assets.",
    position: 1,
  },
  {
    nodeId: DEMO_CRM_FOLDER_NODE_ID,
    slug: "crm",
    name: "CRM",
    description: "Companies, contacts, and deals.",
    position: 2,
  },
  ...FINANCE_FOLDERS,
  ...(readmeScenario.folders ?? []),
  {
    nodeId: DEMO_LAB_FOLDER_NODE_ID,
    slug: "lab",
    name: "Lab",
    description: "Internal field-type coverage and QA bases.",
    position: 20,
  },
];

const blogFields: SeedFieldDef[] = [
  { id: "bsf_blog_title", slug: "title", name: "Title", type: "text", required: true, options: {} },
  {
    id: "bsf_blog_cover_image",
    slug: "cover_image",
    name: "Cover Image",
    type: "attachment",
    required: false,
    options: {
      attachment: { maxFiles: 1, allowedMimeTypes: ["image/png", "image/jpeg", "image/webp"] },
    },
  },
  {
    id: "bsf_blog_body",
    slug: "body",
    name: "Body",
    type: "markdown",
    required: true,
    options: {},
  },
  {
    id: "bsf_blog_channel",
    slug: "channel",
    name: "Channel",
    type: "text",
    required: false,
    options: {},
  },
  {
    id: "bsf_blog_priority",
    slug: "priority",
    name: "Priority",
    type: "number",
    required: false,
    options: {},
  },
  {
    id: "bsf_blog_publish_date",
    slug: "publish_date",
    name: "Publish Date",
    type: "date",
    required: false,
    options: {},
  },
  {
    id: "bsf_blog_ready",
    slug: "ready",
    name: "Ready",
    type: "checkbox",
    required: false,
    options: {},
  },
  {
    id: "bsf_blog_status",
    slug: "status",
    name: "Status",
    type: "select",
    required: false,
    options: {
      choices: [
        { id: "idea", name: "Idea", color: "slate" },
        { id: "drafting", name: "In review", color: "amber" },
        { id: "published", name: "Published", color: "emerald" },
      ],
    },
  },
  {
    id: "bsf_blog_tags",
    slug: "tags",
    name: "Tags",
    type: "multiselect",
    required: false,
    options: {
      choices: [
        { id: "agents", name: "Agents", color: "emerald" },
        { id: "video", name: "Video", color: "violet" },
        { id: "policy", name: "Policy", color: "rose" },
      ],
    },
  },
  {
    id: "bsf_blog_source_url",
    slug: "source_url",
    name: "Source URL",
    type: "url",
    required: false,
    options: {},
  },
  {
    id: "bsf_blog_contact_email",
    slug: "contact_email",
    name: "Contact Email",
    type: "email",
    required: false,
    options: {},
  },
  {
    id: "bsf_blog_contact_phone",
    slug: "contact_phone",
    name: "Contact Phone",
    type: "phone",
    required: false,
    options: {},
  },
  {
    id: "bsf_blog_ai_summary",
    slug: "ai_summary",
    name: "AI Summary",
    type: "ai_summary",
    required: false,
    options: {
      ai: { model: "gpt-5-mini", reviewRequired: true, sourceFieldIds: ["bsf_blog_body"] },
    },
  },
  {
    id: "bsf_blog_ai_tags",
    slug: "ai_tags",
    name: "AI Tags",
    type: "ai_tags",
    required: false,
    options: {
      ai: { model: "gpt-5-mini", reviewRequired: true, sourceFieldIds: ["bsf_blog_body"] },
    },
  },
  {
    id: "bsf_blog_created_time",
    slug: "created_time",
    name: "Created Time",
    type: "created_time",
    required: false,
    options: {},
  },
  {
    id: "bsf_blog_related_social",
    slug: "related_social",
    name: "Related Social Posts",
    type: "relation",
    required: false,
    options: { multiple: true, targetBaseId: DEMO_SOCIAL_BASE_ID },
  },
];

const socialFields: SeedFieldDef[] = [
  {
    id: "bsf_social_title",
    slug: "title",
    name: "Title",
    type: "text",
    required: true,
    options: {},
  },
  {
    id: "bsf_social_body",
    slug: "body",
    name: "Body",
    type: "markdown",
    required: true,
    options: {},
  },
  {
    id: "bsf_social_channel",
    slug: "channel",
    name: "Channel",
    type: "text",
    required: false,
    options: {},
  },
  {
    id: "bsf_social_related_blogs",
    slug: "related_blogs",
    name: "Related Blog Posts",
    type: "relation",
    required: false,
    options: { multiple: true, targetBaseId: DEMO_BLOG_BASE_ID },
  },
];

const newsletterFields: SeedFieldDef[] = [
  {
    id: "bsf_newsletter_title",
    slug: "title",
    name: "Title",
    type: "text",
    required: true,
    options: {},
  },
  {
    id: "bsf_newsletter_body",
    slug: "body",
    name: "Body",
    type: "html",
    required: true,
    options: {},
  },
  {
    id: "bsf_newsletter_audience",
    slug: "audience",
    name: "Audience",
    type: "text",
    required: false,
    options: {},
  },
  {
    id: "bsf_newsletter_source_posts",
    slug: "source_posts",
    name: "Source Blog Posts",
    type: "relation",
    required: false,
    options: { multiple: true, targetBaseId: DEMO_BLOG_BASE_ID },
  },
];

const mediaAssetFields: SeedFieldDef[] = [
  {
    id: "bsf_media_title",
    slug: "title",
    name: "Title",
    type: "text",
    required: true,
    options: {},
  },
  {
    id: "bsf_media_asset",
    slug: "asset",
    name: "Asset",
    type: "attachment",
    required: false,
    options: {
      attachment: {
        allowedMimeTypes: ["image/png", "video/mp4", "text/vtt"],
        maxFileSize: 25 * 1024 * 1024,
        maxFiles: 3,
      },
    },
  },
  {
    id: "bsf_media_transcript",
    slug: "transcript",
    name: "Transcript",
    type: "markdown",
    required: false,
    options: {},
  },
  {
    id: "bsf_media_scene_description",
    slug: "scene_description",
    name: "Scene Description",
    type: "longtext",
    required: false,
    options: {},
  },
  {
    id: "bsf_media_detected_objects",
    slug: "detected_objects",
    name: "Detected Objects",
    type: "multiselect",
    required: false,
    options: {
      choices: [
        { id: "dashboard", name: "Dashboard", color: "slate" },
        { id: "human-review", name: "Human review", color: "emerald" },
        { id: "agent-output", name: "Agent output", color: "violet" },
      ],
    },
  },
  {
    id: "bsf_media_usage_rights",
    slug: "usage_rights",
    name: "Usage Rights",
    type: "select",
    required: false,
    options: {
      choices: [
        { id: "approved", name: "Approved", color: "emerald" },
        { id: "needs-review", name: "Needs review", color: "amber" },
        { id: "restricted", name: "Restricted", color: "rose" },
      ],
    },
  },
  {
    id: "bsf_media_review_status",
    slug: "review_status",
    name: "Review Status",
    type: "select",
    required: false,
    options: {
      choices: [
        { id: "queued", name: "Queued", color: "slate" },
        { id: "in-review", name: "In review", color: "amber" },
        { id: "approved", name: "Approved", color: "emerald" },
      ],
    },
  },
];

const fieldTypeLabFields: SeedFieldDef[] = [
  { id: "bsf_lab_text", slug: "text", name: "Text", type: "text", required: true, options: {} },
  {
    id: "bsf_lab_longtext",
    slug: "longtext",
    name: "Long Text",
    type: "longtext",
    required: false,
    options: {},
  },
  {
    id: "bsf_lab_markdown",
    slug: "markdown",
    name: "Markdown",
    type: "markdown",
    required: false,
    options: {},
  },
  {
    id: "bsf_lab_html",
    slug: "html",
    name: "HTML",
    type: "html",
    required: false,
    options: {},
  },
  {
    id: "bsf_lab_code_json",
    slug: "code_json",
    name: "JSON",
    type: "code",
    required: false,
    options: { code: { language: "json" } },
  },
  {
    id: "bsf_lab_code_yaml",
    slug: "code_yaml",
    name: "YAML",
    type: "code",
    required: false,
    options: { code: { language: "yaml" } },
  },
  {
    id: "bsf_lab_code",
    slug: "code",
    name: "Code",
    type: "code",
    required: false,
    options: { code: { language: "typescript" } },
  },
  {
    id: "bsf_lab_attachment",
    slug: "attachment",
    name: "Attachment",
    type: "attachment",
    required: false,
    options: {
      attachment: {
        allowedMimeTypes: ["image/png", "text/markdown"],
        maxFileSize: 10 * 1024 * 1024,
        maxFiles: 2,
      },
    },
  },
  {
    id: "bsf_lab_relation",
    slug: "relation",
    name: "Relation (multi · one-way)",
    type: "relation",
    required: false,
    options: { multiple: true, targetBaseId: DEMO_BLOG_BASE_ID },
  },
  {
    id: "bsf_lab_relation_one",
    slug: "relation_one",
    name: "Relation (single · one-way)",
    type: "relation",
    required: false,
    options: { multiple: false, targetBaseId: DEMO_CRM_COMPANIES_BASE_ID },
  },
  {
    id: "bsf_lab_relation_self",
    slug: "relation_self",
    name: "Relation (bidirectional)",
    type: "relation",
    required: false,
    options: {
      multiple: true,
      targetBaseId: DEMO_FIELD_TYPE_LAB_BASE_ID,
      inverseFieldId: "bsf_lab_relation_self_inverse",
    },
  },
  {
    id: "bsf_lab_relation_self_inverse",
    slug: "relation_self_inverse",
    name: "Relation (bidirectional · inverse)",
    type: "relation",
    required: false,
    options: {
      multiple: true,
      targetBaseId: DEMO_FIELD_TYPE_LAB_BASE_ID,
      inverseFieldId: "bsf_lab_relation_self",
    },
  },
  {
    id: "bsf_lab_number",
    slug: "number",
    name: "Number",
    type: "number",
    required: false,
    options: {},
  },
  {
    id: "bsf_lab_date",
    slug: "date",
    name: "Date",
    type: "date",
    required: false,
    options: {},
  },
  {
    id: "bsf_lab_checkbox",
    slug: "checkbox",
    name: "Checkbox",
    type: "checkbox",
    required: false,
    options: {},
  },
  {
    id: "bsf_lab_select",
    slug: "select",
    name: "Select",
    type: "select",
    required: false,
    options: {
      choices: [
        { id: "queued", name: "Queued", color: "slate" },
        { id: "in-review", name: "In review", color: "amber" },
        { id: "approved", name: "Approved", color: "emerald" },
      ],
    },
  },
  {
    id: "bsf_lab_multiselect",
    slug: "multiselect",
    name: "Multiselect",
    type: "multiselect",
    required: false,
    options: {
      choices: [
        { id: "text", name: "Text", color: "slate" },
        { id: "media", name: "Media", color: "violet" },
        { id: "review", name: "Review", color: "emerald" },
      ],
    },
  },
  { id: "bsf_lab_url", slug: "url", name: "URL", type: "url", required: false, options: {} },
  {
    id: "bsf_lab_email",
    slug: "email",
    name: "Email",
    type: "email",
    required: false,
    options: {},
  },
  {
    id: "bsf_lab_phone",
    slug: "phone",
    name: "Phone",
    type: "phone",
    required: false,
    options: {},
  },
  {
    id: "bsf_lab_created_time",
    slug: "created_time",
    name: "Created Time",
    type: "created_time",
    required: false,
    options: {},
  },
  {
    id: "bsf_lab_updated_time",
    slug: "updated_time",
    name: "Updated Time",
    type: "updated_time",
    required: false,
    options: {},
  },
  {
    id: "bsf_lab_created_by",
    slug: "created_by",
    name: "Created By",
    type: "created_by",
    required: false,
    options: {},
  },
  {
    id: "bsf_lab_updated_by",
    slug: "updated_by",
    name: "Updated By",
    type: "updated_by",
    required: false,
    options: {},
  },
  {
    id: "bsf_lab_auto_number",
    slug: "auto_number",
    name: "Auto Number",
    type: "auto_number",
    required: false,
    options: {},
  },
  {
    id: "bsf_lab_ai_summary",
    slug: "ai_summary",
    name: "AI Summary",
    type: "ai_summary",
    required: false,
    options: {
      ai: { model: "gpt-5-mini", reviewRequired: true, sourceFieldIds: ["bsf_lab_markdown"] },
    },
  },
  {
    id: "bsf_lab_ai_tags",
    slug: "ai_tags",
    name: "AI Tags",
    type: "ai_tags",
    required: false,
    options: {
      ai: { model: "gpt-5-mini", reviewRequired: true, sourceFieldIds: ["bsf_lab_markdown"] },
    },
  },
];

// ── CRM bases (Companies / Contacts / Deals) with one-way relations ───────────
const companyFields: SeedFieldDef[] = [
  { id: "bsf_company_name", slug: "name", name: "Name", type: "text", required: true, options: {} },
  {
    id: "bsf_company_logo",
    slug: "logo",
    name: "Logo",
    type: "attachment",
    required: false,
    options: {
      attachment: { maxFiles: 1, allowedMimeTypes: ["image/png", "image/jpeg", "image/svg+xml"] },
    },
  },
  {
    id: "bsf_company_industry",
    slug: "industry",
    name: "Industry",
    type: "select",
    required: false,
    options: {
      choices: [
        { id: "saas", name: "SaaS", color: "violet" },
        { id: "fintech", name: "Fintech", color: "emerald" },
        { id: "ecommerce", name: "E-commerce", color: "amber" },
        { id: "manufacturing", name: "Manufacturing", color: "slate" },
      ],
    },
  },
  {
    id: "bsf_company_website",
    slug: "website",
    name: "Website",
    type: "url",
    required: false,
    options: {},
  },
  {
    id: "bsf_company_employees",
    slug: "employees",
    name: "Employees",
    type: "number",
    required: false,
    options: {},
  },
  {
    id: "bsf_company_status",
    slug: "status",
    name: "Status",
    type: "select",
    required: false,
    options: {
      choices: [
        { id: "lead", name: "Lead", color: "slate" },
        { id: "active", name: "Active", color: "emerald" },
        { id: "churned", name: "Churned", color: "rose" },
      ],
    },
  },
];

const contactFields: SeedFieldDef[] = [
  { id: "bsf_contact_name", slug: "name", name: "Name", type: "text", required: true, options: {} },
  {
    id: "bsf_contact_email",
    slug: "email",
    name: "Email",
    type: "email",
    required: false,
    options: {},
  },
  {
    id: "bsf_contact_phone",
    slug: "phone",
    name: "Phone",
    type: "phone",
    required: false,
    options: {},
  },
  {
    id: "bsf_contact_title",
    slug: "job_title",
    name: "Job Title",
    type: "text",
    required: false,
    options: {},
  },
  {
    id: "bsf_contact_company",
    slug: "company",
    name: "Company",
    type: "relation",
    required: false,
    // Single-link, one-way relation to Companies.
    options: { multiple: false, targetBaseId: DEMO_CRM_COMPANIES_BASE_ID },
  },
  {
    id: "bsf_contact_status",
    slug: "status",
    name: "Status",
    type: "select",
    required: false,
    options: {
      choices: [
        { id: "new", name: "New", color: "slate" },
        { id: "engaged", name: "Engaged", color: "amber" },
        { id: "customer", name: "Customer", color: "emerald" },
      ],
    },
  },
];

const dealFields: SeedFieldDef[] = [
  { id: "bsf_deal_name", slug: "name", name: "Name", type: "text", required: true, options: {} },
  {
    id: "bsf_deal_amount",
    slug: "amount",
    name: "Amount",
    type: "number",
    required: false,
    options: { number: { format: "currency", currency: "USD" } },
  },
  {
    id: "bsf_deal_stage",
    slug: "stage",
    name: "Stage",
    type: "select",
    required: false,
    options: {
      choices: [
        { id: "prospecting", name: "Prospecting", color: "slate" },
        { id: "proposal", name: "Proposal", color: "amber" },
        { id: "won", name: "Won", color: "emerald" },
        { id: "lost", name: "Lost", color: "rose" },
      ],
    },
  },
  {
    id: "bsf_deal_close_date",
    slug: "close_date",
    name: "Close Date",
    type: "date",
    required: false,
    options: {},
  },
  {
    id: "bsf_deal_company",
    slug: "company",
    name: "Company",
    type: "relation",
    required: false,
    options: { multiple: false, targetBaseId: DEMO_CRM_COMPANIES_BASE_ID },
  },
  {
    id: "bsf_deal_contacts",
    slug: "contacts",
    name: "Contacts",
    type: "relation",
    required: false,
    options: { multiple: true, targetBaseId: DEMO_CRM_CONTACTS_BASE_ID },
  },
  {
    id: "bsf_deal_owner",
    slug: "owner",
    name: "Owner",
    type: "text",
    required: false,
    options: {},
  },
];

export const DEMO_BASES: SeedBaseDef[] = [
  {
    id: DEMO_BLOG_BASE_ID,
    nodeId: DEMO_BLOG_BASE_NODE_ID,
    slug: "blog",
    name: "Blog Posts",
    description: "Long-form AI industry analysis and weekly deep dives.",
    folderNodeId: DEMO_CMS_FOLDER_NODE_ID,
    useCases: ["blog", "review-loop", "conflict", "canonical"],
    fields: blogFields,
  },
  {
    id: DEMO_SOCIAL_BASE_ID,
    nodeId: DEMO_SOCIAL_BASE_NODE_ID,
    slug: "social-content",
    name: "Social Content",
    description: "Short-form AI news threads and channel variants.",
    folderNodeId: DEMO_CONTENT_FOLDER_NODE_ID,
    useCases: ["social", "batch-import"],
    fields: socialFields,
  },
  {
    id: DEMO_NEWSLETTER_BASE_ID,
    nodeId: DEMO_NEWSLETTER_BASE_NODE_ID,
    slug: "newsletter",
    name: "Newsletter",
    description: "Curated AI industry briefings for subscribers.",
    folderNodeId: DEMO_CONTENT_FOLDER_NODE_ID,
    useCases: ["newsletter", "media"],
    fields: newsletterFields,
  },
  {
    id: DEMO_MEDIA_ASSETS_BASE_ID,
    nodeId: DEMO_MEDIA_ASSETS_BASE_NODE_ID,
    slug: "media-assets",
    name: "Media Assets",
    description: "Multimodal clips, transcripts, attachments, and usage-rights review.",
    folderNodeId: DEMO_CONTENT_FOLDER_NODE_ID,
    useCases: ["media"],
    fields: mediaAssetFields,
  },
  {
    id: DEMO_FIELD_TYPE_LAB_BASE_ID,
    nodeId: DEMO_FIELD_TYPE_LAB_BASE_NODE_ID,
    slug: "field-type-lab",
    name: "Field Type Lab",
    description: "Seed and demo coverage for every Busabase field type.",
    folderNodeId: DEMO_LAB_FOLDER_NODE_ID,
    useCases: ["field-types"],
    fields: fieldTypeLabFields,
  },
  {
    id: DEMO_CRM_COMPANIES_BASE_ID,
    nodeId: DEMO_CRM_COMPANIES_BASE_NODE_ID,
    slug: "companies",
    name: "Companies",
    description: "CRM accounts — the org each contact and deal links back to.",
    folderNodeId: DEMO_CRM_FOLDER_NODE_ID,
    useCases: ["crm", "operations"],
    fields: companyFields,
  },
  {
    id: DEMO_CRM_CONTACTS_BASE_ID,
    nodeId: DEMO_CRM_CONTACTS_BASE_NODE_ID,
    slug: "contacts",
    name: "Contacts",
    description: "People at accounts; each links to one Company.",
    folderNodeId: DEMO_CRM_FOLDER_NODE_ID,
    useCases: ["crm", "operations"],
    fields: contactFields,
  },
  {
    id: DEMO_CRM_DEALS_BASE_ID,
    nodeId: DEMO_CRM_DEALS_BASE_NODE_ID,
    slug: "deals",
    name: "Deals",
    description: "Opportunities linked to a Company and one or more Contacts.",
    folderNodeId: DEMO_CRM_FOLDER_NODE_ID,
    useCases: ["crm", "operations"],
    fields: dealFields,
  },
  ...FINANCE_BASES,
  ...DIRECTORY_LISTINGS_BASES,
  ...AGENT_INTEGRATIONS_BASES,
  ...CROSS_FUNCTIONAL_BASES,
  ...(readmeScenario.bases ?? []),
];

// ────────────────────────────────────────────────────────────────────────────
// Bulk demo rows — give each scene Base a realistic *page* of records so the demo
// dashboards and marketing screenshots (CRM, blog/content, newsletter, media) are
// not visibly empty. These carry the same `useCases` tags + field shapes as the
// curated rows above, so they flow through `buildDemoDataset()` and the DB seed
// identically. Generated from compact source tuples to stay maintainable.
// ────────────────────────────────────────────────────────────────────────────
const pad3 = (n: number) => String(n).padStart(3, "0");
const pad2 = (n: number) => String(n).padStart(2, "0");
const domainOf = (url: string) => url.replace(/^https?:\/\//, "").replace(/\/$/, "");
const firstName = (full: string) => full.split(" ")[0]?.toLowerCase() ?? "contact";

const bulkCompanyId = (i: number) => `rec_seed_crm_company_bulk_${pad3(i)}`;
const bulkContactId = (i: number) => `rec_seed_crm_contact_bulk_${pad3(i)}`;

interface BulkCompanySrc {
  name: string;
  industry: "saas" | "fintech" | "ecommerce" | "manufacturing";
  website: string;
  employees: number;
  status: "lead" | "active" | "churned";
}

const BULK_COMPANY_SOURCE: BulkCompanySrc[] = [
  {
    name: "Microsoft",
    industry: "saas",
    website: "https://microsoft.com",
    employees: 221000,
    status: "active",
  },
  {
    name: "Google",
    industry: "saas",
    website: "https://google.com",
    employees: 182000,
    status: "active",
  },
  {
    name: "Shopify",
    industry: "ecommerce",
    website: "https://shopify.com",
    employees: 11600,
    status: "active",
  },
  {
    name: "Stripe",
    industry: "fintech",
    website: "https://stripe.com",
    employees: 8000,
    status: "active",
  },
  {
    name: "Salesforce",
    industry: "saas",
    website: "https://salesforce.com",
    employees: 73000,
    status: "active",
  },
  {
    name: "Tesla",
    industry: "manufacturing",
    website: "https://tesla.com",
    employees: 140000,
    status: "active",
  },
  {
    name: "Adobe",
    industry: "saas",
    website: "https://adobe.com",
    employees: 29000,
    status: "lead",
  },
  {
    name: "Amazon",
    industry: "ecommerce",
    website: "https://amazon.com",
    employees: 1540000,
    status: "active",
  },
  {
    name: "PayPal",
    industry: "fintech",
    website: "https://paypal.com",
    employees: 27000,
    status: "active",
  },
  {
    name: "Siemens",
    industry: "manufacturing",
    website: "https://siemens.com",
    employees: 311000,
    status: "lead",
  },
  {
    name: "Atlassian",
    industry: "saas",
    website: "https://atlassian.com",
    employees: 12000,
    status: "active",
  },
  {
    name: "Square",
    industry: "fintech",
    website: "https://squareup.com",
    employees: 12000,
    status: "active",
  },
  {
    name: "Etsy",
    industry: "ecommerce",
    website: "https://etsy.com",
    employees: 2400,
    status: "churned",
  },
  {
    name: "Bosch",
    industry: "manufacturing",
    website: "https://bosch.com",
    employees: 421000,
    status: "active",
  },
  {
    name: "Notion",
    industry: "saas",
    website: "https://notion.so",
    employees: 600,
    status: "active",
  },
  {
    name: "Coinbase",
    industry: "fintech",
    website: "https://coinbase.com",
    employees: 3700,
    status: "lead",
  },
  {
    name: "Wayfair",
    industry: "ecommerce",
    website: "https://wayfair.com",
    employees: 14400,
    status: "active",
  },
  {
    name: "GE Aerospace",
    industry: "manufacturing",
    website: "https://geaerospace.com",
    employees: 52000,
    status: "active",
  },
  {
    name: "Figma",
    industry: "saas",
    website: "https://figma.com",
    employees: 1300,
    status: "active",
  },
  {
    name: "Plaid",
    industry: "fintech",
    website: "https://plaid.com",
    employees: 1200,
    status: "lead",
  },
  {
    name: "eBay",
    industry: "ecommerce",
    website: "https://ebay.com",
    employees: 11000,
    status: "active",
  },
  {
    name: "Caterpillar",
    industry: "manufacturing",
    website: "https://caterpillar.com",
    employees: 113000,
    status: "active",
  },
  {
    name: "Slack",
    industry: "saas",
    website: "https://slack.com",
    employees: 2500,
    status: "active",
  },
  {
    name: "Brex",
    industry: "fintech",
    website: "https://brex.com",
    employees: 1300,
    status: "active",
  },
  {
    name: "Instacart",
    industry: "ecommerce",
    website: "https://instacart.com",
    employees: 3000,
    status: "lead",
  },
  {
    name: "Honeywell",
    industry: "manufacturing",
    website: "https://honeywell.com",
    employees: 97000,
    status: "active",
  },
  {
    name: "Datadog",
    industry: "saas",
    website: "https://datadoghq.com",
    employees: 5000,
    status: "active",
  },
  {
    name: "Ramp",
    industry: "fintech",
    website: "https://ramp.com",
    employees: 1000,
    status: "lead",
  },
];

const BULK_COMPANIES: SeedRecordDef[] = BULK_COMPANY_SOURCE.map((c, i) => {
  const domain = domainOf(c.website);
  return {
    id: bulkCompanyId(i),
    baseId: DEMO_CRM_COMPANIES_BASE_ID,
    commitId: `cmt_seed_crm_company_bulk_${pad3(i)}`,
    fields: {
      name: c.name,
      // Real brand logos enriched from the company's domain (the same move a real
      // CRM would make). Google's favicon service returns a PNG and is reliable;
      // for major brands the favicon IS the logo mark.
      logo: [
        {
          id: `att_company_logo_${pad3(i)}`,
          attachmentId: `att_company_logo_${pad3(i)}`,
          fileName: `${domain}.png`,
          mimeType: "image/png",
          size: 8000 + i * 50,
          url: `https://www.google.com/s2/favicons?domain=${domain}&sz=128`,
        },
      ],
      industry: c.industry,
      website: c.website,
      employees: c.employees,
      status: c.status,
    },
    message: `Seed CRM company ${c.name}`,
    author: "seed-crm",
    minutesAgo: 600 + i * 7,
    useCases: ["crm", "operations"],
  };
});

interface BulkContactSrc {
  name: string;
  title: string;
  status: "new" | "engaged" | "customer";
  company: number;
}

const BULK_CONTACT_SOURCE: BulkContactSrc[] = [
  { name: "Maya Fischer", title: "VP Engineering", status: "customer", company: 0 },
  { name: "Liam Novak", title: "Data Lead", status: "engaged", company: 0 },
  { name: "Priya Raman", title: "CFO", status: "customer", company: 1 },
  { name: "Owen Brooks", title: "Head of Risk", status: "engaged", company: 1 },
  { name: "Sofia Marino", title: "VP Product", status: "new", company: 2 },
  { name: "Ethan Cole", title: "COO", status: "customer", company: 3 },
  { name: "Hannah Reyes", title: "Head of Ops", status: "engaged", company: 3 },
  { name: "Noah Whitman", title: "VP Sales", status: "customer", company: 4 },
  { name: "Aria Bennett", title: "Product Lead", status: "engaged", company: 4 },
  { name: "Marcus Lowe", title: "CTO", status: "new", company: 5 },
  { name: "Elena Popov", title: "Head of Platform", status: "new", company: 6 },
  { name: "Jack Turner", title: "Director of Operations", status: "customer", company: 7 },
  { name: "Nina Costa", title: "Operations Lead", status: "engaged", company: 8 },
  { name: "Ravi Shah", title: "Analytics Manager", status: "new", company: 9 },
  { name: "Grace Holt", title: "Treasury Lead", status: "customer", company: 10 },
  { name: "Felix Yang", title: "Partnerships Lead", status: "new", company: 11 },
  { name: "Dora Klein", title: "Procurement Head", status: "engaged", company: 12 },
  { name: "Sam Ortega", title: "Engineering Manager", status: "customer", company: 13 },
  { name: "Iris Maddox", title: "VP Finance", status: "customer", company: 14 },
  { name: "Theo Walsh", title: "Growth Lead", status: "new", company: 15 },
  { name: "Lena Brandt", title: "Quality Director", status: "engaged", company: 16 },
  { name: "Caleb Frost", title: "Program Director", status: "new", company: 17 },
  { name: "Zoe Aldridge", title: "Head of Payments", status: "customer", company: 18 },
  { name: "Diego Ramos", title: "Partnerships Lead", status: "engaged", company: 19 },
  { name: "Ava Sinclair", title: "VP Operations", status: "customer", company: 21 },
  { name: "Hugo Vance", title: "Account Director", status: "new", company: 22 },
  { name: "Mira Patel", title: "Finance Lead", status: "engaged", company: 23 },
  { name: "Oscar Lind", title: "Systems Director", status: "customer", company: 24 },
  { name: "Tara Quinn", title: "Workspace Admin", status: "new", company: 25 },
  { name: "Victor Hale", title: "VP Engineering", status: "customer", company: 26 },
];

const BULK_CONTACTS: SeedRecordDef[] = BULK_CONTACT_SOURCE.map((c, i) => {
  const company = BULK_COMPANY_SOURCE[c.company];
  return {
    id: bulkContactId(i),
    baseId: DEMO_CRM_CONTACTS_BASE_ID,
    commitId: `cmt_seed_crm_contact_bulk_${pad3(i)}`,
    fields: {
      name: c.name,
      email: `${firstName(c.name)}@${domainOf(company.website)}`,
      phone: `+1-555-1${pad3(i)}`,
      job_title: c.title,
      company: [bulkCompanyId(c.company)],
      status: c.status,
    },
    message: `Seed CRM contact ${c.name}`,
    author: "seed-crm",
    minutesAgo: 560 + i * 6,
    useCases: ["crm", "operations"],
  };
});

const contactsByCompany = new Map<number, number[]>();
for (const [i, c] of BULK_CONTACT_SOURCE.entries()) {
  const list = contactsByCompany.get(c.company) ?? [];
  list.push(i);
  contactsByCompany.set(c.company, list);
}

const DEAL_STAGES = ["prospecting", "proposal", "won", "lost"] as const;
const DEAL_TEMPLATES = [
  "platform rollout",
  "annual renewal",
  "pilot program",
  "seat expansion",
  "security add-on",
  "data migration",
  "onboarding package",
  "enterprise upgrade",
];
const DEAL_OWNERS = ["sales-rep", "account-manager", "growth-rep"];

const BULK_DEALS: SeedRecordDef[] = Array.from({ length: 28 }, (_, i) => {
  const companyIndex = i % BULK_COMPANY_SOURCE.length;
  const company = BULK_COMPANY_SOURCE[companyIndex];
  const template = DEAL_TEMPLATES[i % DEAL_TEMPLATES.length];
  const contactIdx = (contactsByCompany.get(companyIndex) ?? []).slice(0, 2);
  return {
    id: `rec_seed_crm_deal_bulk_${pad3(i)}`,
    baseId: DEMO_CRM_DEALS_BASE_ID,
    commitId: `cmt_seed_crm_deal_bulk_${pad3(i)}`,
    fields: {
      name: `${company.name} ${template}`,
      amount: 8000 + ((i * 7919) % 92) * 1000,
      stage: DEAL_STAGES[i % DEAL_STAGES.length],
      close_date: `2026-${pad2(7 + (i % 5))}-${pad2(1 + (i % 27))}`,
      company: [bulkCompanyId(companyIndex)],
      contacts: contactIdx.map(bulkContactId),
      owner: DEAL_OWNERS[i % DEAL_OWNERS.length],
    },
    message: `Seed CRM deal ${company.name} ${template}`,
    author: "seed-crm",
    minutesAgo: 520 + i * 6,
    useCases: ["crm", "operations"],
  };
});

// ── Blog Posts ───────────────────────────────────────────────────────────────
const BLOG_STATUSES = ["idea", "drafting", "published"] as const;
const BLOG_COVERS = [
  "/assets/readme/scenarios/canonical-base.png",
  "/assets/readme/scenarios/multimodal-review-base.png",
  "/assets/readme/scenarios/multimodal-review-record.png",
  "/assets/readme/busabase-inbox-review.png",
  "/assets/readme/busabase-record-detail-audit.png",
];
interface BulkBlogSrc {
  title: string;
  summary: string;
  /** Real, hand-written article body (markdown). Treated like a published post. */
  body: string;
  tags: string[];
  /** Set true to attach a cover image so the post reads like a finished piece. */
  cover?: boolean;
}
const BULK_BLOG_SOURCE: BulkBlogSrc[] = [
  {
    title: "Why agent evals are the new model benchmark",
    summary: "Buyers now judge agents by task success on their own data, not leaderboard scores.",
    tags: ["agents"],
    cover: true,
    body: "Six months ago every pitch led with a benchmark number. Today the first question in a sales call is different: *will it actually finish my task, on my data, without me babysitting it?*\n\n### Benchmarks measure the model, evals measure the product\n\nMMLU tells you how a model answers trivia. It tells you nothing about whether your agent files the right change request, cites the right source, or knows when to stop. Those are product behaviors, and the only way to measure them is to replay real tasks and score the outcome.\n\n### What a good eval set looks like\n\n- 30–50 real tasks pulled from actual user logs, not synthetic prompts\n- A graded rubric per task: did it succeed, partially succeed, or fail safely?\n- Re-run on every prompt or model change, with the diff visible to the team\n\nThe teams shipping reliable agents treat their eval set like a test suite. It is the artifact that lets them swap models without fear.",
  },
  {
    title: "The review layer is the real moat for AI products",
    summary: "Approval gates between agents and canonical data are becoming the differentiator.",
    tags: ["agents", "policy"],
    cover: true,
    body: "Anyone can wire an LLM to a database. The hard part — and the defensible part — is what happens between the model's output and the row that becomes truth.\n\n### Autonomy without a gate erodes trust fast\n\nThe first time an agent silently overwrites a customer record, the team turns the agent off. Not because the model was bad, but because there was no checkpoint. Trust is not a model property; it is a workflow property.\n\n### The review layer is where products win\n\nWhen every agent write lands as a proposal a human can approve, reject, or edit, three things happen: mistakes become reversible, the audit trail writes itself, and the team stops fearing automation. That review surface — the inbox, the diff, the commit log — is the moat. The model is rented; the review layer is yours.",
  },
  {
    title: "Small models are quietly winning the cost war",
    summary: "Distilled models now cover most production tasks at a fraction of frontier cost.",
    tags: ["agents"],
    body: "The headlines go to frontier models. The invoices tell a different story: most production traffic is quietly migrating down-stack.\n\n### Routine work doesn't need a genius\n\nClassification, extraction, routing, short summaries — these are solved by a small distilled model at a tenth of the cost and a third of the latency. Reserve the expensive model for the hard tail, and route everything else cheaply.\n\n### The pattern that's emerging\n\nA cheap model takes the first pass. A confidence check or a structured-output validator decides whether to escalate. Only the genuinely ambiguous cases reach the frontier model. Costs drop by an order of magnitude and users never notice — because the easy 90% was never the hard part.",
  },
  {
    title: "Retrieval is becoming a product, not a feature",
    summary: "Context pipelines now ship with their own tooling, evals, and dashboards.",
    tags: ["agents"],
    body: '"Just add RAG" was always a lie of omission. The retrieval step is where most AI answers live or die, and teams are finally treating it that way.\n\n### Embeddings are the easy 20%\n\nThe quality of an answer is decided by ranking, filtering, freshness, and chunking long before the model sees a token. Swap a reranker and your accuracy moves more than swapping the LLM.\n\n### What a real retrieval stack now includes\n\n- A retrieval eval set scored independently of the generation step\n- Freshness and source-permission filters applied at query time\n- A dashboard showing which sources actually got cited\n\nRetrieval has its own roadmap, its own metrics, and its own owner. That is what a product looks like.',
  },
  {
    title: "AI video moves from clips to full distribution stacks",
    summary: "Generation is commoditizing; editing, rights, and publishing are the value.",
    tags: ["video"],
    cover: true,
    body: "A year ago the AI video pitch was *better clips*. The clip quality race is mostly over — and it turned out not to be the moat.\n\n### Generation is becoming a commodity\n\nWhen three vendors can produce a comparable ten-second shot, the differentiator moves to everything around the shot: trimming, captioning, brand-safety review, rights tracking, scheduling, and analytics.\n\n### The winners own the loop\n\nCreators don't want a clip; they want a published, on-brand, rights-cleared post. The products pulling ahead connect prompt → review → schedule → measure in one workflow. The model generates; the platform distributes. Distribution is where the retention is.",
  },
  {
    title: "Provenance is turning into a workflow surface",
    summary: "Source receipts and review trails are leaving compliance and entering the UI.",
    tags: ["policy"],
    body: "Provenance used to be an appendix you assembled for an auditor. It is becoming a feature users see every day.\n\n### Readers and regulators want the same thing\n\nBoth want to know how a claim was produced: which source, which version, who approved it. That used to be buried in logs. Now it belongs in the interface, next to the content.\n\n### Designing for visible provenance\n\n- Capture the source link at research time, not as a cleanup step\n- Keep review comments attached to the canonical record, not in a side channel\n- Publish only from approved commits, so the trail is automatic\n\nWhen provenance is a workflow surface instead of a compliance chore, trust stops being a promise and becomes something you can click on.",
  },
  {
    title: "The operator inbox pattern for agent output",
    summary: "Agents propose, humans approve from a single review inbox.",
    tags: ["agents"],
    body: "The most useful agent UI of the last year is not a chat window. It is an inbox.\n\n### Why inbox-first beats chat-first\n\nChat assumes a human is watching in real time. Real operations don't work that way — agents run in the background and a human reviews in batches. An inbox of proposals matches how the work actually happens.\n\n### The shape of the pattern\n\nEvery agent action becomes a proposal with a clear diff. A reviewer triages the queue, approves the obvious ones, edits the borderline ones, and rejects the rest. Autonomy stays useful because control stays cheap. The agent never touches canonical data without a human's name on the approval.",
  },
  {
    title: "Structured output is eating prompt spaghetti",
    summary: "Schema-validated responses replace brittle freeform parsing.",
    tags: ["agents"],
    body: "If your pipeline still parses model output with regex and hope, you are carrying a class of bug that no longer needs to exist.\n\n### A blank page invites chaos\n\nFreeform responses drift in format the moment the prompt or model changes. Every drift is a parsing failure in production, usually discovered by a user.\n\n### Make the model fill a contract\n\nGive the model a schema and force it to return validated JSON. The validation layer retries on mismatch, so malformed output never reaches your code. Reliability rises, the prompt shrinks, and the next engineer can read the contract instead of reverse-engineering a paragraph. Structure is not a constraint on the model — it is the interface to it.",
  },
  {
    title: "What changelogs reveal about AI roadmaps",
    summary: "Release notes are a better signal than keynote demos.",
    tags: ["agents"],
    body: 'Want to know where an AI company is actually going? Skip the keynote and read the changelog.\n\n### Demos are aspiration; changelogs are commitment\n\nA staged demo shows what a team hopes is true. A weekly changelog shows what they were willing to ship and support. The gap between the two is the most honest metric in the industry.\n\n### How to read one\n\n- Cadence: shipping every week signals a healthy loop\n- Direction: are the changes about reliability, or just new surface area?\n- Boring wins: "improved retry handling" beats "introducing magic"\n\nFollow the changelog for a quarter and you\'ll predict the roadmap better than any analyst deck.',
  },
  {
    title: "Memory that survives an audit",
    summary: "Agent memory needs commit trails, not just a vector store.",
    tags: ["agents", "policy"],
    body: 'Every agent framework now ships "memory." Most of it is a vector store with a nice name — and it will not survive the first audit.\n\n### A vector store is recall, not memory\n\nReal memory has to answer a harder question than "what\'s similar?" It has to answer "how did this fact get here, and who approved it?" Similarity search has no answer for that.\n\n### Reviewable memory separates proposals from facts\n\nThe durable pattern keeps a commit trail: an agent proposes a memory, a human approves it, and only then does it become a canonical fact the agent can rely on. The rejected proposals stay in the history, not in the working set. When someone asks why the agent believed something, you can show them the receipt.',
  },
  {
    title: "Pricing AI features without lighting money on fire",
    summary: "Usage-based pricing aligns cost with the inference each user triggers.",
    tags: ["policy"],
    body: "The fastest way to lose money on an AI feature is to price it like a SaaS seat while paying for it like a utility.\n\n### Flat tiers break under heavy users\n\nInference cost is variable and per-action. A flat $20 seat looks fine until one power user runs ten thousand agent tasks a month and quietly turns your margin negative.\n\n### Align price with the work\n\nMeter the thing that actually costs you: tokens, tasks, or approved actions. Bundle a generous free allowance so casual users feel no friction, then charge for volume past it. The bill scales with the value delivered, and your heaviest users — the ones most likely to churn if you cap them — pay for what they use instead of leaving.",
  },
  {
    title: "The quiet rise of agent middleware",
    summary: "Routing, retries, and guardrails are consolidating into a shared layer.",
    tags: ["agents"],
    body: "Every team building agents rebuilds the same plumbing: model routing, retries, rate limits, structured-output validation, and guardrails. That duplicated work is consolidating into a layer.\n\n### The plumbing was never the product\n\nNobody differentiates on retry logic. Yet every product reimplemented it, badly, because there was nowhere else to put it.\n\n### What the middleware layer absorbs\n\n- Routing the cheap model first, escalating only when needed\n- Validating and retrying structured output before it reaches your code\n- Enforcing guardrails and budgets in one place instead of per call site\n\nWhen this layer matures, teams stop maintaining plumbing and start shipping behavior. That is the boring infrastructure that quietly makes the whole category faster.",
  },
  {
    title: "Why your AI demo lies to you",
    summary: "Happy-path demos hide the failure modes buyers actually hit.",
    tags: ["agents"],
    body: "The demo worked perfectly. The pilot fell apart in week two. This is the most common story in enterprise AI, and it is structural, not bad luck.\n\n### Demos are auditions for the happy path\n\nA demo is curated: the right question, clean data, a rehearsed flow. Real usage is messy input, ambiguous intent, and the long tail the demo carefully avoided.\n\n### Sell the recovery, not the magic\n\nThe honest demo shows what happens when the model is wrong: how the user notices, how they undo it, how the system escalates. Buyers who have been burned don't want to see the magic moment again — they want to see the failure handled gracefully. Show them that, and you'll close the ones the magic demo lost.",
  },
  {
    title: "Human-in-the-loop is a feature, not a fallback",
    summary: "The best products design the approval step on purpose.",
    tags: ["agents", "policy"],
    body: '"Human-in-the-loop" is often code for "the automation isn\'t good enough yet." The best teams have inverted that: the human step is a designed feature, not an apology.\n\n### Friction in the right place\n\nA well-placed approval removes friction everywhere else. Because a human signs off on the risky one percent, everyone trusts the automated ninety-nine. Remove the checkpoint and the trust goes with it.\n\n### Design the loop, don\'t bolt it on\n\nDecide which actions are reversible enough to auto-apply and which deserve a human\'s name. Make the review fast — a clear diff, one click to approve. Done well, the loop is invisible when it should be and present exactly when it matters. That is a feature people pay for.',
  },
  {
    title: "Data labeling is becoming continuous, not batch",
    summary: "Feedback loops label data while the product runs.",
    tags: ["agents"],
    body: "The annotation sprint — ship a batch to labelers, wait two weeks, get a dataset — is giving way to something that never stops.\n\n### Batch labeling is always stale\n\nBy the time a labeled batch comes back, the product has moved and the distribution has shifted. You trained on last month's reality.\n\n### Label as the product runs\n\nEvery correction a reviewer makes in production is a label. Every approved or rejected agent proposal is a graded example. Captured into a dataset, these become a continuous stream that tracks real usage instead of a snapshot of it. The labeling queue stops being a one-time project and becomes a living feedback loop — and the model improves on the cases users actually hit.",
  },
  {
    title: "The case for boring, reliable agents",
    summary: "Predictable agents beat flashy ones in real operations.",
    tags: ["agents"],
    body: "The agent that wins the demo is rarely the agent that survives in production. Operators reward a different trait: predictability.\n\n### Brilliance is volatile\n\nAn agent that dazzles four times and does something bizarre the fifth is unusable for real work. One unpredictable action poisons trust in the other four.\n\n### Boring is a competitive advantage\n\nAn agent that does the same correct thing every time, escalates cleanly when unsure, and never surprises you is the one teams actually deploy. It is less impressive in a keynote and far more valuable on a Tuesday. The goal is not an agent that can do anything; it is an agent you can rely on. Boring scales. Flashy gets switched off.",
  },
  {
    title: "How regulation is reshaping AI content",
    summary: "Disclosure and provenance rules are landing in product workflows.",
    tags: ["policy"],
    body: "Regulation around AI content is moving from think-pieces into product requirements, and it is landing earlier in the workflow than most teams expected.\n\n### Compliance is moving upstream\n\nDisclosure and provenance can't be a publish-time checkbox. To label content honestly, you need to know how it was produced — which means capturing that signal during creation, not bolting it on at the end.\n\n### What this means for content tools\n\n- Track which parts of a draft were AI-generated as they're written\n- Keep the source and the human approval attached to the record\n- Make disclosure a property of the content, not a manual afterthought\n\nThe teams treating provenance as a workflow primitive now will adapt to whatever the rules become. The ones treating it as paperwork will be retrofitting under deadline.",
  },
  {
    title: "Vector search alone won't save your RAG",
    summary: "Ranking, filtering, and freshness matter as much as embeddings.",
    tags: ["agents"],
    body: "Teams keep blaming the model for RAG failures when the real culprit is usually one step earlier: retrieval returned the wrong context.\n\n### Good retrieval is an engineering problem\n\nThe embedding model gets you in the neighborhood. Getting the *right* passage to the top is ranking, filtering, deduplication, and freshness — classic information-retrieval work that no embedding upgrade replaces.\n\n### Where the wins actually come from\n\n- A reranker over the top candidates, scored against a retrieval eval set\n- Permission and freshness filters so stale or off-limits sources never surface\n- Chunking tuned to how your documents are actually structured\n\nUpgrade the model and your answer improves a little. Fix retrieval and it improves a lot. Spend your time where the leverage is.",
  },
  {
    title: "The agent that knows when to stop",
    summary: "Knowing when to hand back to a human is a core skill.",
    tags: ["agents"],
    body: "We spend enormous effort teaching agents to act. The harder, more valuable skill is teaching them when not to.\n\n### Escalation is a design surface\n\nAn agent that pushes through every ambiguous case is a liability. The good ones recognize the edge of their competence and hand the decision back — with context — before doing damage.\n\n### Make stopping a first-class behavior\n\nDefine the conditions that trigger a handoff: low confidence, a high-impact action, a missing permission. When one fires, the agent files a clear proposal for a human instead of guessing. The result feels less autonomous and is far more trustworthy. An agent you can hand a risky task to — knowing it will stop and ask — is worth more than one that never pauses.",
  },
  {
    title: "Why content teams are adopting databases",
    summary: "Editorial calendars are turning into reviewable, auditable bases.",
    tags: ["policy"],
    body: "The editorial calendar in a spreadsheet is quietly being replaced by something that looks a lot more like a database — and the reason is AI.\n\n### A spreadsheet can't review agent work\n\nOnce drafts, summaries, and tags are produced by agents, the team needs more than cells. They need to see what an agent proposed, approve it, and keep the source attached to the piece.\n\n### Posts, sources, and approvals in one place\n\nA content base holds the draft, its sources, its status, and its review history together. Agent proposals land as change requests; editors approve from an inbox; published pieces trace back to approved commits. The calendar becomes auditable. For a team where AI touches every draft, that auditability is the difference between using agents and trusting them.",
  },
  {
    title: "Multimodal review is the next frontier",
    summary: "Clips and transcripts need the same approval rigor as text.",
    tags: ["video"],
    cover: true,
    body: "We've built decent habits for reviewing AI text. Clips, frames, and transcripts are still going out the door with far less scrutiny — and that gap is about to matter.\n\n### Media carries more risk, not less\n\nA generated clip raises usage rights, likeness, and brand-safety questions a paragraph never does. Yet most pipelines approve video with a glance and approve text with a process.\n\n### Bring media into the review loop\n\n- Attach the transcript and detected objects to the asset record\n- Make usage-rights status a required field before publish\n- Route clips through the same approval inbox as everything else\n\nMultimodal review isn't a special case; it's the same discipline applied to richer content. The teams extending their review loop to media now will avoid the rights cleanup everyone else is heading toward.",
  },
  {
    title: "Shipping AI features your support team can trust",
    summary: "Visible reasoning and edit history reduce support load.",
    tags: ["agents"],
    body: "An AI feature isn't done when it works. It's done when your support team can explain it to an angry customer — and that's a different bar.\n\n### Unexplainable answers become tickets\n\nWhen a user asks \"why did it say that?\" and support has no answer, the feature generates load instead of removing it. A black box is a support liability no matter how good its average output.\n\n### Make answers explainable after the fact\n\nKeep the sources, the version, and the edit history attached to every AI output. When a question comes in, support can show exactly what happened and what changed. Explainability isn't a compliance nicety — it's what lets the people defending your product actually defend it. Trust scales when answers can be reconstructed, not just produced.",
  },
  {
    title: "The end of the all-knowing chatbot",
    summary: "Scoped, task-shaped agents are replacing the do-everything bot.",
    tags: ["agents"],
    body: "The fantasy of one chatbot that does everything is fading, and good riddance. The thing replacing it is less impressive and far more useful: narrow agents shaped to a task.\n\n### Do-everything means evaluate-nothing\n\nAn agent with unbounded scope is impossible to test. You can't write an eval set for \"anything,\" so you ship on vibes and discover the failures in production.\n\n### Scoped agents are trustworthy agents\n\nGive an agent one job — triage this queue, draft this section, reconcile these records — and you can define success, measure it, and trust it. A handful of well-scoped agents, each with its own eval set and review loop, beats one omniscient bot you can't reason about. The future is many small agents, not one large oracle.",
  },
  {
    title: "Audit trails are a growth feature",
    summary: "Enterprises buy the products that can prove what happened.",
    tags: ["agents", "policy"],
    body: "Engineers think of audit trails as compliance overhead. Sales teams who've worked enterprise deals know better: the audit trail is often what closes them.\n\n### Security gates the purchase\n\nIn any serious deal, a security review asks one question in many forms: can you prove what your system did, who did it, and when? A product with a clean commit log answers instantly. A product without one stalls in procurement for months.\n\n### Turn the trail into a selling point\n\nWhen every change — human or agent — is logged, reversible, and attributable, you don't just pass the review; you lead with it. \"Every write is auditable\" is a feature buyers in regulated industries actively search for. The trail you built for safety turns out to be a growth lever.",
  },
  {
    title: "Designing for graceful AI failure",
    summary: "The recovery experience matters more than peak accuracy.",
    tags: ["agents"],
    body: "Chasing the last point of accuracy is tempting and mostly wasted. Users don't remember your benchmark; they remember what happened the time it was wrong.\n\n### Failure is a UX problem, not just a model problem\n\nEvery model fails sometimes. What separates a trusted product from an abandoned one is whether the failure was visible, reversible, and recoverable — or silent and destructive.\n\n### Make mistakes cheap to undo\n\n- Show the agent's output as a proposal, not a fait accompli\n- Keep an undo path and a clear edit history\n- Surface uncertainty instead of hiding it behind false confidence\n\nUsers forgive mistakes they can see and reverse. They don't forgive a system that quietly did the wrong thing. Spend less effort on peak accuracy and more on graceful recovery; that's where trust is actually won.",
  },
  {
    title: "From notes app to research desk",
    summary: "Solo creators are building newsroom-grade review pipelines.",
    tags: ["agents"],
    body: "The solo AI creator's stack is quietly evolving from a notes app into something that looks like a small newsroom.\n\n### A notes app can't hold agent output\n\nWhen agents do your research, drafting, and source-checking, a flat pile of notes stops working. You need to separate what an agent *proposed* from what you've *verified* — and a notes app has no concept of that distinction.\n\n### The research-desk pattern\n\nProposals land in an inbox. Approved insights become canonical records with their sources attached. An activity trail shows what changed and when. It's the same discipline a newsroom uses to keep claims honest, scaled down to one person and a few agents. The creators treating their stack like a research desk — change requests, canonical records, review trails — are the ones whose output you can actually trust.",
  },
];

const BULK_BLOGS: SeedRecordDef[] = BULK_BLOG_SOURCE.map((b, i) => {
  const status = BLOG_STATUSES[i % BLOG_STATUSES.length];
  return {
    id: `rec_seed_blog_bulk_${pad3(i)}`,
    baseId: DEMO_BLOG_BASE_ID,
    commitId: `cmt_seed_blog_bulk_${pad3(i)}`,
    fields: {
      title: b.title,
      cover_image: [
        {
          id: `att_blog_bulk_cover_${pad3(i)}`,
          attachmentId: `att_blog_bulk_cover_${pad3(i)}`,
          fileName: `${b.title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.png`,
          mimeType: "image/png",
          size: 180000 + i * 1200,
          url: BLOG_COVERS[i % BLOG_COVERS.length],
        },
      ],
      body: b.body,
      ai_summary: b.summary,
      ai_tags: b.tags,
      channel: "blog",
      contact_email: "editorial@busabase.local",
      contact_phone: `+1-555-2${pad3(i)}`,
      priority: (i % 5) + 1,
      publish_date: `2026-${pad2(1 + (i % 6))}-${pad2(1 + (i % 27))}`,
      ready: status === "published",
      source_url: `https://example.com/ai/${i}`,
      status,
      tags: b.tags,
    },
    message: `Seed blog backlog: ${b.title}`,
    author: "seed-editor",
    minutesAgo: 300 + i * 9,
    createdTimeSlug: "created_time",
    // also surface in the "canonical records" scenario so its Blog Posts base
    // isn't down to a single approved record
    useCases: ["blog", "canonical"],
  };
});

// ── Social Content ─────────────────────────────────────────────────────────--
const SOCIAL_CHANNELS = ["x", "linkedin", "threads", "reddit", "mastodon"];
const BULK_SOCIAL_SOURCE: Array<{ title: string; body: string }> = [
  {
    title: "3 signals from this week in AI",
    body: "1. Evals beat benchmarks. 2. Review layers win deals. 3. Small models cover most tasks.",
  },
  {
    title: "Hot take: the demo is not the product",
    body: "If your demo only shows the happy path, you are selling a screenshot, not a workflow.",
  },
  {
    title: "Agents need an inbox",
    body: "The teams shipping real agent products give humans one place to approve or reject proposals.",
  },
  {
    title: "Provenance is a feature now",
    body: "Source receipts are moving out of compliance docs and into the editing UI.",
  },
  {
    title: "Why we love boring agents",
    body: "Predictable beats brilliant when the agent touches your production database.",
  },
  {
    title: "Structured output > prompt spaghetti",
    body: "Make the model fill a schema and watch your parsing bugs disappear.",
  },
  {
    title: "RAG is an engineering problem",
    body: "Ranking, freshness, and filtering matter as much as your embedding model.",
  },
  {
    title: "Changelogs > keynotes",
    body: "Watch what ships every week, not what gets promised on stage.",
  },
  {
    title: "The approval step is the moat",
    body: "A clean human checkpoint is what turns autonomy into trust.",
  },
  {
    title: "Memory needs a commit trail",
    body: "A vector store is not memory if you cannot audit how a fact got there.",
  },
  {
    title: "Pricing AI is hard",
    body: "Flat tiers break the second a power user shows up. Meter the inference.",
  },
  {
    title: "Multimodal review is next",
    body: "Clips and transcripts deserve the same approval rigor as text.",
  },
  {
    title: "Scoped agents win",
    body: "The do-everything bot is losing to narrow, evaluable, task-shaped agents.",
  },
  {
    title: "Audit trails close enterprise deals",
    body: "Security teams gate on 'can you prove what happened'. A clean history answers it.",
  },
  {
    title: "Design for graceful failure",
    body: "Users forgive mistakes they can see and undo. Hide them and you lose trust.",
  },
  {
    title: "Content teams are adopting databases",
    body: "Editorial calendars are turning into reviewable, auditable bases.",
  },
  {
    title: "Retrieval is a product",
    body: "Context pipelines now ship with their own tooling, evals, and dashboards.",
  },
  {
    title: "Know when to stop",
    body: "The best agents hand risky calls back to a human on purpose.",
  },
  {
    title: "Human-in-the-loop on purpose",
    body: "Friction in the right place builds trust everywhere else.",
  },
  {
    title: "Labeling is continuous now",
    body: "Feedback loops label your data while the product runs.",
  },
  {
    title: "From notes app to research desk",
    body: "Solo creators are building newsroom-grade pipelines with change requests.",
  },
  {
    title: "Support trusts explainable AI",
    body: "Visible reasoning and edit history cut your support load.",
  },
];

const BULK_SOCIAL: SeedRecordDef[] = BULK_SOCIAL_SOURCE.map((s, i) => ({
  id: `rec_seed_social_bulk_${pad3(i)}`,
  baseId: DEMO_SOCIAL_BASE_ID,
  commitId: `cmt_seed_social_bulk_${pad3(i)}`,
  fields: {
    title: s.title,
    body: s.body,
    channel: SOCIAL_CHANNELS[i % SOCIAL_CHANNELS.length],
  },
  message: `Seed social backlog: ${s.title}`,
  author: "seed-editor",
  minutesAgo: 280 + i * 8,
  useCases: ["social"],
}));

// ── Newsletter ─────────────────────────────────────────────────────────────--
const BULK_NEWSLETTER_SOURCE: Array<{ title: string; audience: string; lead: string }> = [
  {
    title: "AI briefing #12: evals everywhere",
    audience: "AI operators",
    lead: "Why task-level evals are replacing leaderboard scores in buyer conversations.",
  },
  {
    title: "AI briefing #13: the review economy",
    audience: "AI founders",
    lead: "Approval gates are becoming the most defensible part of agent products.",
  },
  {
    title: "AI briefing #14: small model surge",
    audience: "Engineering leads",
    lead: "Distilled models are covering most production tasks at a fraction of the cost.",
  },
  {
    title: "AI briefing #15: retrieval as a product",
    audience: "AI builders",
    lead: "Context pipelines now ship with their own evals and dashboards.",
  },
  {
    title: "AI briefing #16: video distribution stacks",
    audience: "Creators and marketers",
    lead: "Generation is commoditizing; editing and publishing are the value.",
  },
  {
    title: "AI briefing #17: provenance in the UI",
    audience: "Policy-curious operators",
    lead: "Source receipts are moving from compliance docs into the product.",
  },
  {
    title: "AI briefing #18: the operator inbox",
    audience: "Product teams",
    lead: "Inbox-first review keeps agent autonomy useful without losing control.",
  },
  {
    title: "AI briefing #19: structured output wins",
    audience: "Engineering leads",
    lead: "Schema-validated responses are killing brittle freeform parsing.",
  },
  {
    title: "AI briefing #20: memory you can audit",
    audience: "AI operators",
    lead: "Reviewable memory separates proposals from canonical facts.",
  },
  {
    title: "AI briefing #21: pricing the inference",
    audience: "Founders and finance",
    lead: "Usage-based pricing aligns cost with the work the model actually does.",
  },
  {
    title: "AI briefing #22: multimodal review",
    audience: "Content and legal teams",
    lead: "Clips and transcripts need the same approval rigor as text.",
  },
  {
    title: "AI briefing #23: boring reliable agents",
    audience: "Operations leaders",
    lead: "Predictable agents beat flashy ones once they touch production data.",
  },
];

const BULK_NEWSLETTERS: SeedRecordDef[] = BULK_NEWSLETTER_SOURCE.map((n, i) => ({
  id: `rec_seed_newsletter_bulk_${pad3(i)}`,
  baseId: DEMO_NEWSLETTER_BASE_ID,
  commitId: `cmt_seed_newsletter_bulk_${pad3(i)}`,
  fields: {
    title: n.title,
    body: `<article><h2>${n.title}</h2><p>${n.lead}</p><ul><li>Reviewable agent workflows</li><li>Source-disciplined research</li><li>Trust as a product surface</li></ul></article>`,
    audience: n.audience,
  },
  message: `Seed newsletter backlog: ${n.title}`,
  author: "seed-editor",
  minutesAgo: 260 + i * 10,
  useCases: ["newsletter", "media"],
}));

// ── Media Assets ─────────────────────────────────────────────────────────────
const MEDIA_ASSET_URLS = [
  "/assets/readme/busabase-inbox-review.png",
  "/assets/readme/scenarios/multimodal-review-base.png",
  "/assets/readme/scenarios/canonical-base.png",
  "/assets/readme/busabase-record-detail-audit.png",
  "/assets/readme/scenarios/multimodal-review-record.png",
];
const MEDIA_REVIEW = ["queued", "in-review", "approved"] as const;
const MEDIA_RIGHTS = ["approved", "needs-review", "restricted"] as const;
const MEDIA_OBJECT_SETS: string[][] = [
  ["dashboard"],
  ["human-review"],
  ["agent-output"],
  ["dashboard", "human-review"],
  ["agent-output", "dashboard"],
];
const BULK_MEDIA_SOURCE: Array<{ title: string; scene: string }> = [
  {
    title: "Inbox review walkthrough",
    scene: "A reviewer triages agent proposals in the approval inbox.",
  },
  {
    title: "Field-level diff demo",
    scene: "Close-up of a record_update diff showing before and after values.",
  },
  {
    title: "Canonical base overview",
    scene: "Pan across an approved base with filtered table views.",
  },
  {
    title: "Audit timeline capture",
    scene: "Activity feed scrolling through commits and reviews.",
  },
  { title: "Batch import preview", scene: "Multiple records proposed in a single change request." },
  {
    title: "Conflict resolution clip",
    scene: "Reviewer resolves a stale base commit during merge.",
  },
  {
    title: "Multimodal record detail",
    scene: "Attachment, transcript, and tags shown on one record.",
  },
  {
    title: "Newsletter compose flow",
    scene: "HTML newsletter assembled from approved source posts.",
  },
  {
    title: "Skill publish demo",
    scene: "A workspace skill is versioned and published from the panel.",
  },
  { title: "Search across bases", scene: "Global search returning records from several bases." },
  {
    title: "Mobile review handoff",
    scene: "Approval handed off and confirmed on a phone-sized layout.",
  },
  {
    title: "Dashboard metrics tour",
    scene: "Record, change request, and operation counts on the dashboard.",
  },
];

const BULK_MEDIA: SeedRecordDef[] = BULK_MEDIA_SOURCE.map((m, i) => ({
  id: `rec_seed_media_bulk_${pad3(i)}`,
  baseId: DEMO_MEDIA_ASSETS_BASE_ID,
  commitId: `cmt_seed_media_bulk_${pad3(i)}`,
  fields: {
    title: m.title,
    asset: [
      {
        id: `att_seed_media_bulk_${pad3(i)}`,
        attachmentId: `att_seed_media_bulk_${pad3(i)}`,
        fileName: `${m.title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.png`,
        mimeType: "image/png",
        size: 120000 + i * 1500,
        url: MEDIA_ASSET_URLS[i % MEDIA_ASSET_URLS.length],
      },
    ],
    detected_objects: MEDIA_OBJECT_SETS[i % MEDIA_OBJECT_SETS.length],
    review_status: MEDIA_REVIEW[i % MEDIA_REVIEW.length],
    scene_description: m.scene,
    transcript: `00:00 ${m.scene}`,
    usage_rights: MEDIA_RIGHTS[i % MEDIA_RIGHTS.length],
  },
  message: `Seed media backlog: ${m.title}`,
  author: "seed-media",
  minutesAgo: 240 + i * 11,
  useCases: ["media"],
}));

export const DEMO_RECORDS: SeedRecordDef[] = [
  {
    id: BLOG_APPROVAL_RECORD_ID,
    baseId: DEMO_BLOG_BASE_ID,
    commitId: BLOG_APPROVAL_COMMIT_ID,
    fields: {
      title: "AI agents are moving from demos into operator workflows",
      cover_image: [
        {
          id: "att_blog_cover_agents",
          attachmentId: "att_blog_cover_agents",
          fileName: "ai-agents-cover.png",
          mimeType: "image/png",
          size: 220000,
          url: "/assets/readme/scenarios/canonical-base.png",
        },
      ],
      body: "## From demos to operator workflows\n\nThe useful signal this week is not another model benchmark. It is the shift from chat-style demos into **agent workflows** that can research, prepare drafts, check sources, and prepare content for human approval.\n\n### Why this matters\n\nWhen agents write to shared databases without a gate, trust erodes fast. The teams shipping production agent workflows are learning that the approval layer — the human checkpoint before writes become canonical — is the differentiator.\n\n### What to watch\n\n- Change Requests over direct mutations\n- Inbox-first review patterns\n- Commit trails that survive audits\n\nThe database is not just storage anymore. It is the trust surface.",
      ai_summary: "Agent products are shifting from demos toward reviewable operator workflows.",
      ai_tags: ["agents", "workflow", "trust"],
      channel: "blog",
      contact_email: "editor@busabase.local",
      contact_phone: "+1-555-0101",
      priority: 1,
      publish_date: "2026-06-10",
      ready: true,
      related_social: [SOCIAL_THREAD_RECORD_ID],
      source_url: "https://example.com/ai-agent-workflows",
      status: "published",
      tags: ["agents", "policy"],
    },
    message: "Seed canonical AI industry analysis",
    author: "seed-editor",
    minutesAgo: 180,
    createdTimeSlug: "created_time",
    useCases: ["blog", "review-loop", "conflict", "canonical"],
  },
  {
    id: BLOG_PRIVATE_RECORD_ID,
    baseId: DEMO_BLOG_BASE_ID,
    commitId: BLOG_PRIVATE_COMMIT_ID,
    fields: {
      title: "AI video tools are becoming distribution products",
      cover_image: [
        {
          id: "att_blog_cover_video",
          attachmentId: "att_blog_cover_video",
          fileName: "video-tools-cover.png",
          mimeType: "image/png",
          size: 190000,
          url: "/assets/readme/scenarios/multimodal-review-base.png",
        },
      ],
      body: "## Video tools are becoming distribution stacks\n\nThe video model race is no longer only about clip quality. The stronger products connect generation, editing, brand safety, publishing, and analytics into **one creator workflow**.\n\n### The shift\n\nA year ago the pitch was *better clips*. Now the pitch is *integrated distribution*. Teams that only have generation are losing deals to teams that have generation + review + scheduling + analytics in a single loop.\n\n### What this means for AI bloggers\n\nIf you cover AI video, the story is no longer about models. It is about which company built the most defensible distribution moat. The generation is becoming a commodity. The editorial control layer is where trust forms.\n\n> For creators, the question is not which model generates the best clips — it is which platform lets them review, approve, and publish without leaving their workflow.",
      ai_summary: "Video generation tools are becoming full creator distribution workflows.",
      ai_tags: ["video", "distribution"],
      channel: "blog",
      contact_email: "video-desk@busabase.local",
      contact_phone: "+1-555-0102",
      priority: 2,
      publish_date: "2026-06-11",
      ready: false,
      source_url: "https://example.com/ai-video-distribution",
      status: "drafting",
      tags: ["video"],
    },
    message: "Seed AI video market analysis",
    author: "seed-editor",
    minutesAgo: 170,
    createdTimeSlug: "created_time",
    useCases: ["blog"],
  },
  {
    id: SOCIAL_THREAD_RECORD_ID,
    baseId: DEMO_SOCIAL_BASE_ID,
    commitId: SOCIAL_THREAD_COMMIT_ID,
    fields: {
      title: "Thread: what this week's AI agent news actually means",
      body: "The pattern is clear: agent products are being judged less by autonomy claims and more by whether they fit into daily knowledge work without breaking trust.",
      channel: "x",
      related_blogs: [BLOG_APPROVAL_RECORD_ID],
    },
    message: "Seed AI news social thread",
    author: "seed-editor",
    minutesAgo: 160,
    useCases: ["social", "batch-import"],
  },
  {
    id: SOCIAL_STALE_RECORD_ID,
    baseId: DEMO_SOCIAL_BASE_ID,
    commitId: SOCIAL_STALE_COMMIT_ID,
    fields: {
      title: "Old take: model size is the whole story",
      body: "This older post over-emphasizes parameter count and misses the current product shift toward workflows, evals, distribution, and trusted review loops.",
      channel: "linkedin",
      related_blogs: [BLOG_PRIVATE_RECORD_ID],
    },
    message: "Seed stale AI take",
    author: "seed-editor",
    minutesAgo: 150,
    useCases: ["social", "batch-import"],
  },
  {
    id: NEWSLETTER_RECORD_ID,
    baseId: DEMO_NEWSLETTER_BASE_ID,
    commitId: NEWSLETTER_COMMIT_ID,
    fields: {
      title: "Weekly AI briefing: agents, video, and regulation",
      body: "<article><h2>Weekly AI briefing</h2><p>This issue tracks three signals for readers: agentic workflows becoming productized, video generation moving into creator operations, and policy pressure increasing around provenance.</p><ul><li>Agents are moving into reviewable workflows.</li><li>Video tools are becoming distribution systems.</li><li>Trust depends on source discipline.</li></ul></article>",
      audience: "AI founders and operators",
      source_posts: [BLOG_APPROVAL_RECORD_ID, BLOG_PRIVATE_RECORD_ID],
    },
    message: "Seed weekly AI briefing",
    author: "seed-editor",
    minutesAgo: 140,
    useCases: ["newsletter", "media"],
  },
  {
    id: NEWSLETTER_REGULATION_RECORD_ID,
    baseId: DEMO_NEWSLETTER_BASE_ID,
    commitId: NEWSLETTER_REGULATION_COMMIT_ID,
    fields: {
      title: "AI policy watch: provenance is becoming a product feature",
      body: "<article><h2>AI policy watch</h2><p>The practical takeaway is that provenance is moving from compliance appendix into product workflow. Teams that publish AI research need review trails, source receipts, and visible human approval before claims go out.</p><blockquote>For operators, trust is becoming a workflow surface.</blockquote><ol><li>Capture source links during research.</li><li>Keep review comments attached to the canonical record.</li><li>Publish only from approved commits.</li></ol></article>",
      audience: "AI operators and policy-curious founders",
      source_posts: [BLOG_APPROVAL_RECORD_ID],
    },
    message: "Seed AI policy HTML newsletter",
    author: "seed-editor",
    minutesAgo: 132,
    useCases: ["newsletter", "media"],
  },
  {
    id: NEWSLETTER_STACK_RECORD_ID,
    baseId: DEMO_NEWSLETTER_BASE_ID,
    commitId: NEWSLETTER_STACK_COMMIT_ID,
    fields: {
      title: "Creator stack memo: agents need reviewable memory",
      body: "<article><h2>Creator stack memo</h2><p>AI industry bloggers are starting to behave like small research desks. The stack is no longer just notes plus a scheduler; it needs a reviewable knowledge base that separates change requests from canonical records.</p><table><thead><tr><th>Layer</th><th>What it should store</th></tr></thead><tbody><tr><td>Inbox</td><td>Agent proposals and batch edits</td></tr><tr><td>Base</td><td>Approved reusable insights</td></tr><tr><td>Activity</td><td>Commit and review timeline</td></tr></tbody></table></article>",
      audience: "solo AI creators",
      source_posts: [BLOG_APPROVAL_RECORD_ID],
    },
    message: "Seed creator stack HTML memo",
    author: "seed-editor",
    minutesAgo: 124,
    useCases: ["newsletter", "media"],
  },
  {
    id: MEDIA_CLIP_RECORD_ID,
    baseId: DEMO_MEDIA_ASSETS_BASE_ID,
    commitId: MEDIA_CLIP_COMMIT_ID,
    fields: {
      title: "Dashboard walkthrough clip: approval inbox",
      asset: [
        {
          id: "att_seed_dashboard_clip",
          attachmentId: "att_seed_dashboard_clip",
          fileName: "approval-inbox-walkthrough.mp4",
          mimeType: "video/mp4",
          size: 8_241_336,
          url: "/assets/readme/busabase-inbox-review.png",
        },
        {
          id: "att_seed_transcript",
          attachmentId: "att_seed_transcript",
          fileName: "approval-inbox-transcript.vtt",
          mimeType: "text/vtt",
          size: 18_432,
          url: "/assets/readme/busabase-record-detail-audit.png",
        },
      ],
      detected_objects: ["dashboard", "human-review", "agent-output"],
      review_status: "approved",
      scene_description:
        "A reviewer opens the Busabase inbox, inspects an agent proposal, and confirms the change before it reaches the canonical base.",
      transcript:
        "00:00 Reviewer opens the inbox.\\n00:08 Agent proposal appears with field-level diffs.\\n00:16 Human approves the trusted record.",
      usage_rights: "approved",
    },
    message: "Seed multimodal asset with attachments",
    author: "seed-media",
    minutesAgo: 122,
    useCases: ["media"],
  },
  {
    id: FIELD_TYPE_LAB_RECORD_ID,
    baseId: DEMO_FIELD_TYPE_LAB_BASE_ID,
    commitId: FIELD_TYPE_LAB_COMMIT_ID,
    fields: {
      ai_summary: "A single seeded record exercises every Busabase field type.",
      ai_tags: ["field-types", "coverage", "seed"],
      attachment: [
        {
          id: "att_seed_field_lab_png",
          attachmentId: "att_seed_field_lab_png",
          fileName: "field-type-lab.png",
          mimeType: "image/png",
          size: 142_336,
          url: "/assets/readme/scenarios/multimodal-review-base.png",
        },
        {
          id: "att_seed_field_lab_notes",
          attachmentId: "att_seed_field_lab_notes",
          fileName: "field-type-lab-notes.md",
          mimeType: "text/markdown",
          size: 4_096,
          url: "/assets/readme/scenarios/multimodal-review-record.png",
        },
      ],
      auto_number: 1001,
      checkbox: true,
      created_by: DEMO_ACTOR_ID,
      date: "2026-06-21",
      email: "qa@busabase.local",
      html: "<section><strong>HTML preview</strong><p>Rendered safely in field previews.</p></section>",
      code_json:
        '{\n  "model": "gpt-5-mini",\n  "temperature": 0.3,\n  "max_tokens": 2048,\n  "stream": true\n}',
      code_yaml:
        "model: gpt-5-mini\ntemperature: 0.3\nmax_tokens: 2048\nstream: true\nretry:\n  attempts: 3\n  delay_ms: 500",
      code: 'export const reviewPolicy = {\n  requiredApprovals: 1,\n  allowSelfReview: false,\n  agents: ["analysis-agent"],\n};',
      longtext:
        "This long text field verifies wrapping, scanning, and diff behavior for prose-heavy records.",
      markdown:
        "## Markdown sample\n\n- Covers markdown rendering\n- Keeps agent output reviewable",
      multiselect: ["text", "media", "review"],
      number: 42.5,
      phone: "+1-555-0188",
      relation: [BLOG_APPROVAL_RECORD_ID, BLOG_PRIVATE_RECORD_ID],
      select: "in-review",
      text: "All field types coverage",
      updated_by: "field-type-agent",
      updated_time: "2026-06-21T10:30:00.000Z",
      url: "https://busabase.local/field-type-lab",
    },
    message: "Seed complete field type coverage record",
    author: "seed-qa",
    minutesAgo: 118,
    createdTimeSlug: "created_time",
    useCases: ["field-types"],
  },

  // ── CRM: Companies first (relation targets must exist before Contacts/Deals) ──
  {
    id: CRM_COMPANY_ACME_ID,
    baseId: DEMO_CRM_COMPANIES_BASE_ID,
    commitId: "cmt_seed_crm_company_acme",
    fields: {
      name: "Acme SaaS",
      industry: "saas",
      website: "https://acme.example.com",
      employees: 120,
      status: "active",
    },
    message: "Seed CRM company Acme",
    author: "seed-crm",
    minutesAgo: 160,
    useCases: ["crm", "operations"],
  },
  {
    id: CRM_COMPANY_NORTHWIND_ID,
    baseId: DEMO_CRM_COMPANIES_BASE_ID,
    commitId: "cmt_seed_crm_company_northwind",
    fields: {
      name: "Northwind Retail",
      industry: "ecommerce",
      website: "https://northwind.example.com",
      employees: 40,
      status: "lead",
    },
    message: "Seed CRM company Northwind",
    author: "seed-crm",
    minutesAgo: 158,
    useCases: ["crm", "operations"],
  },
  {
    id: CRM_COMPANY_GLOBEX_ID,
    baseId: DEMO_CRM_COMPANIES_BASE_ID,
    commitId: "cmt_seed_crm_company_globex",
    fields: {
      name: "Globex Fintech",
      industry: "fintech",
      website: "https://globex.example.com",
      employees: 300,
      status: "active",
    },
    message: "Seed CRM company Globex",
    author: "seed-crm",
    minutesAgo: 156,
    useCases: ["crm", "operations"],
  },
  // Contacts → one Company each.
  {
    id: CRM_CONTACT_ALICE_ID,
    baseId: DEMO_CRM_CONTACTS_BASE_ID,
    commitId: "cmt_seed_crm_contact_alice",
    fields: {
      name: "Alice Chen",
      email: "alice@acme.example.com",
      phone: "+1-555-0140",
      job_title: "CTO",
      company: [CRM_COMPANY_ACME_ID],
      status: "customer",
    },
    message: "Seed CRM contact Alice",
    author: "seed-crm",
    minutesAgo: 150,
    useCases: ["crm", "operations"],
  },
  {
    id: CRM_CONTACT_BOB_ID,
    baseId: DEMO_CRM_CONTACTS_BASE_ID,
    commitId: "cmt_seed_crm_contact_bob",
    fields: {
      name: "Bob Lee",
      email: "bob@northwind.example.com",
      phone: "+1-555-0141",
      job_title: "Head of Ops",
      company: [CRM_COMPANY_NORTHWIND_ID],
      status: "engaged",
    },
    message: "Seed CRM contact Bob",
    author: "seed-crm",
    minutesAgo: 148,
    useCases: ["crm", "operations"],
  },
  {
    id: CRM_CONTACT_CAROL_ID,
    baseId: DEMO_CRM_CONTACTS_BASE_ID,
    commitId: "cmt_seed_crm_contact_carol",
    fields: {
      name: "Carol Wang",
      email: "carol@globex.example.com",
      phone: "+1-555-0142",
      job_title: "CFO",
      company: [CRM_COMPANY_GLOBEX_ID],
      status: "customer",
    },
    message: "Seed CRM contact Carol",
    author: "seed-crm",
    minutesAgo: 146,
    useCases: ["crm", "operations"],
  },
  {
    id: CRM_CONTACT_DAN_ID,
    baseId: DEMO_CRM_CONTACTS_BASE_ID,
    commitId: "cmt_seed_crm_contact_dan",
    fields: {
      name: "Dan Park",
      email: "dan@acme.example.com",
      phone: "+1-555-0143",
      job_title: "Procurement Lead",
      company: [CRM_COMPANY_ACME_ID],
      status: "engaged",
    },
    message: "Seed CRM contact Dan",
    author: "seed-crm",
    minutesAgo: 144,
    useCases: ["crm", "operations"],
  },
  // Deals → one Company + one or more Contacts.
  {
    id: CRM_DEAL_ACME_ID,
    baseId: DEMO_CRM_DEALS_BASE_ID,
    commitId: "cmt_seed_crm_deal_acme",
    fields: {
      name: "Acme platform expansion",
      amount: 48000,
      stage: "proposal",
      close_date: "2026-07-15",
      company: [CRM_COMPANY_ACME_ID],
      contacts: [CRM_CONTACT_ALICE_ID, CRM_CONTACT_DAN_ID],
      owner: "sales-rep",
    },
    message: "Seed CRM deal Acme expansion",
    author: "seed-crm",
    minutesAgo: 130,
    useCases: ["crm", "operations"],
  },
  {
    id: CRM_DEAL_NORTHWIND_ID,
    baseId: DEMO_CRM_DEALS_BASE_ID,
    commitId: "cmt_seed_crm_deal_northwind",
    fields: {
      name: "Northwind pilot",
      amount: 12000,
      stage: "prospecting",
      close_date: "2026-08-01",
      company: [CRM_COMPANY_NORTHWIND_ID],
      contacts: [CRM_CONTACT_BOB_ID],
      owner: "sales-rep",
    },
    message: "Seed CRM deal Northwind pilot",
    author: "seed-crm",
    minutesAgo: 128,
    useCases: ["crm", "operations"],
  },
  {
    id: CRM_DEAL_GLOBEX_ID,
    baseId: DEMO_CRM_DEALS_BASE_ID,
    commitId: "cmt_seed_crm_deal_globex",
    fields: {
      name: "Globex annual renewal",
      amount: 90000,
      stage: "won",
      close_date: "2026-06-30",
      company: [CRM_COMPANY_GLOBEX_ID],
      contacts: [CRM_CONTACT_CAROL_ID],
      owner: "account-manager",
    },
    message: "Seed CRM deal Globex renewal",
    author: "seed-crm",
    minutesAgo: 126,
    useCases: ["crm", "operations"],
  },
  // Bulk backlog rows so each scene Base shows a full page (CRM, content, media).
  ...BULK_COMPANIES,
  ...BULK_CONTACTS,
  ...BULK_DEALS,
  ...BULK_BLOGS,
  ...BULK_SOCIAL,
  ...BULK_NEWSLETTERS,
  ...BULK_MEDIA,
  ...FINANCE_RECORDS,
  ...DIRECTORY_LISTINGS_RECORDS,
  ...AGENT_INTEGRATIONS_RECORDS,
  ...CROSS_FUNCTIONAL_RECORDS,
  ...(readmeScenario.records ?? []),
];

export const DEMO_VIEWS: SeedViewDef[] = [
  {
    id: "viw_seed_blog_all",
    baseId: DEMO_BLOG_BASE_ID,
    slug: "all-records",
    name: "All records",
    description: "Every approved blog record in this Base.",
    config: {
      filters: [],
      sorts: [{ direction: "desc", fieldSlug: "publish_date" }],
      visibleFieldSlugs: [
        "title",
        "cover_image",
        "status",
        "tags",
        "priority",
        "publish_date",
        "ready",
        "related_social",
      ],
    },
    minutesAgo: 120,
    useCases: ["blog", "review-loop", "conflict", "canonical"],
  },
  {
    id: "viw_seed_blog_ready",
    baseId: DEMO_BLOG_BASE_ID,
    slug: "ready-to-publish",
    name: "Ready to publish",
    description: "Approved blog drafts that can feed the public site.",
    config: {
      filters: [
        { fieldSlug: "ready", operator: "is_true" },
        { fieldSlug: "status", operator: "equals", value: "published" },
      ],
      sorts: [{ direction: "desc", fieldSlug: "publish_date" }],
      visibleFieldSlugs: ["title", "status", "publish_date", "source_url", "ai_tags"],
    },
    minutesAgo: 118,
    useCases: ["blog", "conflict"],
  },
  {
    id: "viw_seed_blog_drafts",
    baseId: DEMO_BLOG_BASE_ID,
    slug: "drafts",
    name: "Drafts",
    description: "Work-in-progress blog notes before final publishing.",
    config: {
      filters: [{ fieldSlug: "status", operator: "equals", value: "drafting" }],
      sorts: [{ direction: "asc", fieldSlug: "priority" }],
      visibleFieldSlugs: ["title", "status", "priority", "ai_summary", "tags"],
    },
    minutesAgo: 116,
    useCases: ["blog"],
  },
  {
    id: FIELD_TYPE_LAB_VIEW_ID,
    baseId: DEMO_FIELD_TYPE_LAB_BASE_ID,
    slug: "all-field-types",
    name: "All field types",
    description: "Every supported field type visible in one QA view.",
    config: {
      filters: [],
      sorts: [{ direction: "asc", fieldSlug: "auto_number" }],
      visibleFieldSlugs: [
        "text",
        "code_json",
        "code_yaml",
        "code",
        "attachment",
        "relation",
        "number",
        "date",
        "checkbox",
        "select",
        "multiselect",
        "url",
        "email",
        "phone",
        "created_time",
        "updated_time",
        "created_by",
        "updated_by",
        "auto_number",
        "ai_summary",
        "ai_tags",
      ],
    },
    minutesAgo: 114,
    useCases: ["field-types"],
  },
  ...FINANCE_VIEWS,
  ...DIRECTORY_LISTINGS_VIEWS,
  ...AGENT_INTEGRATIONS_VIEWS,
  ...(readmeScenario.views ?? []),
];

export const DEMO_CHANGE_REQUESTS: SeedChangeRequestDef[] = [
  {
    id: "crq_seed",
    baseId: DEMO_BLOG_BASE_ID,
    status: "in_review",
    submittedBy: "ai-research-agent",
    sourceMeta: { seed: true, scenario: "single-create", workflow: "ai-industry-blogger" },
    minutesAgo: 40,
    useCases: ["blog", "review-loop", "canonical"],
    operations: [
      {
        id: "opr_seed",
        commitId: "cmt_seed",
        operation: "record_create",
        fields: {
          title: "AI browsers may become the next agent control surface",
          body: "The interesting product question is whether browsers become the place where agents can read context, take lightweight actions, and hand risky decisions back to the human. For AI bloggers, this matters because research, clipping, summarizing, and source checking can collapse into one reviewable workflow.",
          channel: "blog",
        },
        message: "Create changeRequest from AI industry research sweep",
        author: "ai-research-agent",
      },
    ],
  },
  {
    id: "crq_seed_blog_update",
    baseId: DEMO_BLOG_BASE_ID,
    status: "in_review",
    submittedBy: "analysis-agent",
    sourceMeta: { seed: true, scenario: "single-update", workflow: "ai-industry-blogger" },
    minutesAgo: 28,
    useCases: ["blog", "review-loop", "conflict", "canonical"],
    operations: [
      {
        id: "opr_seed_blog_update",
        commitId: "cmt_seed_blog_update",
        operation: "record_update",
        targetRecordId: BLOG_APPROVAL_RECORD_ID,
        baseCommitId: BLOG_APPROVAL_COMMIT_ID,
        baseFields: {
          title: "AI agents are moving from demos into operator workflows",
          body: "The useful signal this week is not another model benchmark. It is the shift from chat-style demos into agent workflows that can research, prepare drafts, check sources, and prepare content for human approval.",
          channel: "blog",
        },
        fields: {
          title: "AI agents are moving from demos into operator workflows",
          body: "The useful signal this week is not another model benchmark. It is the shift from chat-style demos into agent workflows that can research, prepare drafts, check sources, prepare distribution variants, and still pause for human approval before publishing.",
          channel: "blog",
        },
        message: "Sharpen workflow thesis with review checkpoint",
        author: "analysis-agent",
      },
    ],
  },
  {
    id: "crq_seed_social_batch",
    baseId: DEMO_SOCIAL_BASE_ID,
    status: "in_review",
    submittedBy: "social-editor-agent",
    sourceMeta: {
      seed: true,
      scenario: "batch-create-update-delete",
      workflow: "ai-industry-blogger",
    },
    minutesAgo: 16,
    useCases: ["social", "batch-import"],
    operations: [
      {
        id: "opr_seed_social_create_x",
        commitId: "cmt_seed_social_create_x",
        operation: "record_create",
        fields: {
          title: "3 signals from this week's AI industry news",
          body: "1. Agents are being packaged into workflows, not magic boxes.\n2. Video tools are shifting toward creator operations.\n3. Trust now depends on review, provenance, and source discipline.",
          channel: "x",
        },
        message: "Create weekly AI news thread",
        author: "social-editor-agent",
      },
      {
        id: "opr_seed_social_update_thread",
        commitId: "cmt_seed_social_update_thread",
        operation: "record_update",
        targetRecordId: SOCIAL_THREAD_RECORD_ID,
        baseCommitId: SOCIAL_THREAD_COMMIT_ID,
        baseFields: {
          title: "Thread: what this week's AI agent news actually means",
          body: "The pattern is clear: agent products are being judged less by autonomy claims and more by whether they fit into daily knowledge work without breaking trust.",
          channel: "x",
        },
        fields: {
          title: "Thread: what this week's AI agent news actually means",
          body: "The pattern is clear: the market is rewarding AI agents that fit into existing work. The best products make research faster, keep evidence visible, and let humans approve the final claim.",
          channel: "x",
        },
        message: "Tighten existing agent news thread",
        author: "social-editor-agent",
      },
      {
        id: "opr_seed_social_delete_stale",
        commitId: "cmt_seed_social_delete_stale",
        operation: "record_delete",
        targetRecordId: SOCIAL_STALE_RECORD_ID,
        baseCommitId: SOCIAL_STALE_COMMIT_ID,
        deleteMode: "archive",
        baseFields: {
          title: "Old take: model size is the whole story",
          body: "This older post over-emphasizes parameter count and misses the current product shift toward workflows, evals, distribution, and trusted review loops.",
          channel: "linkedin",
        },
        fields: {
          title: "Old take: model size is the whole story",
          body: "This older post over-emphasizes parameter count and misses the current product shift toward workflows, evals, distribution, and trusted review loops.",
          channel: "linkedin",
        },
        message: "Archive stale model-size take",
        author: "social-editor-agent",
      },
    ],
  },
  {
    id: "crq_seed_newsletter_approved",
    baseId: DEMO_NEWSLETTER_BASE_ID,
    status: "approved",
    submittedBy: "newsletter-agent",
    sourceMeta: {
      seed: true,
      scenario: "approved-ready-to-merge",
      workflow: "ai-industry-blogger",
    },
    minutesAgo: 8,
    reviewedMinutesAgo: 4,
    useCases: ["newsletter", "media"],
    operations: [
      {
        id: "opr_seed_newsletter_variant",
        commitId: "cmt_seed_newsletter_variant",
        operation: "record_variant",
        sourceRecordId: NEWSLETTER_RECORD_ID,
        sourceCommitId: NEWSLETTER_COMMIT_ID,
        fields: {
          title: "Weekly AI briefing: what changed and why it matters",
          body: "<article><h2>What changed this week</h2><p>A shorter subscriber-ready version: agents are turning into workflows, video generation is becoming an operating layer for creators, and AI teams need better provenance before publishing confident takes.</p><table><thead><tr><th>Signal</th><th>Why it matters</th></tr></thead><tbody><tr><td>Agent workflows</td><td>Review beats blind autonomy.</td></tr><tr><td>AI video ops</td><td>Creation and distribution are converging.</td></tr></tbody></table><script>alert('unsafe')</script></article>",
          audience: "AI founders and operators",
        },
        message: "Create concise approved newsletter variant",
        author: "newsletter-agent",
      },
    ],
  },
  {
    id: "crq_seed_newsletter_html_brief",
    baseId: DEMO_NEWSLETTER_BASE_ID,
    status: "in_review",
    submittedBy: "newsletter-html-agent",
    sourceMeta: { seed: true, scenario: "html-create-update", workflow: "ai-industry-blogger" },
    minutesAgo: 2,
    useCases: ["newsletter", "media"],
    operations: [
      {
        id: "opr_seed_newsletter_html_create",
        commitId: "cmt_seed_newsletter_html_create",
        operation: "record_create",
        fields: {
          title: "Weekend briefing: open-source agents and local knowledge bases",
          body: '<article><h2>Weekend briefing</h2><p>The most interesting open-source agent work is not only model quality. It is the local-first workflow around private context, reviewable changeRequests, and portable knowledge bases.</p><ul><li>Local data control is becoming a buyer requirement.</li><li>Agent output needs human review before reuse.</li><li>Approved records become the durable memory layer.</li></ul><p><a href="https://example.com/busabase-local-review">Reference note</a></p></article>',
          audience: "self-hosted AI teams",
        },
        message: "Create HTML weekend briefing",
        author: "newsletter-html-agent",
      },
      {
        id: "opr_seed_newsletter_html_update",
        commitId: "cmt_seed_newsletter_html_update",
        operation: "record_update",
        targetRecordId: NEWSLETTER_STACK_RECORD_ID,
        baseCommitId: NEWSLETTER_STACK_COMMIT_ID,
        baseFields: {
          title: "Creator stack memo: agents need reviewable memory",
          audience: "solo AI creators",
        },
        fields: {
          title: "Creator stack memo: approved records are the memory layer",
          body: "<article><h2>Creator stack memo</h2><p>AI industry bloggers are starting to behave like small research desks. The stack is no longer just notes plus a scheduler; it needs a reviewable knowledge base that separates change requests from canonical records.</p><h3>Recommended flow</h3><ol><li>Agents collect sources into change request operations.</li><li>Humans approve or revise each batch.</li><li>Only merged records feed future content.</li></ol><pre><code>change request -> review -> merge -> canonical record</code></pre></article>",
          audience: "solo AI creators",
        },
        message: "Update creator stack memo with HTML flow",
        author: "newsletter-html-agent",
      },
    ],
  },
  {
    id: "crq_seed_media_metadata",
    baseId: DEMO_MEDIA_ASSETS_BASE_ID,
    status: "in_review",
    submittedBy: "media-metadata-agent",
    sourceMeta: { seed: true, scenario: "media-metadata", workflow: "multimodal-review" },
    minutesAgo: 3,
    useCases: ["media"],
    operations: [
      {
        id: "opr_seed_media_metadata",
        commitId: "cmt_seed_media_metadata",
        operation: "record_update",
        targetRecordId: MEDIA_CLIP_RECORD_ID,
        baseCommitId: MEDIA_CLIP_COMMIT_ID,
        baseFields: {
          detected_objects: ["dashboard", "human-review", "agent-output"],
          review_status: "approved",
          scene_description:
            "A reviewer opens the Busabase inbox, inspects an agent proposal, and confirms the change before it reaches the canonical base.",
          title: "Dashboard walkthrough clip: approval inbox",
          usage_rights: "approved",
        },
        fields: {
          asset: [
            {
              id: "att_seed_dashboard_clip",
              attachmentId: "att_seed_dashboard_clip",
              fileName: "approval-inbox-walkthrough.mp4",
              mimeType: "video/mp4",
              size: 8_241_336,
              url: "/assets/readme/busabase-inbox-review.png",
            },
            {
              id: "att_seed_transcript",
              attachmentId: "att_seed_transcript",
              fileName: "approval-inbox-transcript.vtt",
              mimeType: "text/vtt",
              size: 18_432,
              url: "/assets/readme/busabase-record-detail-audit.png",
            },
          ],
          detected_objects: ["dashboard", "human-review", "agent-output"],
          review_status: "approved",
          scene_description:
            "A reviewer opens the Busabase inbox, inspects an agent proposal, verifies the attached transcript, and confirms the change before it reaches the canonical base.",
          title: "Dashboard walkthrough clip: approval inbox",
          transcript:
            "00:00 Reviewer opens the inbox.\\n00:08 Agent proposal appears with field-level diffs.\\n00:16 Human approves the trusted record.",
          usage_rights: "approved",
        },
        message: "Verify multimodal metadata and attached transcript",
        author: "media-metadata-agent",
      },
    ],
  },
  {
    id: "crq_seed_field_type_lab_update",
    baseId: DEMO_FIELD_TYPE_LAB_BASE_ID,
    status: "in_review",
    submittedBy: "field-type-agent",
    sourceMeta: { seed: true, scenario: "field-type-coverage", workflow: "qa-seed" },
    minutesAgo: 2,
    useCases: ["field-types"],
    operations: [
      {
        id: "opr_seed_field_type_lab_update",
        commitId: "cmt_seed_field_type_lab_update",
        operation: "record_update",
        targetRecordId: FIELD_TYPE_LAB_RECORD_ID,
        baseCommitId: FIELD_TYPE_LAB_COMMIT_ID,
        baseFields: {
          ai_summary: "A single seeded record exercises every Busabase field type.",
          ai_tags: ["field-types", "coverage", "seed"],
          attachment: [
            {
              id: "att_seed_field_lab_png",
              attachmentId: "att_seed_field_lab_png",
              fileName: "field-type-lab.png",
              mimeType: "image/png",
              size: 142_336,
              url: "/assets/readme/scenarios/multimodal-review-base.png",
            },
          ],
          checkbox: true,
          markdown:
            "## Markdown sample\n\n- Covers markdown rendering\n- Keeps agent output reviewable",
          multiselect: ["text", "media", "review"],
          number: 42.5,
          relation: [BLOG_APPROVAL_RECORD_ID],
          select: "in-review",
          text: "All field types coverage",
          updated_by: "field-type-agent",
        },
        fields: {
          ai_summary: "Updated seed record still exercises every Busabase field type.",
          ai_tags: ["field-types", "coverage", "seed", "diff"],
          attachment: [
            {
              id: "att_seed_field_lab_png",
              attachmentId: "att_seed_field_lab_png",
              fileName: "field-type-lab.png",
              mimeType: "image/png",
              size: 142_336,
              url: "/assets/readme/scenarios/multimodal-review-base.png",
            },
            {
              id: "att_seed_field_lab_notes",
              attachmentId: "att_seed_field_lab_notes",
              fileName: "field-type-lab-notes.md",
              mimeType: "text/markdown",
              size: 4_096,
              url: "/assets/readme/scenarios/multimodal-review-record.png",
            },
          ],
          auto_number: 1001,
          checkbox: false,
          created_by: DEMO_ACTOR_ID,
          date: "2026-06-22",
          email: "qa@busabase.local",
          html: "<section><strong>HTML preview</strong><p>Updated safely in review.</p></section>",
          longtext:
            "Updated long text verifies wrapping, scanning, and diff behavior for prose-heavy records.",
          markdown: "## Markdown sample\n\n- Covers markdown rendering\n- Adds reviewed changes",
          multiselect: ["text", "media"],
          number: 43.75,
          phone: "+1-555-0188",
          relation: [BLOG_APPROVAL_RECORD_ID, BLOG_PRIVATE_RECORD_ID],
          select: "approved",
          text: "All field types coverage updated",
          updated_by: "field-type-agent",
          updated_time: "2026-06-21T10:45:00.000Z",
          url: "https://busabase.local/field-type-lab",
        },
        message: "Exercise every field type in one review diff",
        author: "field-type-agent",
      },
      {
        id: "opr_seed_field_type_lab_view_create",
        commitId: "cmt_seed_field_type_lab_view_create",
        operation: "view_create",
        fields: {
          config: {
            filters: [{ fieldSlug: "select", operator: "equals", value: "approved" }],
            sorts: [{ direction: "asc", fieldSlug: "auto_number" }],
            visibleFieldSlugs: ["text", "attachment", "relation", "select", "ai_summary"],
          },
          description: "QA view focused on approved all-field records.",
          name: "Approved coverage",
          slug: "approved-coverage",
        },
        message: "Create approved field coverage view",
        author: "field-type-agent",
      },
      {
        id: "opr_seed_field_type_lab_view_delete",
        commitId: "cmt_seed_field_type_lab_view_delete",
        operation: "view_delete",
        targetViewId: FIELD_TYPE_LAB_VIEW_ID,
        baseFields: {
          config: {
            filters: [],
            sorts: [{ direction: "asc", fieldSlug: "auto_number" }],
            visibleFieldSlugs: [
              "text",
              "attachment",
              "relation",
              "number",
              "date",
              "checkbox",
              "select",
              "multiselect",
              "url",
              "email",
              "phone",
              "created_time",
              "updated_time",
              "created_by",
              "updated_by",
              "auto_number",
              "ai_summary",
              "ai_tags",
            ],
          },
          description: "Every supported field type visible in one QA view.",
          name: "All field types",
          slug: "all-field-types",
        },
        fields: {
          config: {
            filters: [],
            sorts: [{ direction: "asc", fieldSlug: "auto_number" }],
            visibleFieldSlugs: [
              "text",
              "attachment",
              "relation",
              "number",
              "date",
              "checkbox",
              "select",
              "multiselect",
              "url",
              "email",
              "phone",
              "created_time",
              "updated_time",
              "created_by",
              "updated_by",
              "auto_number",
              "ai_summary",
              "ai_tags",
            ],
          },
          description: "Every supported field type visible in one QA view.",
          name: "All field types",
          slug: "all-field-types",
        },
        message: "Archive obsolete field coverage view",
        author: "field-type-agent",
      },
    ],
  },
  {
    id: "crq_seed_view_ready",
    baseId: DEMO_BLOG_BASE_ID,
    status: "in_review",
    submittedBy: "workflow-agent",
    sourceMeta: { seed: true, scenario: "view-update", workflow: "ai-industry-blogger" },
    minutesAgo: 1,
    useCases: ["blog"],
    operations: [
      {
        id: "opr_seed_view_ready",
        commitId: "cmt_seed_view_ready",
        operation: "view_update",
        targetViewId: "viw_seed_blog_ready",
        baseFields: {
          name: "Ready to publish",
          description: "Approved blog drafts that can feed the public site.",
          config: {
            filters: [
              { fieldSlug: "ready", operator: "is_true" },
              { fieldSlug: "status", operator: "equals", value: "published" },
            ],
            sorts: [{ direction: "desc", fieldSlug: "publish_date" }],
            visibleFieldSlugs: ["title", "status", "publish_date", "source_url", "ai_tags"],
          },
        },
        fields: {
          config: {
            filters: [
              { fieldSlug: "ready", operator: "is_true" },
              { fieldSlug: "status", operator: "equals", value: "published" },
              { fieldSlug: "source_url", operator: "not_empty" },
            ],
            sorts: [{ direction: "desc", fieldSlug: "publish_date" }],
            visibleFieldSlugs: ["title", "status", "publish_date", "source_url", "ai_tags"],
          },
          description: "Published blog records with source receipts ready for downstream sites.",
          name: "Ready with sources",
        },
        message: "Tighten ready-to-publish view to require source URLs",
        author: "workflow-agent",
      },
    ],
  },
  {
    id: "crq_seed_crm_company_enrich",
    baseId: DEMO_CRM_COMPANIES_BASE_ID,
    status: "in_review",
    submittedBy: "crm-hygiene-agent",
    sourceMeta: { seed: true, scenario: "crm-hygiene", workflow: "data-stewardship" },
    minutesAgo: 12,
    useCases: ["crm"],
    operations: [
      {
        id: "opr_seed_crm_company_enrich",
        commitId: "cmt_seed_crm_company_enrich",
        operation: "record_update",
        targetRecordId: CRM_COMPANY_ACME_ID,
        baseCommitId: "cmt_seed_crm_company_acme",
        baseFields: {
          employees: 120,
          industry: "saas",
          name: "Acme SaaS",
          status: "active",
          website: "https://acme.example.com",
        },
        fields: {
          employees: 128,
          industry: "saas",
          name: "Acme SaaS",
          status: "active",
          website: "https://acme.example.com",
        },
        message: "Refresh account size from CRM enrichment sweep",
        author: "crm-hygiene-agent",
      },
    ],
  },
  {
    id: "crq_seed_crm_deal_update",
    baseId: DEMO_CRM_DEALS_BASE_ID,
    status: "in_review",
    submittedBy: "ops-reconcile-agent",
    sourceMeta: { seed: true, scenario: "operations-status", workflow: "ops-review" },
    minutesAgo: 10,
    useCases: ["operations"],
    operations: [
      {
        id: "opr_seed_crm_deal_update",
        commitId: "cmt_seed_crm_deal_update",
        operation: "record_update",
        targetRecordId: CRM_DEAL_ACME_ID,
        baseCommitId: "cmt_seed_crm_deal_acme",
        baseFields: {
          amount: 48000,
          close_date: "2026-07-15",
          company: [CRM_COMPANY_ACME_ID],
          contacts: [CRM_CONTACT_ALICE_ID, CRM_CONTACT_DAN_ID],
          name: "Acme platform expansion",
          owner: "sales-rep",
          stage: "proposal",
        },
        fields: {
          amount: 52000,
          close_date: "2026-07-22",
          company: [CRM_COMPANY_ACME_ID],
          contacts: [CRM_CONTACT_ALICE_ID, CRM_CONTACT_DAN_ID],
          name: "Acme platform expansion",
          owner: "account-manager",
          stage: "proposal",
        },
        message: "Reconcile updated expansion amount and owner",
        author: "ops-reconcile-agent",
      },
    ],
  },
  ...FINANCE_CHANGE_REQUESTS,
  ...(readmeScenario.changeRequests ?? []),
];

// ── Use-case filtering ───────────────────────────────────────────────────────
const includesUseCase = (tags: DemoUseCase[], useCase: DemoUseCase) =>
  useCase === "1" || tags.includes(useCase);

export interface DemoDataset {
  bases: BaseVO[];
  nodes: NodeVO[];
  records: RecordVO[];
  views: ViewVO[];
  changeRequests: ChangeRequestVO[];
  auditEvents: AuditEventVO[];
}

const iso = (anchor: Date, minutesAgo: number) =>
  new Date(anchor.getTime() - minutesAgo * 60_000).toISOString();

/**
 * Record commit field values, including the synced `created_time` system value
 * when the record declares one. Shared by the demo build and the real DB seed
 * (`logic/store.ts`) so the two never drift.
 */
export const buildRecordSeedFields = (
  record: SeedRecordDef,
  createdAtIso: string,
): Record<string, unknown> =>
  record.createdTimeSlug
    ? { ...record.fields, [record.createdTimeSlug]: createdAtIso }
    : record.fields;

const toBaseFieldVO = (baseId: string, field: SeedFieldDef, position: number): BaseFieldVO => ({
  ...field,
  baseId,
  position,
  options: field.options ?? {},
});

const buildBaseVO = (base: SeedBaseDef, anchor: Date): BaseVO => ({
  id: base.id,
  nodeId: base.nodeId,
  slug: base.slug,
  name: base.name,
  description: base.description,
  reviewPolicy: REVIEW_POLICY,
  createdAt: iso(anchor, 200),
  fields: base.fields.map((field, index) => toBaseFieldVO(base.id, field, index)),
});

/**
 * Assemble the demo dataset as ready-to-return View Objects for the given
 * use-case. `"1"` returns the full seeded set; named use-cases filter to their
 * tagged bases / records / change requests / views.
 */
export const buildDemoDataset = (
  useCase: DemoUseCase,
  anchor: Date = new Date(),
  // The scenario to build from. Defaults to the English seed; the stateless demo
  // passes `zhCnScenario` when `?demo&lang=zh-CN` is requested. Both are plain
  // `SeedScenario`s with the same shape, so the build is locale-agnostic.
  scenario: SeedScenario = englishScenario,
): DemoDataset => {
  const bases = (scenario.bases ?? []).filter((base) => includesUseCase(base.useCases, useCase));
  const baseById = new Map(bases.map((base) => [base.id, buildBaseVO(base, anchor)]));
  const baseVOs = [...baseById.values()];

  const nodes: NodeVO[] = [];
  const rootCreatedAt = iso(anchor, 220);
  // Group the (use-case-filtered) bases under their sidebar folder; only emit a
  // folder that actually has bases.
  const folderNodes: NodeVO[] = (scenario.folders ?? [])
    .map((folder) => ({
      id: folder.nodeId,
      parentId: DEMO_ROOT_NODE_ID,
      type: "folder" as const,
      slug: folder.slug,
      name: folder.name,
      description: folder.description,
      metadata: {},
      position: folder.position,
      createdAt: rootCreatedAt,
      updatedAt: rootCreatedAt,
      baseId: null,
      children: bases
        .filter((base) => base.folderNodeId === folder.nodeId)
        .map((base, index) => ({
          id: base.nodeId,
          parentId: folder.nodeId,
          type: "base" as const,
          slug: base.slug,
          name: base.name,
          description: base.description,
          metadata: {},
          position: index,
          createdAt: rootCreatedAt,
          updatedAt: rootCreatedAt,
          baseId: base.id,
          children: [],
        })),
    }))
    .filter((folder) => folder.children.length > 0);
  nodes.push({
    id: DEMO_ROOT_NODE_ID,
    parentId: null,
    type: "folder",
    slug: "root",
    name: "Local workspace",
    description: "The root of this self-hosted Busabase workspace.",
    metadata: {},
    position: 0,
    createdAt: rootCreatedAt,
    updatedAt: rootCreatedAt,
    baseId: null,
    children: folderNodes,
  });

  const recordCommit = (record: SeedRecordDef): CommitVO => ({
    id: record.commitId,
    baseId: record.baseId,
    targetType: "base",
    nodeId: null,
    operationId: null,
    parentCommitId: null,
    fields: buildRecordSeedFields(record, iso(anchor, record.minutesAgo)),
    operation: "record_create",
    message: record.message,
    author: record.author,
    createdAt: iso(anchor, record.minutesAgo),
  });

  const records: RecordVO[] = (scenario.records ?? [])
    .filter((record) => baseById.has(record.baseId) && includesUseCase(record.useCases, useCase))
    .map((record) => ({
      id: record.id,
      baseId: record.baseId,
      headCommitId: record.commitId,
      parentRecordId: null,
      parentCommitId: null,
      status: "active",
      createdBy: DEMO_ACTOR_ID,
      archivedAt: null,
      createdAt: iso(anchor, record.minutesAgo),
      updatedAt: iso(anchor, record.minutesAgo),
      base: baseById.get(record.baseId) as BaseVO,
      headCommit: recordCommit(record),
    }));

  const views: ViewVO[] = (scenario.views ?? [])
    .filter((view) => baseById.has(view.baseId) && includesUseCase(view.useCases, useCase))
    .map((view) => ({
      id: view.id,
      baseId: view.baseId,
      slug: view.slug,
      name: view.name,
      description: view.description,
      type: "table",
      config: view.config,
      status: "active",
      createdBy: DEMO_ACTOR_ID,
      archivedAt: null,
      createdAt: iso(anchor, view.minutesAgo),
      updatedAt: iso(anchor, view.minutesAgo),
    }));

  const changeRequests: ChangeRequestVO[] = (scenario.changeRequests ?? [])
    .filter((cr) => baseById.has(cr.baseId) && includesUseCase(cr.useCases, useCase))
    .map((cr) => {
      const createdAt = iso(anchor, cr.minutesAgo);
      const base = baseById.get(cr.baseId) ?? null;
      const operations: OperationVO[] = cr.operations.map((op, position) => ({
        id: op.id,
        changeRequestId: cr.id,
        baseId: cr.baseId,
        targetType: "base",
        nodeId: null,
        operation: op.operation,
        status: "pending",
        targetRecordId: op.targetRecordId ?? null,
        targetViewId: op.targetViewId ?? null,
        filePath: null,
        sourceRecordId: op.sourceRecordId ?? null,
        sourceCommitId: op.sourceCommitId ?? null,
        baseCommitId: op.baseCommitId ?? null,
        headCommitId: op.commitId,
        deleteMode: op.deleteMode ?? "archive",
        mergedRecordId: null,
        mergedViewId: null,
        position,
        createdAt,
        updatedAt: createdAt,
        headCommit: {
          id: op.commitId,
          baseId: cr.baseId,
          targetType: "base",
          nodeId: null,
          operationId: op.id,
          parentCommitId: op.baseCommitId ?? op.sourceCommitId ?? null,
          fields: op.fields,
          operation: op.operation,
          message: op.message,
          author: op.author,
          createdAt,
        },
        baseFields: op.baseFields ?? null,
      }));
      const reviews: ReviewVO[] =
        cr.status === "approved"
          ? [
              {
                id: `${cr.id}_review`,
                changeRequestId: cr.id,
                reviewerId: DEMO_ACTOR_ID,
                verdict: "approved",
                reason: null,
                visibleOperationHeads: Object.fromEntries(
                  cr.operations.map((op) => [op.id, op.commitId]),
                ),
                createdAt: iso(anchor, cr.reviewedMinutesAgo ?? cr.minutesAgo),
              },
            ]
          : [];
      return {
        id: cr.id,
        baseId: cr.baseId,
        targetType: "base",
        nodeId: null,
        status: cr.status,
        submittedBy: cr.submittedBy,
        sourceMeta: cr.sourceMeta,
        reviewPolicySnapshot: REVIEW_POLICY,
        mergeSummary: {},
        rejectedReason: null,
        reviewedAt: cr.reviewedMinutesAgo != null ? iso(anchor, cr.reviewedMinutesAgo) : null,
        mergedAt: null,
        createdAt,
        updatedAt: cr.reviewedMinutesAgo != null ? iso(anchor, cr.reviewedMinutesAgo) : createdAt,
        base,
        node: null,
        operations,
        primaryOperation: operations[0] ?? null,
        operationCount: operations.length,
        reviews,
      };
    });

  // A small seeded activity trail so the Activity view is not empty in demo.
  const auditEvents: AuditEventVO[] = changeRequests.slice(0, 6).map((cr, index) => ({
    id: `qae_demo_${cr.id}`,
    action: "change_request.created",
    actorId: cr.submittedBy,
    baseId: cr.baseId,
    recordId: null,
    changeRequestId: cr.id,
    operationId: cr.primaryOperation?.id ?? null,
    commitId: cr.primaryOperation?.headCommitId ?? null,
    metadata: { seed: true },
    createdAt: iso(anchor, 40 - index),
  }));

  return { bases: baseVOs, nodes, records, views, changeRequests, auditEvents };
};

/** English default seed — used by ensureReady() to populate a fresh local workspace. */
export const englishScenario: SeedScenario = {
  folders: DEMO_FOLDERS,
  bases: DEMO_BASES,
  records: DEMO_RECORDS,
  views: DEMO_VIEWS,
  changeRequests: DEMO_CHANGE_REQUESTS,
};
