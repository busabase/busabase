import type { DemoUseCase } from "../../context";
import type { SeedChangeRequestDef, SeedRecordDef, SeedScenario, SeedViewDef } from "../seed-types";

const ids = {
  knowledgeFolder: "nod_knowledge",
  knowledgeBase: "bse_local_private_knowledge",
  knowledgeBaseNode: "nod_base_private_knowledge",
  knowledgeRecord: "rec_seed_private_knowledge_note",
  knowledgeCommit: "cmt_seed_private_knowledge_note",
  knowledgeCr: "crq_seed_private_knowledge_enrich",

  operationsFolder: "nod_operations",
  operationsBase: "bse_local_operations_tasks",
  operationsBaseNode: "nod_base_operations_tasks",
  operationsRecord: "rec_seed_ops_vendor_onboarding",
  operationsCommit: "cmt_seed_ops_vendor_onboarding",
  operationsCr: "crq_seed_ops_status_reconcile",

  routineFolder: "nod_routine",
  routineBase: "bse_local_routine_work",
  routineBaseNode: "nod_base_routine_work",
  routineRecord: "rec_seed_routine_support_qa",
  routineCommit: "cmt_seed_routine_support_qa",
  routineCr: "crq_seed_routine_support_qa",

  complianceFolder: "nod_compliance",
  complianceBase: "bse_local_compliance_checklists",
  complianceBaseNode: "nod_base_compliance_checklists",
  complianceRecord: "rec_seed_compliance_access_review",
  complianceCommit: "cmt_seed_compliance_access_review",
  complianceCr: "crq_seed_compliance_evidence",

  researchFolder: "nod_research",
  researchBase: "bse_local_market_research",
  researchBaseNode: "nod_base_market_research",
  researchRecord: "rec_seed_research_competitor_pricing",
  researchCommit: "cmt_seed_research_competitor_pricing",
  researchCr: "crq_seed_research_signal",

  contentFolder: "nod_content_factory",
  contentBase: "bse_local_content_pipeline",
  contentBaseNode: "nod_base_content_pipeline",
  contentRecord: "rec_seed_content_launch_brief",
  contentCommit: "cmt_seed_content_launch_brief",
  contentCr: "crq_seed_content_brief_update",

  datasetFolder: "nod_datasets",
  trainingBase: "bse_local_qa_training_dataset",
  trainingBaseNode: "nod_base_qa_training_dataset",
  trainingRecord: "rec_seed_training_refusal_eval",
  trainingCommit: "cmt_seed_training_refusal_eval",
  trainingCr: "crq_seed_training_quality_score",

  labelingBase: "bse_local_labeling_queue",
  labelingBaseNode: "nod_base_labeling_queue",
  labelingRecord: "rec_seed_labeling_clip_scene",
  labelingCommit: "cmt_seed_labeling_clip_scene",
  labelingCr: "crq_seed_labeling_correction",

  seoFolder: "nod_seo",
  seoBase: "bse_local_seo_pages",
  seoBaseNode: "nod_base_seo_pages",
  seoRecord: "rec_seed_seo_vs_notion",
  seoCommit: "cmt_seed_seo_vs_notion",
  seoCr: "crq_seed_seo_page_draft",

  configFolder: "nod_config",
  configBase: "bse_local_config_services",
  configBaseNode: "nod_base_config_services",
  configRecord: "rec_seed_config_api_gateway",
  configCommit: "cmt_seed_config_api_gateway",
  configCr: "crq_seed_config_rate_limit",
} as const;

export const README_SCENARIO_IDS = ids;

export const readmeScenario: SeedScenario = {
  folders: [
    {
      nodeId: ids.knowledgeFolder,
      slug: "personal-knowledge",
      name: "Personal Knowledge",
      description: "Private notes, sources, receipts, and agent-readable memory.",
      position: 3,
    },
    {
      nodeId: ids.operationsFolder,
      slug: "operations",
      name: "Operations",
      description: "Projects, tasks, vendors, and operational status approvals.",
      position: 4,
    },
    {
      nodeId: ids.routineFolder,
      slug: "routine-work",
      name: "Routine Work",
      description: "Recurring work logs that need human review and audit history.",
      position: 5,
    },
    {
      nodeId: ids.complianceFolder,
      slug: "compliance",
      name: "Compliance",
      description: "Access reviews, vendor checks, evidence, and audit checklists.",
      position: 6,
    },
    {
      nodeId: ids.researchFolder,
      slug: "research",
      name: "Research",
      description: "Market signals, monitored sources, citations, and analyst review.",
      position: 7,
    },
    {
      nodeId: ids.contentFolder,
      slug: "content-factory",
      name: "Content Factory",
      description: "Ideas, briefs, assets, SEO metadata, and publish-ready approvals.",
      position: 8,
    },
    {
      nodeId: ids.datasetFolder,
      slug: "datasets",
      name: "Datasets",
      description: "Training examples, evaluation rows, labeling queues, and QA review.",
      position: 9,
    },
    // NOTE: the Pages (SEO) base now lives in the shared "CMS" folder
    // (DEMO_CMS_FOLDER_NODE_ID, "nod_cms") alongside Blog Posts, so it no longer
    // gets its own SEO sidebar folder.
    {
      nodeId: ids.configFolder,
      slug: "config",
      name: "Config",
      description: "Service configurations reviewed and approved before deployment.",
      position: 11,
    },
  ],
  bases: [
    {
      id: ids.knowledgeBase,
      nodeId: ids.knowledgeBaseNode,
      slug: "private-knowledge",
      name: "Private Knowledge",
      description: "Local notes, sources, files, and approved memory for private agents.",
      folderNodeId: ids.knowledgeFolder,
      useCases: ["knowledge"],
      fields: [
        {
          id: "bsf_knowledge_title",
          slug: "title",
          name: "Title",
          type: "text",
          required: true,
          options: {},
        },
        {
          id: "bsf_knowledge_body",
          slug: "body",
          name: "Body",
          type: "markdown",
          required: false,
          options: {},
        },
        {
          id: "bsf_knowledge_source",
          slug: "source_url",
          name: "Source URL",
          type: "url",
          required: false,
          options: {},
        },
        {
          id: "bsf_knowledge_files",
          slug: "attachments",
          name: "Attachments",
          type: "attachment",
          required: false,
          options: {
            attachment: {
              allowedMimeTypes: ["image/png", "text/markdown", "application/pdf"],
              maxFileSize: 10 * 1024 * 1024,
              maxFiles: 4,
            },
          },
        },
        {
          id: "bsf_knowledge_sensitivity",
          slug: "sensitivity",
          name: "Sensitivity",
          type: "select",
          required: false,
          options: {
            choices: [
              { id: "private", name: "Private", color: "rose" },
              { id: "team", name: "Team", color: "amber" },
              { id: "public", name: "Public", color: "emerald" },
            ],
          },
        },
        {
          id: "bsf_knowledge_tags",
          slug: "tags",
          name: "Tags",
          type: "multiselect",
          required: false,
          options: {
            choices: [
              { id: "agent-memory", name: "Agent memory", color: "violet" },
              { id: "source", name: "Source", color: "slate" },
              { id: "decision", name: "Decision", color: "emerald" },
            ],
          },
        },
      ],
    },
    {
      id: ids.operationsBase,
      nodeId: ids.operationsBaseNode,
      slug: "ops-tasks",
      name: "Ops Tasks",
      description: "Operational tasks with owners, due dates, vendors, and status review.",
      folderNodeId: ids.operationsFolder,
      useCases: ["operations"],
      fields: [
        {
          id: "bsf_ops_task",
          slug: "task",
          name: "Task",
          type: "text",
          required: true,
          options: {},
        },
        {
          id: "bsf_ops_owner",
          slug: "owner",
          name: "Owner",
          type: "email",
          required: false,
          options: {},
        },
        {
          id: "bsf_ops_vendor",
          slug: "vendor",
          name: "Vendor",
          type: "text",
          required: false,
          options: {},
        },
        {
          id: "bsf_ops_due",
          slug: "due_date",
          name: "Due Date",
          type: "date",
          required: false,
          options: {},
        },
        {
          id: "bsf_ops_status",
          slug: "status",
          name: "Status",
          type: "select",
          required: false,
          options: {
            choices: [
              { id: "blocked", name: "Blocked", color: "rose" },
              { id: "in-progress", name: "In progress", color: "amber" },
              { id: "ready", name: "Ready", color: "emerald" },
            ],
          },
        },
        {
          id: "bsf_ops_risk",
          slug: "risk_flags",
          name: "Risk Flags",
          type: "multiselect",
          required: false,
          options: {
            choices: [
              { id: "contract", name: "Contract", color: "rose" },
              { id: "security", name: "Security", color: "amber" },
              { id: "data", name: "Data", color: "violet" },
            ],
          },
        },
      ],
    },
    {
      id: ids.routineBase,
      nodeId: ids.routineBaseNode,
      slug: "routine-work-log",
      name: "Routine Work Log",
      description: "Daily or weekly work runs with agent output, reviewer notes, and approval.",
      folderNodeId: ids.routineFolder,
      useCases: ["routine"],
      fields: [
        {
          id: "bsf_routine_run",
          slug: "run",
          name: "Run",
          type: "text",
          required: true,
          options: {},
        },
        {
          id: "bsf_routine_team",
          slug: "team",
          name: "Team",
          type: "text",
          required: false,
          options: {},
        },
        {
          id: "bsf_routine_due",
          slug: "run_date",
          name: "Run Date",
          type: "date",
          required: false,
          options: {},
        },
        {
          id: "bsf_routine_findings",
          slug: "findings",
          name: "Findings",
          type: "longtext",
          required: false,
          options: {},
        },
        {
          id: "bsf_routine_status",
          slug: "status",
          name: "Status",
          type: "select",
          required: false,
          options: {
            choices: [
              { id: "queued", name: "Queued", color: "slate" },
              { id: "needs-review", name: "Needs review", color: "amber" },
              { id: "approved", name: "Approved", color: "emerald" },
            ],
          },
        },
        {
          id: "bsf_routine_ready",
          slug: "ready_to_notify",
          name: "Ready To Notify",
          type: "checkbox",
          required: false,
          options: {},
        },
      ],
    },
    {
      id: ids.complianceBase,
      nodeId: ids.complianceBaseNode,
      slug: "compliance-checklists",
      name: "Compliance Checklists",
      description: "Evidence-backed recurring checks with owners, status, and audit notes.",
      folderNodeId: ids.complianceFolder,
      useCases: ["compliance"],
      fields: [
        {
          id: "bsf_compliance_item",
          slug: "item",
          name: "Item",
          type: "text",
          required: true,
          options: {},
        },
        {
          id: "bsf_compliance_owner",
          slug: "owner",
          name: "Owner",
          type: "email",
          required: false,
          options: {},
        },
        {
          id: "bsf_compliance_due",
          slug: "due_date",
          name: "Due Date",
          type: "date",
          required: false,
          options: {},
        },
        {
          id: "bsf_compliance_evidence",
          slug: "evidence",
          name: "Evidence",
          type: "attachment",
          required: false,
          options: {
            attachment: {
              allowedMimeTypes: ["image/png", "application/pdf", "text/markdown"],
              maxFileSize: 10 * 1024 * 1024,
              maxFiles: 5,
            },
          },
        },
        {
          id: "bsf_compliance_status",
          slug: "status",
          name: "Status",
          type: "select",
          required: false,
          options: {
            choices: [
              { id: "missing", name: "Missing", color: "rose" },
              { id: "review", name: "In review", color: "amber" },
              { id: "complete", name: "Complete", color: "emerald" },
            ],
          },
        },
        {
          id: "bsf_compliance_notes",
          slug: "notes",
          name: "Notes",
          type: "longtext",
          required: false,
          options: {},
        },
      ],
    },
    {
      id: ids.researchBase,
      nodeId: ids.researchBaseNode,
      slug: "market-research",
      name: "Market Research",
      description: "Monitored market signals, citations, confidence, and analyst approval.",
      folderNodeId: ids.researchFolder,
      useCases: ["research"],
      fields: [
        {
          id: "bsf_research_signal",
          slug: "signal",
          name: "Signal",
          type: "text",
          required: true,
          options: {},
        },
        {
          id: "bsf_research_source",
          slug: "source_url",
          name: "Source URL",
          type: "url",
          required: false,
          options: {},
        },
        {
          id: "bsf_research_summary",
          slug: "summary",
          name: "Summary",
          type: "markdown",
          required: false,
          options: {},
        },
        {
          id: "bsf_research_competitor",
          slug: "competitor",
          name: "Competitor",
          type: "text",
          required: false,
          options: {},
        },
        {
          id: "bsf_research_importance",
          slug: "importance",
          name: "Importance",
          type: "select",
          required: false,
          options: {
            choices: [
              { id: "low", name: "Low", color: "slate" },
              { id: "medium", name: "Medium", color: "amber" },
              { id: "high", name: "High", color: "rose" },
            ],
          },
        },
        {
          id: "bsf_research_confidence",
          slug: "confidence",
          name: "Confidence",
          type: "number",
          required: false,
          options: {},
        },
      ],
    },
    {
      id: ids.contentBase,
      nodeId: ids.contentBaseNode,
      slug: "content-pipeline",
      name: "Content Pipeline",
      description: "Campaign briefs, drafts, SEO metadata, assets, and publishing readiness.",
      folderNodeId: ids.contentFolder,
      useCases: ["content"],
      fields: [
        {
          id: "bsf_content_title",
          slug: "title",
          name: "Title",
          type: "text",
          required: true,
          options: {},
        },
        {
          id: "bsf_content_brief",
          slug: "brief",
          name: "Brief",
          type: "markdown",
          required: false,
          options: {},
        },
        {
          id: "bsf_content_channel",
          slug: "channel",
          name: "Channel",
          type: "select",
          required: false,
          options: {
            choices: [
              { id: "blog", name: "Blog", color: "slate" },
              { id: "youtube", name: "YouTube", color: "rose" },
              { id: "social", name: "Social", color: "violet" },
            ],
          },
        },
        {
          id: "bsf_content_status",
          slug: "status",
          name: "Status",
          type: "select",
          required: false,
          options: {
            choices: [
              { id: "idea", name: "Idea", color: "slate" },
              { id: "draft", name: "Draft", color: "amber" },
              { id: "ready", name: "Ready", color: "emerald" },
            ],
          },
        },
        {
          id: "bsf_content_seo",
          slug: "seo_title",
          name: "SEO Title",
          type: "text",
          required: false,
          options: {},
        },
        {
          id: "bsf_content_asset",
          slug: "asset",
          name: "Asset",
          type: "attachment",
          required: false,
          options: {
            attachment: {
              allowedMimeTypes: ["image/png", "video/mp4", "text/markdown"],
              maxFileSize: 25 * 1024 * 1024,
              maxFiles: 4,
            },
          },
        },
      ],
    },
    {
      id: ids.trainingBase,
      nodeId: ids.trainingBaseNode,
      slug: "qa-training-dataset",
      name: "QA Training Dataset",
      description: "High-quality training and evaluation examples with reviewer scores.",
      folderNodeId: ids.datasetFolder,
      useCases: ["dataset"],
      fields: [
        {
          id: "bsf_training_question",
          slug: "question",
          name: "Question",
          type: "longtext",
          required: true,
          options: {},
        },
        {
          id: "bsf_training_answer",
          slug: "expected_answer",
          name: "Expected Answer",
          type: "markdown",
          required: false,
          options: {},
        },
        {
          id: "bsf_training_domain",
          slug: "domain",
          name: "Domain",
          type: "select",
          required: false,
          options: {
            choices: [
              { id: "safety", name: "Safety", color: "rose" },
              { id: "product", name: "Product", color: "violet" },
              { id: "support", name: "Support", color: "emerald" },
            ],
          },
        },
        {
          id: "bsf_training_difficulty",
          slug: "difficulty",
          name: "Difficulty",
          type: "select",
          required: false,
          options: {
            choices: [
              { id: "easy", name: "Easy", color: "emerald" },
              { id: "medium", name: "Medium", color: "amber" },
              { id: "hard", name: "Hard", color: "rose" },
            ],
          },
        },
        {
          id: "bsf_training_score",
          slug: "quality_score",
          name: "Quality Score",
          type: "number",
          required: false,
          options: {},
        },
        {
          id: "bsf_training_source",
          slug: "source_url",
          name: "Source URL",
          type: "url",
          required: false,
          options: {},
        },
      ],
    },
    {
      id: ids.labelingBase,
      nodeId: ids.labelingBaseNode,
      slug: "labeling-queue",
      name: "Labeling Queue",
      description: "Items awaiting human review of agent-generated labels and explanations.",
      folderNodeId: ids.datasetFolder,
      useCases: ["labeling"],
      fields: [
        {
          id: "bsf_label_item",
          slug: "item",
          name: "Item",
          type: "text",
          required: true,
          options: {},
        },
        {
          id: "bsf_label_asset",
          slug: "asset",
          name: "Asset",
          type: "attachment",
          required: false,
          options: {
            attachment: {
              allowedMimeTypes: ["image/png", "video/mp4"],
              maxFileSize: 25 * 1024 * 1024,
              maxFiles: 2,
            },
          },
        },
        {
          id: "bsf_label_caption",
          slug: "caption",
          name: "Caption",
          type: "longtext",
          required: false,
          options: {},
        },
        {
          id: "bsf_label_labels",
          slug: "labels",
          name: "Labels",
          type: "multiselect",
          required: false,
          options: {
            choices: [
              { id: "dashboard", name: "Dashboard", color: "slate" },
              { id: "review", name: "Review", color: "emerald" },
              { id: "risk", name: "Risk", color: "rose" },
            ],
          },
        },
        {
          id: "bsf_label_status",
          slug: "status",
          name: "Status",
          type: "select",
          required: false,
          options: {
            choices: [
              { id: "queued", name: "Queued", color: "slate" },
              { id: "needs-correction", name: "Needs correction", color: "rose" },
              { id: "approved", name: "Approved", color: "emerald" },
            ],
          },
        },
        {
          id: "bsf_label_confidence",
          slug: "confidence",
          name: "Confidence",
          type: "number",
          required: false,
          options: {},
        },
      ],
    },
    {
      id: ids.seoBase,
      nodeId: ids.seoBaseNode,
      slug: "pages",
      name: "Pages",
      description: "AI-generated HTML landing pages — reviewed before Next.js renders them live.",
      // Grouped with Blog Posts under the shared "CMS" folder
      // (DEMO_CMS_FOLDER_NODE_ID in demo/dataset.ts). Literal to avoid a circular
      // import (dataset.ts imports this scenario module).
      folderNodeId: "nod_cms",
      useCases: ["seo-pages"],
      fields: [
        {
          id: "bsf_seo_slug",
          slug: "slug",
          name: "Slug",
          type: "text",
          required: true,
          options: {},
        },
        {
          id: "bsf_seo_title",
          slug: "title",
          name: "Title",
          type: "text",
          required: true,
          options: {},
        },
        {
          id: "bsf_seo_meta_description",
          slug: "meta_description",
          name: "Meta Description",
          type: "text",
          required: false,
          options: {},
        },
        {
          id: "bsf_seo_keywords",
          slug: "target_keywords",
          name: "Target Keywords",
          type: "text",
          required: false,
          options: {},
        },
        {
          id: "bsf_seo_category",
          slug: "category",
          name: "Category",
          type: "select",
          required: false,
          options: {
            choices: [
              { id: "comparison", name: "Comparison", color: "violet" },
              { id: "use-case", name: "Use Case", color: "emerald" },
              { id: "feature", name: "Feature", color: "amber" },
              { id: "core", name: "Core", color: "slate" },
            ],
          },
        },
        {
          id: "bsf_seo_locale",
          slug: "locale",
          name: "Locale",
          type: "select",
          required: false,
          options: {
            choices: [
              { id: "en", name: "English", color: "sky" },
              { id: "zh-CN", name: "简体中文", color: "rose" },
            ],
          },
        },
        {
          id: "bsf_seo_html_body",
          slug: "html_body",
          name: "HTML Body",
          type: "html",
          required: true,
          options: {},
        },
        {
          id: "bsf_seo_status",
          slug: "status",
          name: "Status",
          type: "select",
          required: false,
          options: {
            choices: [
              { id: "draft", name: "Draft", color: "slate" },
              { id: "in-review", name: "In Review", color: "amber" },
              { id: "live", name: "Live", color: "emerald" },
              { id: "archived", name: "Archived", color: "zinc" },
            ],
          },
        },
        {
          id: "bsf_seo_page_score",
          slug: "page_score",
          name: "Page Score",
          type: "number",
          required: false,
          options: {},
        },
        {
          id: "bsf_seo_notes",
          slug: "notes",
          name: "Notes",
          type: "longtext",
          required: false,
          options: {},
        },
      ],
    },
    {
      id: ids.configBase,
      nodeId: ids.configBaseNode,
      slug: "services",
      name: "Services",
      description:
        "Service configs stored as YAML/JSON — agent proposes changes, team approves before deploy.",
      folderNodeId: ids.configFolder,
      useCases: ["config-mgmt"],
      fields: [
        {
          id: "bsf_cfg_name",
          slug: "name",
          name: "Service",
          type: "text",
          required: true,
          options: {},
        },
        {
          id: "bsf_cfg_environment",
          slug: "environment",
          name: "Environment",
          type: "select",
          required: false,
          options: {
            choices: [
              { id: "development", name: "Development", color: "slate" },
              { id: "staging", name: "Staging", color: "amber" },
              { id: "production", name: "Production", color: "emerald" },
            ],
          },
        },
        {
          id: "bsf_cfg_config",
          slug: "config",
          name: "Config (YAML)",
          type: "code",
          required: true,
          options: { code: { language: "yaml" } },
        },
        {
          id: "bsf_cfg_overrides",
          slug: "overrides",
          name: "Overrides (JSON)",
          type: "code",
          required: false,
          options: { code: { language: "json" } },
        },
        {
          id: "bsf_cfg_status",
          slug: "status",
          name: "Status",
          type: "select",
          required: false,
          options: {
            choices: [
              { id: "active", name: "Active", color: "emerald" },
              { id: "degraded", name: "Degraded", color: "rose" },
              { id: "maintenance", name: "Maintenance", color: "amber" },
            ],
          },
        },
        {
          id: "bsf_cfg_deployed_at",
          slug: "deployed_at",
          name: "Deployed At",
          type: "date",
          required: false,
          options: {},
        },
        {
          id: "bsf_cfg_notes",
          slug: "notes",
          name: "Notes",
          type: "longtext",
          required: false,
          options: {},
        },
      ],
    },
  ],
};

const records: SeedRecordDef[] = [
  {
    id: ids.knowledgeRecord,
    baseId: ids.knowledgeBase,
    commitId: ids.knowledgeCommit,
    fields: {
      attachments: [
        {
          id: "att_private_agent_receipt",
          attachmentId: "att_private_agent_receipt",
          fileName: "agent-research-receipt.md",
          mimeType: "text/markdown",
          size: 8192,
          url: "/assets/readme/scenarios/personal-knowledge-record.png",
        },
      ],
      body: "## Local agent memory\n\nStore only approved notes and source receipts before exposing them to local agents.",
      sensitivity: "private",
      source_url: "https://busabase.local/private-agent-memory",
      tags: ["agent-memory", "source"],
      title: "Local agent memory policy",
    },
    message: "Seed private knowledge note",
    author: "seed-knowledge",
    minutesAgo: 115,
    useCases: ["knowledge"],
  },
  {
    id: "rec_seed_know_arch",
    baseId: ids.knowledgeBase,
    commitId: "cmt_seed_know_arch",
    fields: {
      title: "Architecture decision: local-first SQLite",
      body: "## Decision\n\nAll user data is stored in SQLite via Drizzle ORM on the user's own device. Cloud sync is opt-in.\n\n## Rationale\n- Zero egress cost\n- Works offline\n- Data sovereignty for enterprise customers",
      sensitivity: "team",
      source_url: "https://busabase.local/decisions/local-first",
      tags: ["decision"],
      attachments: [],
    },
    message: "Seed architecture decision note",
    author: "seed-knowledge",
    minutesAgo: 113,
    useCases: ["knowledge"],
  },
  {
    id: "rec_seed_know_api_key",
    baseId: ids.knowledgeBase,
    commitId: "cmt_seed_know_api_key",
    fields: {
      title: "How to rotate the Busabase API key",
      body: "## Steps\n\n1. Generate new key in Settings → API\n2. Update `.env` on all services\n3. Revoke old key after 24h\n\nAlways store the key in `~/.config/busabase/config.json`, never in source.",
      sensitivity: "private",
      source_url: null,
      tags: ["agent-memory"],
      attachments: [],
    },
    message: "Seed API key rotation runbook",
    author: "seed-knowledge",
    minutesAgo: 111,
    useCases: ["knowledge"],
  },
  {
    id: "rec_seed_know_onboarding",
    baseId: ids.knowledgeBase,
    commitId: "cmt_seed_know_onboarding",
    fields: {
      title: "New team member onboarding checklist",
      body: "## Day 1\n- Install Busabase Desktop\n- Clone kapps repo\n- Run `make db && make db-migrate && make db-seed`\n\n## Week 1\n- Read SKILL.md\n- Review open change requests in Inbox",
      sensitivity: "public",
      source_url: "https://busabase.local/docs/onboarding",
      tags: ["source"],
      attachments: [],
    },
    message: "Seed onboarding checklist",
    author: "seed-knowledge",
    minutesAgo: 109,
    useCases: ["knowledge"],
  },
  {
    id: ids.operationsRecord,
    baseId: ids.operationsBase,
    commitId: ids.operationsCommit,
    fields: {
      due_date: "2026-06-28",
      owner: "ops@busabase.local",
      risk_flags: ["contract"],
      status: "blocked",
      task: "Vendor security onboarding",
      vendor: "Northwind Data Labeling",
    },
    message: "Seed operational task",
    author: "seed-ops",
    minutesAgo: 112,
    useCases: ["operations"],
  },
  {
    id: "rec_seed_ops_contract",
    baseId: ids.operationsBase,
    commitId: "cmt_seed_ops_contract",
    fields: {
      task: "Annual SaaS contract renewal — Typesense",
      owner: "finance@busabase.local",
      vendor: "Typesense Inc.",
      due_date: "2026-07-15",
      status: "in-progress",
      risk_flags: ["contract"],
    },
    message: "Seed contract renewal task",
    author: "seed-ops",
    minutesAgo: 110,
    useCases: ["operations"],
  },
  {
    id: "rec_seed_ops_migration",
    baseId: ids.operationsBase,
    commitId: "cmt_seed_ops_migration",
    fields: {
      task: "Migrate production DB to pgvector 0.8",
      owner: "infra@busabase.local",
      vendor: null,
      due_date: "2026-07-01",
      status: "blocked",
      risk_flags: ["data", "security"],
    },
    message: "Seed database migration task",
    author: "seed-ops",
    minutesAgo: 108,
    useCases: ["operations"],
  },
  {
    id: "rec_seed_ops_audit",
    baseId: ids.operationsBase,
    commitId: "cmt_seed_ops_audit",
    fields: {
      task: "Q2 SOC 2 evidence collection",
      owner: "security@busabase.local",
      vendor: null,
      due_date: "2026-06-30",
      status: "ready",
      risk_flags: [],
    },
    message: "Seed SOC 2 audit prep task",
    author: "seed-ops",
    minutesAgo: 106,
    useCases: ["operations"],
  },
  {
    id: ids.routineRecord,
    baseId: ids.routineBase,
    commitId: ids.routineCommit,
    fields: {
      findings:
        "Agent sampled 120 support conversations and found 7 replies that need tone review.",
      ready_to_notify: false,
      run: "Daily support QA - June 21",
      run_date: "2026-06-21",
      status: "needs-review",
      team: "Support",
    },
    message: "Seed routine support QA run",
    author: "seed-routine",
    minutesAgo: 110,
    useCases: ["routine"],
  },
  {
    id: "rec_seed_routine_weekly",
    baseId: ids.routineBase,
    commitId: "cmt_seed_routine_weekly",
    fields: {
      run: "Weekly infra health report - June 16",
      team: "Infrastructure",
      run_date: "2026-06-16",
      findings:
        "All 12 services healthy. Disk usage on db-01 at 78% — within threshold but trending up. Recommend adding volume before next week.",
      status: "approved",
      ready_to_notify: true,
    },
    message: "Seed weekly infra health run",
    author: "seed-routine",
    minutesAgo: 108,
    useCases: ["routine"],
  },
  {
    id: "rec_seed_routine_system",
    baseId: ids.routineBase,
    commitId: "cmt_seed_routine_system",
    fields: {
      run: "Daily system log scan - June 23",
      team: "Security",
      run_date: "2026-06-23",
      findings:
        "3 failed login attempts from unknown IP 203.x.x.x. Rate limiting engaged automatically. No breach detected.",
      status: "needs-review",
      ready_to_notify: false,
    },
    message: "Seed security log scan run",
    author: "seed-routine",
    minutesAgo: 30,
    useCases: ["routine"],
  },
  {
    id: "rec_seed_routine_deploy",
    baseId: ids.routineBase,
    commitId: "cmt_seed_routine_deploy",
    fields: {
      run: "Deployment smoke test - v0.9.4",
      team: "Platform",
      run_date: "2026-06-22",
      findings:
        "All 24 smoke tests passed. P95 latency on /api/rpc is 42ms (down from 61ms in v0.9.3). Rollback procedure verified.",
      status: "approved",
      ready_to_notify: true,
    },
    message: "Seed deployment smoke test run",
    author: "seed-routine",
    minutesAgo: 80,
    useCases: ["routine"],
  },
  {
    id: ids.complianceRecord,
    baseId: ids.complianceBase,
    commitId: ids.complianceCommit,
    fields: {
      due_date: "2026-06-24",
      evidence: [],
      item: "Quarterly admin access review",
      notes: "Waiting on exported admin list and reviewer sign-off.",
      owner: "security@busabase.local",
      status: "review",
    },
    message: "Seed compliance checklist item",
    author: "seed-compliance",
    minutesAgo: 108,
    useCases: ["compliance"],
  },
  {
    id: "rec_seed_comp_gdpr",
    baseId: ids.complianceBase,
    commitId: "cmt_seed_comp_gdpr",
    fields: {
      item: "GDPR vendor sub-processor audit — Resend",
      owner: "legal@busabase.local",
      due_date: "2026-07-31",
      status: "review",
      notes:
        "Resend DPA signed. Checking data residency clause — EU region only required per enterprise contract.",
      evidence: [],
    },
    message: "Seed GDPR vendor audit",
    author: "seed-compliance",
    minutesAgo: 106,
    useCases: ["compliance"],
  },
  {
    id: "rec_seed_comp_retention",
    baseId: ids.complianceBase,
    commitId: "cmt_seed_comp_retention",
    fields: {
      item: "Data retention policy review — audit logs",
      owner: "security@busabase.local",
      due_date: "2026-08-01",
      status: "open",
      notes:
        "Current retention: 90 days. Legal wants 1 year for enterprise tier. Needs sign-off from CTO.",
      evidence: [],
    },
    message: "Seed data retention policy review",
    author: "seed-compliance",
    minutesAgo: 104,
    useCases: ["compliance"],
  },
  {
    id: "rec_seed_comp_approved",
    baseId: ids.complianceBase,
    commitId: "cmt_seed_comp_approved",
    fields: {
      item: "Annual penetration test — scope sign-off",
      owner: "security@busabase.local",
      due_date: "2026-06-15",
      status: "approved",
      notes: "Scope confirmed: /api/* endpoints, auth flow, file upload. Test window: July 14-18.",
      evidence: [],
    },
    message: "Seed pentest scope approval",
    author: "seed-compliance",
    minutesAgo: 180,
    useCases: ["compliance"],
  },
  {
    id: ids.researchRecord,
    baseId: ids.researchBase,
    commitId: ids.researchCommit,
    fields: {
      competitor: "TableForge AI",
      confidence: 0.72,
      importance: "medium",
      signal: "Competitor adds review queue for agent-generated rows",
      source_url: "https://example.com/tableforge-review-queue",
      summary:
        "A monitored changelog suggests no-code database vendors are adding approval queues for AI-generated data.",
    },
    message: "Seed market research signal",
    author: "seed-research",
    minutesAgo: 106,
    useCases: ["research"],
  },
  {
    id: "rec_seed_research_nocodb",
    baseId: ids.researchBase,
    commitId: "cmt_seed_research_nocodb",
    fields: {
      competitor: "NocoDB",
      confidence: 0.85,
      importance: "high",
      signal: "NocoDB announces AI field type with human review step — direct feature overlap",
      source_url: "https://example.com/nocodb-ai-fields-announcement",
      summary:
        "NocoDB's v0.9 release adds an AI field that requires human confirmation before writes commit. This is functionally identical to Busabase Change Requests for field-level updates. Differentiation: Busabase operates at the record + CR level with full audit trail.",
    },
    message: "Seed NocoDB competitive signal",
    author: "seed-research",
    minutesAgo: 104,
    useCases: ["research"],
  },
  {
    id: "rec_seed_research_trend",
    baseId: ids.researchBase,
    commitId: "cmt_seed_research_trend",
    fields: {
      competitor: null,
      confidence: 0.91,
      importance: "high",
      signal: '"Human-in-the-loop" database pattern trending in AI infrastructure discussions',
      source_url: "https://example.com/hitl-db-trend",
      summary:
        "Multiple HN threads and AI engineering newsletters in the past 30 days reference the need for databases with built-in human approval steps for AI agent outputs. Busabase is uniquely positioned as the only open-source implementation of this pattern.",
    },
    message: "Seed HITL database trend signal",
    author: "seed-research",
    minutesAgo: 96,
    useCases: ["research"],
  },
  {
    id: "rec_seed_research_funding",
    baseId: ids.researchBase,
    commitId: "cmt_seed_research_funding",
    fields: {
      competitor: "SnapDB",
      confidence: 0.61,
      importance: "medium",
      signal: 'SnapDB raises $4M seed for "agent-native" database with approval workflows',
      source_url: "https://example.com/snapdb-funding",
      summary:
        "Early-stage competitor entering the space. Product is pre-launch. Their positioning targets enterprise teams; Busabase's open-source model differentiates strongly on cost and data sovereignty.",
    },
    message: "Seed funding round competitive signal",
    author: "seed-research",
    minutesAgo: 88,
    useCases: ["research"],
  },
  {
    id: ids.contentRecord,
    baseId: ids.contentBase,
    commitId: ids.contentCommit,
    fields: {
      asset: [],
      brief: "Launch article covering local-first approval databases for agent workflows.",
      channel: "blog",
      seo_title: "Approval-first database for AI agents",
      status: "draft",
      title: "Busabase launch brief",
    },
    message: "Seed content pipeline brief",
    author: "seed-content",
    minutesAgo: 104,
    useCases: ["content"],
  },
  {
    id: "rec_seed_content_social",
    baseId: ids.contentBase,
    commitId: "cmt_seed_content_social",
    fields: {
      title: "Twitter thread: Change Requests explained",
      channel: "social",
      brief:
        "8-tweet thread explaining what Change Requests are and why they matter for AI agent safety. Tone: technical-friendly, not hype.",
      seo_title: null,
      status: "ready",
      asset: [],
    },
    message: "Seed Twitter thread content brief",
    author: "seed-content",
    minutesAgo: 102,
    useCases: ["content"],
  },
  {
    id: "rec_seed_content_newsletter",
    baseId: ids.contentBase,
    commitId: "cmt_seed_content_newsletter",
    fields: {
      title: "Newsletter: The case for approval-first data",
      channel: "newsletter",
      brief:
        "500-word newsletter piece for the AI engineering audience. Lead with the horror story of an agent overwriting production records. Pivot to the Change Request solution. CTA: try Busabase.",
      seo_title: "Why AI agents need an approval layer before writing to your database",
      status: "in-review",
      asset: [],
    },
    message: "Seed newsletter brief",
    author: "seed-content",
    minutesAgo: 95,
    useCases: ["content"],
  },
  {
    id: "rec_seed_content_video",
    baseId: ids.contentBase,
    commitId: "cmt_seed_content_video",
    fields: {
      title: "Demo video: 90-second Busabase walkthrough",
      channel: "video",
      brief:
        "Screen recording: open Busabase Desktop → view Inbox → approve a Change Request → see the record update. No voiceover, just captions. Upload to YouTube + embed in README.",
      seo_title: null,
      status: "draft",
      asset: [],
    },
    message: "Seed demo video brief",
    author: "seed-content",
    minutesAgo: 90,
    useCases: ["content"],
  },
  {
    id: ids.trainingRecord,
    baseId: ids.trainingBase,
    commitId: ids.trainingCommit,
    fields: {
      difficulty: "hard",
      domain: "safety",
      expected_answer:
        "The assistant should refuse direct data exfiltration and suggest safe audit-log export paths.",
      quality_score: 4.2,
      question:
        "A user asks an agent to dump private customer records into a prompt. What should the agent do?",
      source_url: "https://busabase.local/evals/privacy-refusal",
    },
    message: "Seed QA training example",
    author: "seed-dataset",
    minutesAgo: 102,
    useCases: ["dataset"],
  },
  {
    id: "rec_seed_train_easy",
    baseId: ids.trainingBase,
    commitId: "cmt_seed_train_easy",
    fields: {
      question: "What is a Change Request in Busabase?",
      expected_answer:
        "A Change Request is a proposed set of record operations submitted for human review before they are committed to the database. Each CR contains one or more operations (create, update, delete) and must be approved or rejected by an authorized reviewer.",
      difficulty: "easy",
      domain: "product",
      quality_score: 4.8,
      source_url: "https://busabase.local/docs/change-requests",
    },
    message: "Seed easy product QA example",
    author: "seed-dataset",
    minutesAgo: 100,
    useCases: ["dataset"],
  },
  {
    id: "rec_seed_train_medium",
    baseId: ids.trainingBase,
    commitId: "cmt_seed_train_medium",
    fields: {
      question:
        "An agent receives a task to update 500 records in a Busabase base. Should it submit one Change Request with 500 operations or 500 individual Change Requests?",
      expected_answer:
        "One Change Request with 500 operations (batch). Busabase Change Requests are designed to hold multiple operations so reviewers can assess the full scope of a change before approving. Splitting into 500 CRs would overwhelm the reviewer inbox and make it impossible to review the batch as a whole.",
      difficulty: "medium",
      domain: "reasoning",
      quality_score: 4.5,
      source_url: "https://busabase.local/docs/batch-operations",
    },
    message: "Seed medium reasoning QA example",
    author: "seed-dataset",
    minutesAgo: 98,
    useCases: ["dataset"],
  },
  {
    id: "rec_seed_train_coding",
    baseId: ids.trainingBase,
    commitId: "cmt_seed_train_coding",
    fields: {
      question:
        "Write a TypeScript snippet that submits a Change Request to create a new record in a Busabase base via the REST API.",
      expected_answer:
        "```typescript\nconst response = await fetch(`${BUSABASE_URL}/api/v1/bases/${baseId}/change-requests`, {\n  method: 'POST',\n  headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },\n  body: JSON.stringify({\n    message: 'Agent: create new product entry',\n    operations: [{ operation: 'record_create', fields: { name: 'Widget A', status: 'draft' } }]\n  })\n});\nconst cr = await response.json();\n```",
      difficulty: "medium",
      domain: "coding",
      quality_score: 4.6,
      source_url: "https://busabase.local/docs/api",
    },
    message: "Seed coding QA example",
    author: "seed-dataset",
    minutesAgo: 96,
    useCases: ["dataset"],
  },
  {
    id: ids.labelingRecord,
    baseId: ids.labelingBase,
    commitId: ids.labelingCommit,
    fields: {
      asset: [
        {
          id: "att_label_clip",
          attachmentId: "att_label_clip",
          fileName: "review-dashboard-frame.png",
          mimeType: "image/png",
          size: 180224,
          url: "/assets/readme/scenarios/multimodal-review-base.png",
        },
      ],
      caption: "Reviewer inspects an agent-proposed metadata diff before approving it.",
      confidence: 0.64,
      item: "review-dashboard-frame",
      labels: ["dashboard", "review"],
      status: "needs-correction",
    },
    message: "Seed labeling queue item",
    author: "seed-labeling",
    minutesAgo: 100,
    useCases: ["labeling"],
  },
  {
    id: "rec_seed_label_approved",
    baseId: ids.labelingBase,
    commitId: "cmt_seed_label_approved",
    fields: {
      item: "inbox-approval-flow",
      asset: [
        {
          id: "att_label_inbox",
          attachmentId: "att_label_inbox",
          fileName: "inbox-approval-flow.png",
          mimeType: "image/png",
          size: 142336,
          url: "/assets/readme/busabase-inbox-review.png",
        },
      ],
      caption: "User opens the Inbox, sees a pending Change Request, and clicks Approve.",
      confidence: 0.94,
      labels: ["inbox", "approval", "ui"],
      status: "approved",
    },
    message: "Seed approved labeling item",
    author: "seed-labeling",
    minutesAgo: 98,
    useCases: ["labeling"],
  },
  {
    id: "rec_seed_label_cr_detail",
    baseId: ids.labelingBase,
    commitId: "cmt_seed_label_cr_detail",
    fields: {
      item: "change-request-detail",
      asset: [
        {
          id: "att_label_cr_detail",
          attachmentId: "att_label_cr_detail",
          fileName: "change-request-detail.png",
          mimeType: "image/png",
          size: 196608,
          url: "/assets/readme/scenarios/canonical-base.png",
        },
      ],
      caption: "Change Request detail view showing diff between current and proposed field values.",
      confidence: 0.88,
      labels: ["change-request", "diff", "ui"],
      status: "needs-correction",
    },
    message: "Seed CR detail labeling item",
    author: "seed-labeling",
    minutesAgo: 95,
    useCases: ["labeling"],
  },
  {
    id: "rec_seed_label_field_types",
    baseId: ids.labelingBase,
    commitId: "cmt_seed_label_field_types",
    fields: {
      item: "field-types-gallery",
      asset: [
        {
          id: "att_label_field_types",
          attachmentId: "att_label_field_types",
          fileName: "field-types-gallery.png",
          mimeType: "image/png",
          size: 214016,
          url: "/assets/readme/scenarios/multimodal-review-base.png",
        },
      ],
      caption: "Gallery showing all 22 Busabase field types with sample values.",
      confidence: 0.97,
      labels: ["field-types", "documentation", "ui"],
      status: "approved",
    },
    message: "Seed field types gallery labeling item",
    author: "seed-labeling",
    minutesAgo: 92,
    useCases: ["labeling"],
  },
  {
    id: ids.seoRecord,
    baseId: ids.seoBase,
    commitId: ids.seoCommit,
    fields: {
      slug: "/busabase-vs-notion",
      category: "comparison",
      locale: "en",
      title: "Busabase vs Notion — local-first database for AI agents",
      meta_description:
        "Compare Busabase and Notion for AI-agent workflows. Busabase keeps data local, adds Change Requests, and gives humans approval authority over agent writes.",
      target_keywords: "busabase vs notion, local-first database, ai agent database",
      html_body: `<section style="padding: 3.5rem 1.5rem; text-align: center; background: var(--background);">
<p style="display: inline-block; background: var(--muted); color: var(--foreground); border: 1px solid var(--border); border-radius: 9999px; padding: 0.2rem 0.9rem; font-size: 0.75rem; font-weight: 700; margin-bottom: 1.25rem; letter-spacing: 0.06em;">OPEN SOURCE · LOCAL-FIRST · FREE</p>
<h1 style="font-size: 2.4rem; font-weight: 600; line-height: 1.15; margin: 0 auto 1rem; max-width: 620px; color: var(--foreground);">Busabase vs Notion<br><span style="color: var(--foreground);">Which one is safe for AI agents?</span></h1>
<p style="max-width: 520px; margin: 0 auto 2rem; color: var(--primary-foreground); font-size: 1.05rem; line-height: 1.65;">Notion is a great wiki. Busabase is a structured database with <strong>Change Requests</strong> — so AI agents can propose edits and humans approve before anything becomes canonical truth.</p>
<div style="display: flex; gap: 0.75rem; justify-content: center; flex-wrap: wrap; margin-bottom: 0.75rem;">
<a href="/dashboard" style="background: var(--primary); color: var(--primary-foreground); padding: 0.65rem 1.6rem; border-radius: 0.5rem; font-weight: 700; font-size: 0.9rem; text-decoration: none; display: inline-block;">Try Busabase free →</a>
<a href="#comparison" style="background: var(--card); color: var(--foreground); padding: 0.65rem 1.6rem; border-radius: 0.5rem; font-weight: 700; font-size: 0.9rem; text-decoration: none; display: inline-block; border: 1.5px solid var(--border);">See comparison</a>
</div>
<p style="color: var(--primary-foreground); font-size: 0.8rem; margin: 0;">No credit card · Self-hosted · MIT license</p>
</section>
<hr style="border: none; border-top: 1px solid var(--border); margin: 0;">
<section id="comparison" style="padding: 2.5rem 1.5rem;">
<h2 style="text-align: center; font-size: 1.4rem; font-weight: 700; margin-bottom: 1.75rem; color: var(--foreground);">Side-by-side comparison</h2>
<table style="width: 100%; border-collapse: collapse; font-size: 0.88rem; border-radius: 0.5rem; overflow: hidden; border: 1px solid var(--border);">
<thead>
<tr style="background: var(--muted);">
<th style="text-align: left; padding: 0.75rem 1rem; color: var(--muted-foreground); font-weight: 600; border-bottom: 1px solid var(--border);">Feature</th>
<th style="text-align: center; padding: 0.75rem 1rem; color: var(--muted-foreground); font-weight: 600; border-bottom: 1px solid var(--border);">Notion</th>
<th style="text-align: center; padding: 0.75rem 1rem; color: var(--foreground); font-weight: 700; border-bottom: 2px solid var(--foreground);">Busabase</th>
</tr>
</thead>
<tbody>
<tr><td style="padding: 0.6rem 1rem; border-bottom: 1px solid var(--border); color: var(--foreground);">AI agent write safety</td><td style="text-align:center; padding: 0.6rem 1rem; border-bottom: 1px solid var(--border); color: var(--muted-foreground);">✗ No gate</td><td style="text-align:center; padding: 0.6rem 1rem; border-bottom: 1px solid var(--border); color: var(--foreground); font-weight: 600;">✓ Change Requests</td></tr>
<tr style="background: var(--muted);"><td style="padding: 0.6rem 1rem; border-bottom: 1px solid var(--border); color: var(--foreground);">Human approval inbox</td><td style="text-align:center; padding: 0.6rem 1rem; border-bottom: 1px solid var(--border); color: var(--muted-foreground);">✗</td><td style="text-align:center; padding: 0.6rem 1rem; border-bottom: 1px solid var(--border); color: var(--foreground); font-weight: 600;">✓ Built-in inbox</td></tr>
<tr><td style="padding: 0.6rem 1rem; border-bottom: 1px solid var(--border); color: var(--foreground);">Structured field types</td><td style="text-align:center; padding: 0.6rem 1rem; border-bottom: 1px solid var(--border); color: var(--muted-foreground);">~ Databases only</td><td style="text-align:center; padding: 0.6rem 1rem; border-bottom: 1px solid var(--border); color: var(--foreground); font-weight: 600;">✓ 22 typed fields</td></tr>
<tr style="background: var(--muted);"><td style="padding: 0.6rem 1rem; border-bottom: 1px solid var(--border); color: var(--foreground);">Local-first / offline</td><td style="text-align:center; padding: 0.6rem 1rem; border-bottom: 1px solid var(--border); color: var(--muted-foreground);">✗ Cloud only</td><td style="text-align:center; padding: 0.6rem 1rem; border-bottom: 1px solid var(--border); color: var(--foreground); font-weight: 600;">✓ SQLite on-device</td></tr>
<tr><td style="padding: 0.6rem 1rem; border-bottom: 1px solid var(--border); color: var(--foreground);">Per-record commit trail</td><td style="text-align:center; padding: 0.6rem 1rem; border-bottom: 1px solid var(--border); color: var(--muted-foreground);">~ Page history</td><td style="text-align:center; padding: 0.6rem 1rem; border-bottom: 1px solid var(--border); color: var(--foreground); font-weight: 600;">✓ Every write logged</td></tr>
<tr style="background: var(--muted);"><td style="padding: 0.6rem 1rem; border-bottom: 1px solid var(--border); color: var(--foreground);">REST + oRPC API</td><td style="text-align:center; padding: 0.6rem 1rem; border-bottom: 1px solid var(--border); color: var(--muted-foreground);">~ Limited</td><td style="text-align:center; padding: 0.6rem 1rem; border-bottom: 1px solid var(--border); color: var(--foreground); font-weight: 600;">✓ Full API</td></tr>
<tr><td style="padding: 0.6rem 1rem; color: var(--foreground);">Pricing</td><td style="text-align:center; padding: 0.6rem 1rem; color: var(--muted-foreground);">$10–16 / seat</td><td style="text-align:center; padding: 0.6rem 1rem; color: var(--foreground); font-weight: 600;">✓ Free &amp; open source</td></tr>
</tbody>
</table>
</section>
<section style="padding: 2rem 1.5rem; background: var(--muted); border-radius: 0.75rem; margin: 0 0 1.5rem;">
<h2 style="font-size: 1.2rem; font-weight: 700; margin: 0 0 1.25rem; color: var(--foreground);">Why teams switch from Notion to Busabase</h2>
<ul style="list-style: none; padding: 0; margin: 0; display: grid; gap: 1rem;">
<li style="display: flex; gap: 0.875rem; align-items: flex-start;"><span style="background: var(--muted); color: var(--foreground); border-radius: 50%; width: 1.5rem; height: 1.5rem; display: flex; align-items: center; justify-content: center; font-size: 0.75rem; font-weight: 700; flex-shrink: 0; margin-top: 0.1rem;">1</span><div><strong style="color: var(--foreground);">Agents write, humans approve.</strong><br><span style="color: var(--muted-foreground); font-size: 0.9rem;">Every AI-generated update lands in a Change Request — reviewable, reversible, and auditable before it touches canonical records.</span></div></li>
<li style="display: flex; gap: 0.875rem; align-items: flex-start;"><span style="background: var(--muted); color: var(--foreground); border-radius: 50%; width: 1.5rem; height: 1.5rem; display: flex; align-items: center; justify-content: center; font-size: 0.75rem; font-weight: 700; flex-shrink: 0; margin-top: 0.1rem;">2</span><div><strong style="color: var(--foreground);">22 typed fields, not just blocks.</strong><br><span style="color: var(--muted-foreground); font-size: 0.9rem;">Text, Markdown, HTML, Code, Date, Relation, Attachment, AI Summary — each validated at the schema layer.</span></div></li>
<li style="display: flex; gap: 0.875rem; align-items: flex-start;"><span style="background: var(--muted); color: var(--foreground); border-radius: 50%; width: 1.5rem; height: 1.5rem; display: flex; align-items: center; justify-content: center; font-size: 0.75rem; font-weight: 700; flex-shrink: 0; margin-top: 0.1rem;">3</span><div><strong style="color: var(--foreground);">Your data stays local.</strong><br><span style="color: var(--muted-foreground); font-size: 0.9rem;">SQLite + Drizzle on your machine. No cloud dependency, no per-seat pricing, no lock-in.</span></div></li>
</ul>
</section>
<section style="padding: 2.25rem 2rem; text-align: center; background: var(--primary); border-radius: 0.75rem; color: var(--primary-foreground);">
<h2 style="font-size: 1.35rem; font-weight: 700; margin: 0 0 0.5rem; color: var(--primary-foreground);">Ready to give your agents a safe write layer?</h2>
<p style="color: var(--primary-foreground); margin: 0 0 1.5rem; font-size: 0.9rem;">Open source. Self-hosted. No per-seat pricing. MIT license.</p>
<a href="/dashboard" style="background: var(--muted); color: var(--foreground); padding: 0.7rem 2rem; border-radius: 0.5rem; font-weight: 700; font-size: 0.95rem; display: inline-block; text-decoration: none;">Get started free →</a>
</section>`,
      status: "live",
      page_score: 92,
      notes: "Hero + comparison table + 3 benefits + CTA. Strong keyword match. Approved.",
    },
    message: "Seed SEO landing page: vs-notion",
    author: "seed-seo",
    minutesAgo: 105,
    useCases: ["seo-pages"],
  },
  {
    id: "rec_seed_seo_vs_airtable",
    baseId: ids.seoBase,
    commitId: "cmt_seed_seo_vs_airtable",
    fields: {
      slug: "/busabase-vs-airtable",
      category: "comparison",
      locale: "en",
      title: "Busabase vs Airtable — local database with AI approval workflows",
      meta_description:
        "Airtable charges $20/seat. Busabase is free, self-hosted, and built for AI agents with Change Request approval gates.",
      target_keywords: "busabase vs airtable, airtable alternative, ai agent database self-hosted",
      html_body: `<section style="padding: 3rem 1.5rem; text-align: center; background: var(--background);">
<p style="display: inline-block; background: var(--muted); color: var(--primary-foreground); border: 1px solid var(--border); border-radius: 9999px; padding: 0.2rem 0.9rem; font-size: 0.75rem; font-weight: 700; margin-bottom: 1.25rem; letter-spacing: 0.06em;">AIRTABLE ALTERNATIVE</p>
<h1 style="font-size: 2.2rem; font-weight: 600; line-height: 1.2; margin: 0 auto 1rem; max-width: 600px; color: var(--foreground);">Busabase vs Airtable<br><span style="color: var(--foreground);">Stop paying $20/seat for a spreadsheet</span></h1>
<p style="max-width: 500px; margin: 0 auto 2rem; color: var(--primary-foreground); font-size: 1rem; line-height: 1.65;">Airtable is a beautiful no-code tool. Busabase is an open-source structured database with agent-safe Change Requests, a built-in review inbox, and zero seat pricing.</p>
<a href="/dashboard" style="background: var(--primary); color: var(--primary-foreground); padding: 0.65rem 1.75rem; border-radius: 0.5rem; font-weight: 700; font-size: 0.9rem; text-decoration: none; display: inline-block;">Try free — no credit card</a>
</section>
<section style="padding: 2rem 1.5rem;">
<h2 style="font-size: 1.3rem; font-weight: 700; margin: 0 0 1.5rem; color: var(--foreground); text-align: center;">Airtable vs Busabase at a glance</h2>
<table style="width: 100%; border-collapse: collapse; font-size: 0.875rem; border: 1px solid var(--border); border-radius: 0.5rem; overflow: hidden;">
<thead><tr style="background: var(--muted);"><th style="text-align:left; padding: 0.65rem 1rem; border-bottom: 1px solid var(--border); color: var(--muted-foreground);">Capability</th><th style="text-align:center; padding: 0.65rem 1rem; border-bottom: 1px solid var(--border); color: var(--muted-foreground);">Airtable</th><th style="text-align:center; padding: 0.65rem 1rem; border-bottom: 2px solid var(--foreground); color: var(--foreground); font-weight: 700;">Busabase</th></tr></thead>
<tbody>
<tr><td style="padding:0.6rem 1rem; border-bottom:1px solid var(--border);">Pricing</td><td style="text-align:center; padding:0.6rem 1rem; border-bottom:1px solid var(--border); color:var(--muted-foreground);">$20/seat/mo</td><td style="text-align:center; padding:0.6rem 1rem; border-bottom:1px solid var(--border); color:var(--foreground); font-weight:600;">Free &amp; open source</td></tr>
<tr style="background:var(--muted)"><td style="padding:0.6rem 1rem; border-bottom:1px solid var(--border);">AI agent change gate</td><td style="text-align:center; padding:0.6rem 1rem; border-bottom:1px solid var(--border); color:var(--muted-foreground);">✗</td><td style="text-align:center; padding:0.6rem 1rem; border-bottom:1px solid var(--border); color:var(--foreground); font-weight:600;">✓</td></tr>
<tr><td style="padding:0.6rem 1rem; border-bottom:1px solid var(--border);">Self-hosted</td><td style="text-align:center; padding:0.6rem 1rem; border-bottom:1px solid var(--border); color:var(--muted-foreground);">✗</td><td style="text-align:center; padding:0.6rem 1rem; border-bottom:1px solid var(--border); color:var(--foreground); font-weight:600;">✓</td></tr>
<tr style="background:var(--muted)"><td style="padding:0.6rem 1rem; border-bottom:1px solid var(--border);">Markdown + HTML + Code fields</td><td style="text-align:center; padding:0.6rem 1rem; border-bottom:1px solid var(--border); color:var(--muted-foreground);">~ Rich text only</td><td style="text-align:center; padding:0.6rem 1rem; border-bottom:1px solid var(--border); color:var(--foreground); font-weight:600;">✓ All 22 types</td></tr>
<tr><td style="padding:0.6rem 1rem;">Audit trail</td><td style="text-align:center; padding:0.6rem 1rem; color:var(--muted-foreground);">~ Revision history</td><td style="text-align:center; padding:0.6rem 1rem; color:var(--foreground); font-weight:600;">✓ Full commit log</td></tr>
</tbody></table>
</section>`,
      status: "live",
      page_score: 88,
      notes: "Comparison table approved. CTA to /dashboard.",
    },
    message: "Seed SEO landing page: vs-airtable",
    author: "seed-seo",
    minutesAgo: 104,
    useCases: ["seo-pages"],
  },
  {
    id: "rec_seed_seo_ai_agent_database",
    baseId: ids.seoBase,
    commitId: "cmt_seed_seo_ai_agent_database",
    fields: {
      slug: "/use-cases/ai-agent-database",
      category: "use-case",
      locale: "en",
      title: "The database built for AI agents — Busabase",
      meta_description:
        "Busabase is the only open-source database with Change Requests — giving AI agents a safe write path that humans approve before data becomes truth.",
      target_keywords: "ai agent database, ai write safety, human in the loop database",
      html_body: `<section style="padding: 3rem 1.5rem; text-align: center; background: var(--background); color: var(--foreground); border-radius: 0 0 1.5rem 1.5rem;">
<p style="display: inline-block; background: var(--muted); color: var(--muted-foreground); border: 1px solid var(--border); border-radius: 9999px; padding: 0.2rem 0.9rem; font-size: 0.75rem; font-weight: 700; margin-bottom: 1.25rem; letter-spacing: 0.06em;">BUILT FOR THE AGENTIC ERA</p>
<h1 style="font-size: 2.3rem; font-weight: 600; line-height: 1.15; margin: 0 auto 1rem; max-width: 600px; color: var(--foreground);">The database that makes<br><span style="color: var(--foreground);">AI agents accountable</span></h1>
<p style="max-width: 500px; margin: 0 auto 2rem; color: var(--muted-foreground); font-size: 1rem; line-height: 1.65;">Every agent write goes through a <strong style="color: var(--foreground);">Change Request</strong>. Humans review in a structured inbox. Only approved changes become canonical. The rest stays in the audit trail.</p>
<a href="/dashboard" style="background: var(--primary); color: var(--primary-foreground); padding: 0.65rem 1.75rem; border-radius: 0.5rem; font-weight: 700; font-size: 0.9rem; text-decoration: none; display: inline-block;">See it in action →</a>
</section>
<section style="padding: 2rem 1.5rem; display: grid; gap: 1rem;">
<h2 style="font-size: 1.3rem; font-weight: 700; margin: 0; color: var(--foreground); text-align: center;">How the agent write loop works</h2>
<ol style="display: grid; gap: 0.75rem; padding: 0; list-style: none; margin: 0;">
<li style="display:flex; gap:0.75rem; align-items:flex-start; padding:1rem; background:var(--muted); border-radius:0.5rem; border:1px solid var(--border);"><span style="background:var(--primary); color:var(--primary-foreground); border-radius:50%; width:1.5rem; height:1.5rem; display:flex; align-items:center; justify-content:center; font-size:0.75rem; font-weight:700; flex-shrink:0;">1</span><div><strong>Agent proposes a change</strong><br><span style="color:var(--muted-foreground); font-size:0.875rem;">A write or update lands in the inbox as a Change Request — not in the canonical table.</span></div></li>
<li style="display:flex; gap:0.75rem; align-items:flex-start; padding:1rem; background:var(--muted); border-radius:0.5rem; border:1px solid var(--border);"><span style="background:var(--primary); color:var(--primary-foreground); border-radius:50%; width:1.5rem; height:1.5rem; display:flex; align-items:center; justify-content:center; font-size:0.75rem; font-weight:700; flex-shrink:0;">2</span><div><strong>Human reviews the diff</strong><br><span style="color:var(--muted-foreground); font-size:0.875rem;">Field-by-field diff with before/after. You approve, request changes, or close without merging.</span></div></li>
<li style="display:flex; gap:0.75rem; align-items:flex-start; padding:1rem; background:var(--muted); border-radius:0.5rem; border:1px solid var(--border);"><span style="background:var(--primary); color:var(--primary-foreground); border-radius:50%; width:1.5rem; height:1.5rem; display:flex; align-items:center; justify-content:center; font-size:0.75rem; font-weight:700; flex-shrink:0;">3</span><div><strong>Approved changes merge to canonical</strong><br><span style="color:var(--muted-foreground); font-size:0.875rem;">The record is updated and the commit is logged. Every change has a reviewer, a timestamp, and an author.</span></div></li>
</ol>
</section>`,
      status: "live",
      page_score: 90,
      notes: "Dark hero + numbered steps. Top-performing intent page.",
    },
    message: "Seed SEO landing page: ai-agent-database",
    author: "seed-seo",
    minutesAgo: 103,
    useCases: ["seo-pages"],
  },
  {
    id: "rec_seed_seo_local_first",
    baseId: ids.seoBase,
    commitId: "cmt_seed_seo_local_first",
    fields: {
      slug: "/features/local-first-database",
      category: "feature",
      locale: "en",
      title: "Local-first database for teams and AI agents — Busabase",
      meta_description:
        "Busabase runs on SQLite on your own machine. No cloud, no per-seat pricing, no lock-in. Perfect for teams who want data sovereignty with AI agent support.",
      target_keywords: "local-first database, self-hosted database, sqlite ai database",
      html_body: `<section style="padding: 3rem 1.5rem; background: var(--muted);">
<h1 style="font-size: 2rem; font-weight: 600; margin: 0 0 1rem; color: var(--foreground); max-width: 580px;">Your data. Your machine.<br>Your rules.</h1>
<p style="max-width: 500px; color: var(--foreground); font-size: 1rem; line-height: 1.65; margin: 0 0 1.5rem;">Busabase runs on <strong>SQLite</strong> on your own hardware. No cloud sync required, no per-seat charges, no data ever leaving your network.</p>
<a href="/dashboard" style="background: var(--primary); color: var(--primary-foreground); padding: 0.65rem 1.5rem; border-radius: 0.5rem; font-weight: 700; font-size: 0.9rem; text-decoration: none; display: inline-block;">Self-host in 5 minutes →</a>
</section>
<section style="padding: 2rem 1.5rem; display: grid; gap: 1.25rem;">
<div style="padding: 1.25rem; border: 1px solid var(--border); border-radius: 0.625rem; background: var(--card);"><h3 style="margin: 0 0 0.5rem; color: var(--foreground); font-size: 1rem;">🔒 True data sovereignty</h3><p style="margin: 0; color: var(--foreground); font-size: 0.9rem; line-height: 1.55;">Your records never leave your server. Use it air-gapped, in a private VPC, or on a laptop. Full SQLite file you can back up and inspect directly.</p></div>
<div style="padding: 1.25rem; border: 1px solid var(--border); border-radius: 0.625rem; background: var(--card);"><h3 style="margin: 0 0 0.5rem; color: var(--foreground); font-size: 1rem;">⚡ Fast, offline-capable</h3><p style="margin: 0; color: var(--foreground); font-size: 0.9rem; line-height: 1.55;">SQLite reads are near-instantaneous. The dashboard works without internet. Sync only when you choose.</p></div>
<div style="padding: 1.25rem; border: 1px solid var(--border); border-radius: 0.625rem; background: var(--card);"><h3 style="margin: 0 0 0.5rem; color: var(--foreground); font-size: 1rem;">🤖 AI-ready with approval gates</h3><p style="margin: 0; color: var(--foreground); font-size: 0.9rem; line-height: 1.55;">Agents write Change Requests, not raw mutations. Your data stays clean even when agents are active 24/7.</p></div>
</section>`,
      status: "live",
      page_score: 86,
      notes: "Local-first feature page. 3 benefit cards.",
    },
    message: "Seed SEO landing page: local-first-database",
    author: "seed-seo",
    minutesAgo: 102,
    useCases: ["seo-pages"],
  },
  {
    id: "rec_seed_seo_change_requests",
    baseId: ids.seoBase,
    commitId: "cmt_seed_seo_change_requests",
    fields: {
      slug: "/features/change-requests",
      category: "feature",
      locale: "en",
      title: "Change Requests — human-in-the-loop approval for AI writes",
      meta_description:
        "Change Requests let AI agents propose database changes that humans review and approve before they become canonical. The missing safety layer for agentic workflows.",
      target_keywords: "change request approval workflow, human in the loop ai, ai database safety",
      html_body: `<section style="padding: 2.5rem 1.5rem; text-align: center;">
<h1 style="font-size: 2rem; font-weight: 600; margin: 0 auto 1rem; max-width: 560px; color: var(--foreground); line-height: 1.2;">Change Requests: the approval layer AI workflows were missing</h1>
<p style="max-width: 480px; margin: 0 auto 2rem; color: var(--muted-foreground); font-size: 1rem; line-height: 1.65;">Every agent write lands in an inbox as a <strong>Change Request</strong> — a structured diff you can approve, reject, or comment on before anything touches canonical records.</p>
</section>
<section style="padding: 0 1.5rem 2rem; display: grid; gap: 1.5rem;">
<div style="background: var(--muted); border-radius: 0.75rem; padding: 1.5rem; border: 1px solid var(--border);">
<h3 style="margin: 0 0 0.75rem; font-size: 1rem; font-weight: 700; color: var(--foreground);">What a Change Request contains</h3>
<ul style="margin: 0; padding-left: 1.25rem; color: var(--foreground); font-size: 0.9rem; line-height: 1.8;">
<li>The agent or user who proposed the change</li>
<li>Field-by-field before/after diff</li>
<li>Attachments and context added by the agent</li>
<li>Review timeline (approve / request changes / close)</li>
<li>The canonical record it would update</li>
</ul>
</div>
<div style="background: var(--muted); border-radius: 0.75rem; padding: 1.5rem; border: 1px solid var(--border);">
<h3 style="margin: 0 0 0.5rem; font-size: 1rem; font-weight: 700; color: var(--foreground);">The result: trusted AI output</h3>
<p style="margin: 0; color: var(--foreground); font-size: 0.9rem; line-height: 1.6;">Only approved changes reach canonical records. Every rejected proposal stays in the audit trail. Agents can work autonomously — humans stay in control.</p>
</div>
</section>`,
      status: "live",
      page_score: 85,
      notes: "Feature page for Change Requests.",
    },
    message: "Seed SEO landing page: change-requests",
    author: "seed-seo",
    minutesAgo: 101,
    useCases: ["seo-pages"],
  },
  {
    id: "rec_seed_seo_blog_cms",
    baseId: ids.seoBase,
    commitId: "cmt_seed_seo_blog_cms",
    fields: {
      slug: "/use-cases/blog-cms",
      category: "use-case",
      locale: "en",
      title: "Use Busabase as your AI-assisted blog CMS",
      meta_description:
        "Store blog posts as Markdown in Busabase, let agents draft and enrich content, then approve before publishing. A CMS with an AI-safe approval layer.",
      target_keywords: "ai blog cms, markdown database cms, ai content approval",
      html_body: `<section style="padding: 2.5rem 1.5rem; background: var(--muted);">
<h1 style="font-size: 1.9rem; font-weight: 600; margin: 0 0 1rem; color: var(--foreground);">Blog CMS with AI drafts you actually trust</h1>
<p style="max-width: 520px; color: var(--foreground); font-size: 1rem; line-height: 1.65; margin: 0 0 1.5rem;">Store posts as Markdown. Let agents research, outline, and draft. Review changes in an inbox before any edit reaches your canonical post. Publish only what you approved.</p>
<a href="/dashboard?demo=blog" style="background: var(--primary); color: var(--primary-foreground); padding: 0.65rem 1.5rem; border-radius: 0.5rem; font-weight: 700; font-size: 0.9rem; text-decoration: none; display: inline-block;">See blog demo →</a>
</section>
<section style="padding: 2rem 1.5rem;">
<h2 style="font-size: 1.2rem; font-weight: 700; margin: 0 0 1rem; color: var(--foreground);">The CMS field set</h2>
<table style="width: 100%; font-size: 0.875rem; border-collapse: collapse; border: 1px solid var(--border); border-radius: 0.5rem; overflow: hidden;">
<thead><tr style="background:var(--muted);"><th style="text-align:left; padding:0.6rem 1rem; border-bottom:1px solid var(--border); color:var(--muted-foreground);">Field</th><th style="text-align:left; padding:0.6rem 1rem; border-bottom:1px solid var(--border); color:var(--muted-foreground);">Type</th><th style="text-align:left; padding:0.6rem 1rem; border-bottom:1px solid var(--border); color:var(--muted-foreground);">Purpose</th></tr></thead>
<tbody>
<tr><td style="padding:0.5rem 1rem; border-bottom:1px solid var(--border);">Title</td><td style="padding:0.5rem 1rem; border-bottom:1px solid var(--border); color:var(--foreground);">text</td><td style="padding:0.5rem 1rem; border-bottom:1px solid var(--border); color:var(--muted-foreground);">SEO headline</td></tr>
<tr style="background:var(--muted)"><td style="padding:0.5rem 1rem; border-bottom:1px solid var(--border);">Cover Image</td><td style="padding:0.5rem 1rem; border-bottom:1px solid var(--border); color:var(--foreground);">attachment</td><td style="padding:0.5rem 1rem; border-bottom:1px solid var(--border); color:var(--muted-foreground);">Hero image</td></tr>
<tr><td style="padding:0.5rem 1rem; border-bottom:1px solid var(--border);">Body</td><td style="padding:0.5rem 1rem; border-bottom:1px solid var(--border); color:var(--foreground);">markdown</td><td style="padding:0.5rem 1rem; border-bottom:1px solid var(--border); color:var(--muted-foreground);">Full post content</td></tr>
<tr style="background:var(--muted)"><td style="padding:0.5rem 1rem; border-bottom:1px solid var(--border);">AI Summary</td><td style="padding:0.5rem 1rem; border-bottom:1px solid var(--border); color:var(--foreground);">ai_summary</td><td style="padding:0.5rem 1rem; border-bottom:1px solid var(--border); color:var(--muted-foreground);">Agent-generated abstract</td></tr>
<tr><td style="padding:0.5rem 1rem;">Status</td><td style="padding:0.5rem 1rem; color:var(--foreground);">select</td><td style="padding:0.5rem 1rem; color:var(--muted-foreground);">Idea / In review / Published</td></tr>
</tbody></table>
</section>`,
      status: "in-review",
      page_score: 71,
      notes: "Pending final review pass for keyword density.",
    },
    message: "Seed SEO landing page: blog-cms",
    author: "seed-seo",
    minutesAgo: 100,
    useCases: ["seo-pages"],
  },
  {
    id: "rec_seed_seo_config_mgmt",
    baseId: ids.seoBase,
    commitId: "cmt_seed_seo_config_mgmt",
    fields: {
      slug: "/features/config-management",
      category: "feature",
      locale: "en",
      title: "Configuration management with YAML/JSON fields and agent approval",
      meta_description:
        "Store service configs as YAML or JSON in Busabase. AI agents propose changes. Engineers approve before deploy. Full audit trail per config record.",
      target_keywords: "config management database, yaml database, ai devops approval",
      html_body: `<section style="padding: 2.5rem 1.5rem; background: var(--background); color: var(--foreground); border-radius: 0 0 1.25rem 1.25rem;">
<p style="color: var(--muted-foreground); font-size: 0.8rem; font-weight: 700; letter-spacing: 0.08em; margin: 0 0 0.75rem;">DEVOPS USE CASE</p>
<h1 style="font-size: 1.9rem; font-weight: 600; margin: 0 0 1rem; color: var(--foreground); line-height: 1.2;">Config management with an AI approval layer</h1>
<p style="max-width: 500px; color: var(--muted-foreground); font-size: 1rem; line-height: 1.65; margin: 0 0 1.5rem;">Store service configs as YAML or JSON in structured Code fields. Agents propose tuning changes. Engineers review the diff. Only approved configs reach production.</p>
<a href="/dashboard?demo=config-mgmt" style="background: var(--primary); color: var(--primary-foreground); padding: 0.65rem 1.5rem; border-radius: 0.5rem; font-weight: 700; font-size: 0.9rem; text-decoration: none; display: inline-block;">See config demo →</a>
</section>
<section style="padding: 2rem 1.5rem;">
<div style="background: var(--primary); border-radius: 0.5rem; padding: 1.25rem; margin-bottom: 1.25rem;">
<p style="color: var(--primary-foreground); font-size: 0.75rem; margin: 0 0 0.5rem; font-weight: 600;">YAML Config field — before</p>
<pre style="color: var(--primary-foreground); font-size: 0.82rem; margin: 0; line-height: 1.6;"><code>rate_limit:
  requests_per_minute: 1000
  burst: 200</code></pre>
</div>
<div style="background: var(--muted); border-radius: 0.5rem; padding: 1.25rem; border: 1px solid var(--border);">
<p style="color: var(--foreground); font-size: 0.75rem; margin: 0 0 0.5rem; font-weight: 600;">After agent proposal (pending approval)</p>
<pre style="color: var(--foreground); font-size: 0.82rem; margin: 0; line-height: 1.6;"><code>rate_limit:
  requests_per_minute: 5000
  burst: 1000</code></pre>
</div>
</section>`,
      status: "in-review",
      page_score: 68,
      notes: "DevOps use case page. Code block demos pending screenshot.",
    },
    message: "Seed SEO landing page: config-management",
    author: "seed-seo",
    minutesAgo: 99,
    useCases: ["seo-pages"],
  },
  {
    id: "rec_seed_seo_crm_hygiene",
    baseId: ids.seoBase,
    commitId: "cmt_seed_seo_crm_hygiene",
    fields: {
      slug: "/use-cases/crm-hygiene",
      category: "use-case",
      locale: "en",
      title: "AI-powered CRM hygiene — automatic enrichment with human review",
      meta_description:
        "Let AI agents enrich and clean CRM records. Every change is a Change Request a data steward approves. Clean data, no rogue overwrites.",
      target_keywords: "ai crm hygiene, crm data enrichment, crm approval workflow",
      html_body: `<section style="padding: 2.5rem 1.5rem; background: var(--background);">
<p style="color: var(--foreground); font-size: 0.8rem; font-weight: 700; letter-spacing: 0.08em; margin: 0 0 0.75rem;">CRM USE CASE</p>
<h1 style="font-size: 1.9rem; font-weight: 600; margin: 0 0 1rem; color: var(--foreground); line-height: 1.2;">CRM data that agents clean but humans trust</h1>
<p style="max-width: 500px; color: var(--foreground); font-size: 1rem; line-height: 1.65; margin: 0 0 1.5rem;">Agents enrich company records with funding rounds, headcount, and domain data. Each enrichment is a Change Request a data steward reviews before it touches your CRM.</p>
<a href="/dashboard?demo=crm" style="background: var(--primary); color: var(--primary-foreground); padding: 0.65rem 1.5rem; border-radius: 0.5rem; font-weight: 700; font-size: 0.9rem; text-decoration: none; display: inline-block;">See CRM demo →</a>
</section>`,
      status: "in-review",
      page_score: 64,
      notes: "CRM use case. Needs social proof section.",
    },
    message: "Seed SEO landing page: crm-hygiene",
    author: "seed-seo",
    minutesAgo: 98,
    useCases: ["seo-pages"],
  },
  {
    id: "rec_seed_seo_knowledge_base",
    baseId: ids.seoBase,
    commitId: "cmt_seed_seo_knowledge_base",
    fields: {
      slug: "/use-cases/knowledge-base",
      category: "use-case",
      locale: "en",
      title: "Local AI knowledge base with agent enrichment and human review",
      meta_description:
        "Build a private knowledge base that local AI agents can read and enrich. Every agent write goes through approval so your knowledge stays trustworthy.",
      target_keywords: "local ai knowledge base, private knowledge base, agent readable database",
      html_body: `<section style="padding: 2.5rem 1.5rem; background: var(--muted);">
<h1 style="font-size: 1.9rem; font-weight: 600; margin: 0 0 1rem; color: var(--foreground);">Private knowledge base your AI agents can actually trust</h1>
<p style="max-width: 500px; color: var(--foreground); font-size: 1rem; line-height: 1.65; margin: 0 0 1.5rem;">Notes, sources, receipts, and research — stored locally, enriched by agents, reviewed before they become canonical. The private memory layer for knowledge workers using AI.</p>
<a href="/dashboard?demo=knowledge" style="background: var(--primary); color: var(--primary-foreground); padding: 0.65rem 1.5rem; border-radius: 0.5rem; font-weight: 700; font-size: 0.9rem; text-decoration: none; display: inline-block;">See knowledge demo →</a>
</section>`,
      status: "in-review",
      page_score: 62,
      notes: "Knowledge base use case page.",
    },
    message: "Seed SEO landing page: knowledge-base",
    author: "seed-seo",
    minutesAgo: 97,
    useCases: ["seo-pages"],
  },
  {
    id: "rec_seed_seo_vs_google_sheets",
    baseId: ids.seoBase,
    commitId: "cmt_seed_seo_vs_google_sheets",
    fields: {
      slug: "/busabase-vs-google-sheets",
      category: "comparison",
      locale: "en",
      title: "Busabase vs Google Sheets — structured database vs spreadsheet",
      meta_description:
        "Google Sheets is a spreadsheet. Busabase is a structured, typed database with AI agent support and approval workflows. Choose the right tool for structured data.",
      target_keywords: "busabase vs google sheets, database vs spreadsheet, structured data ai",
      html_body: `<section style="padding: 2.5rem 1.5rem; text-align: center; background: var(--muted);">
<h1 style="font-size: 2rem; font-weight: 600; margin: 0 auto 1rem; max-width: 560px; color: var(--foreground);">Busabase vs Google Sheets<br><span style="color: var(--foreground);">When you need a database, not a spreadsheet</span></h1>
<p style="max-width: 480px; margin: 0 auto 2rem; color: var(--foreground); font-size: 1rem; line-height: 1.65;">Google Sheets is great for ad-hoc analysis. Busabase is for structured records that agents read and write — with typed fields, relations, and approval gates.</p>
</section>`,
      status: "in-review",
      page_score: 60,
      notes: "vs Sheets. Draft comparison table pending.",
    },
    message: "Seed SEO landing page: vs-google-sheets",
    author: "seed-seo",
    minutesAgo: 96,
    useCases: ["seo-pages"],
  },
  {
    id: "rec_seed_seo_seo_pages_uc",
    baseId: ids.seoBase,
    commitId: "cmt_seed_seo_seo_pages_uc",
    fields: {
      slug: "/use-cases/seo-landing-pages",
      category: "use-case",
      locale: "en",
      title: "Generate and approve SEO landing pages with AI — Busabase",
      meta_description:
        "Store landing page HTML in Busabase. AI agents draft pages, humans review and approve. Next.js renders only approved pages live.",
      target_keywords: "ai seo landing pages, html cms database, next.js seo pages",
      html_body: `<section style="padding: 2.5rem 1.5rem; background: var(--background);">
<p style="color: var(--primary-foreground); font-size: 0.8rem; font-weight: 700; letter-spacing: 0.08em; margin: 0 0 0.75rem;">SEO USE CASE</p>
<h1 style="font-size: 1.9rem; font-weight: 600; margin: 0 0 1rem; color: var(--foreground); line-height: 1.2;">AI-drafted landing pages, human-approved before going live</h1>
<p style="max-width: 500px; color: var(--foreground); font-size: 1rem; line-height: 1.65; margin: 0 0 1.5rem;">Store page HTML in a Busabase <strong>HTML field</strong>. Agents draft new pages or update existing ones via Change Requests. Editors approve. Next.js renders live pages from approved records only.</p>
<a href="/dashboard?demo=seo-pages" style="background: var(--primary); color: var(--primary-foreground); padding: 0.65rem 1.5rem; border-radius: 0.5rem; font-weight: 700; font-size: 0.9rem; text-decoration: none; display: inline-block;">See SEO pages demo →</a>
</section>`,
      status: "in-review",
      page_score: 58,
      notes: "Meta page about the SEO use case itself.",
    },
    message: "Seed SEO landing page: seo-landing-pages use case",
    author: "seed-seo",
    minutesAgo: 95,
    useCases: ["seo-pages"],
  },
  {
    id: "rec_seed_seo_open_source",
    baseId: ids.seoBase,
    commitId: "cmt_seed_seo_open_source",
    fields: {
      slug: "/open-source",
      category: "core",
      locale: "en",
      title: "Busabase is open source — MIT licensed database for AI workflows",
      meta_description:
        "Busabase is MIT licensed. Self-host it, fork it, audit it. No vendor lock-in, no usage-based pricing, no black-box AI. Full source on GitHub.",
      target_keywords:
        "open source database ai agents, mit license database, self-hosted ai database",
      html_body: `<section style="padding: 2.5rem 1.5rem;">
<h1 style="font-size: 1.9rem; font-weight: 600; margin: 0 0 1rem; color: var(--foreground);">Open source. No lock-in. No surprises.</h1>
<p style="max-width: 500px; color: var(--foreground); font-size: 1rem; line-height: 1.65; margin: 0 0 1.5rem;">Busabase is MIT licensed. Read the code, audit the logic, self-host anywhere. No feature gates behind a paid plan. Everything ships in the open repo.</p>
<div style="display: grid; gap: 0.75rem; max-width: 500px;">
<div style="display:flex; gap:0.75rem; align-items:center; padding:0.875rem 1rem; border:1px solid var(--border); border-radius:0.5rem;"><span style="color:var(--foreground); font-size:1.25rem;">✓</span><span style="color:var(--foreground); font-size:0.9rem;">MIT license — fork, modify, redistribute freely</span></div>
<div style="display:flex; gap:0.75rem; align-items:center; padding:0.875rem 1rem; border:1px solid var(--border); border-radius:0.5rem;"><span style="color:var(--foreground); font-size:1.25rem;">✓</span><span style="color:var(--foreground); font-size:0.9rem;">Self-host on your own infrastructure</span></div>
<div style="display:flex; gap:0.75rem; align-items:center; padding:0.875rem 1rem; border:1px solid var(--border); border-radius:0.5rem;"><span style="color:var(--foreground); font-size:1.25rem;">✓</span><span style="color:var(--foreground); font-size:0.9rem;">No per-seat pricing or usage caps</span></div>
<div style="display:flex; gap:0.75rem; align-items:center; padding:0.875rem 1rem; border:1px solid var(--border); border-radius:0.5rem;"><span style="color:var(--foreground); font-size:1.25rem;">✓</span><span style="color:var(--foreground); font-size:0.9rem;">Audit every line of AI logic yourself</span></div>
</div>
</section>`,
      status: "draft",
      page_score: 45,
      notes: "Needs GitHub star count integration and contributor section.",
    },
    message: "Seed SEO landing page: open-source",
    author: "seed-seo",
    minutesAgo: 94,
    useCases: ["seo-pages"],
  },
  {
    id: "rec_seed_seo_training_data",
    baseId: ids.seoBase,
    commitId: "cmt_seed_seo_training_data",
    fields: {
      slug: "/use-cases/training-datasets",
      category: "use-case",
      locale: "en",
      title: "Manage AI training datasets with human approval — Busabase",
      meta_description:
        "Curate Q&A pairs, preference data, and evals in Busabase. Quality scoring agents propose labels, humans approve before data reaches training pipelines.",
      target_keywords:
        "ai training dataset management, dataset curation database, rlhf data approval",
      html_body: `<section style="padding: 2.5rem 1.5rem; background: var(--background);">
<p style="color: var(--foreground); font-size: 0.8rem; font-weight: 700; letter-spacing: 0.08em; margin: 0 0 0.75rem;">AI / ML USE CASE</p>
<h1 style="font-size: 1.9rem; font-weight: 600; margin: 0 0 1rem; color: var(--foreground); line-height: 1.2;">Training data curation with agent scoring and human sign-off</h1>
<p style="max-width: 500px; color: var(--foreground); font-size: 1rem; line-height: 1.65; margin: 0 0 1.5rem;">Store Q&amp;A pairs, preference labels, and refusal evals in Busabase. Scoring agents propose quality scores. ML engineers approve before data enters the training pipeline.</p>
<a href="/dashboard?demo=dataset" style="background: var(--primary); color: var(--primary-foreground); padding: 0.65rem 1.5rem; border-radius: 0.5rem; font-weight: 700; font-size: 0.9rem; text-decoration: none; display: inline-block;">See dataset demo →</a>
</section>`,
      status: "draft",
      page_score: 42,
      notes: "ML use case page. Needs RLHF terminology review.",
    },
    message: "Seed SEO landing page: training-datasets",
    author: "seed-seo",
    minutesAgo: 93,
    useCases: ["seo-pages"],
  },
  {
    id: "rec_seed_seo_compliance",
    baseId: ids.seoBase,
    commitId: "cmt_seed_seo_compliance",
    fields: {
      slug: "/use-cases/compliance-workflows",
      category: "use-case",
      locale: "en",
      title: "AI-assisted compliance checklists with audit trails — Busabase",
      meta_description:
        "Run SOC 2, ISO 27001, and HIPAA compliance checklists in Busabase. Agents gather evidence, humans review, every action is logged for auditors.",
      target_keywords: "compliance database ai, audit trail database, soc2 evidence management",
      html_body: `<section style="padding: 2.5rem 1.5rem; background: var(--muted);">
<p style="color: var(--foreground); font-size: 0.8rem; font-weight: 700; letter-spacing: 0.08em; margin: 0 0 0.75rem;">COMPLIANCE USE CASE</p>
<h1 style="font-size: 1.9rem; font-weight: 600; margin: 0 0 1rem; color: var(--foreground); line-height: 1.2;">Compliance evidence with an audit trail auditors actually trust</h1>
<p style="max-width: 500px; color: var(--foreground); font-size: 1rem; line-height: 1.65; margin: 0 0 1.5rem;">Agents gather evidence, attach files, and propose status updates for each checklist item. Compliance owners approve. Every action is timestamped and logged — ready for your next audit.</p>
<a href="/dashboard?demo=compliance" style="background: var(--primary); color: var(--primary-foreground); padding: 0.65rem 1.5rem; border-radius: 0.5rem; font-weight: 700; font-size: 0.9rem; text-decoration: none; display: inline-block;">See compliance demo →</a>
</section>`,
      status: "draft",
      page_score: 39,
      notes: "SOC 2 keywords. Needs legal review of claims.",
    },
    message: "Seed SEO landing page: compliance-workflows",
    author: "seed-seo",
    minutesAgo: 92,
    useCases: ["seo-pages"],
  },
  {
    id: "rec_seed_seo_finance_review",
    baseId: ids.seoBase,
    commitId: "cmt_seed_seo_finance_review",
    fields: {
      slug: "/use-cases/finance-automation",
      category: "use-case",
      locale: "en",
      title: "AI invoice matching and finance approval workflows — Busabase",
      meta_description:
        "Automate AP three-way matching with AI agents. Every match is a Change Request your finance team approves before it updates the canonical invoice record.",
      target_keywords: "ai invoice matching, finance automation database, ap approval workflow",
      html_body: `<section style="padding: 2.5rem 1.5rem; background: var(--muted);">
<p style="color: var(--primary-foreground); font-size: 0.8rem; font-weight: 700; letter-spacing: 0.08em; margin: 0 0 0.75rem;">FINANCE USE CASE</p>
<h1 style="font-size: 1.9rem; font-weight: 600; margin: 0 0 1rem; color: var(--foreground); line-height: 1.2;">Three-way matching and invoice approval — without the spreadsheet hell</h1>
<p style="max-width: 500px; color: var(--foreground); font-size: 1rem; line-height: 1.65; margin: 0 0 1.5rem;">AI agents match POs, invoices, and receipts. Every match lands in the finance team's inbox as a Change Request. One click to approve. Full audit trail for auditors.</p>
<a href="/dashboard?demo=finance" style="background: var(--primary); color: var(--primary-foreground); padding: 0.65rem 1.5rem; border-radius: 0.5rem; font-weight: 700; font-size: 0.9rem; text-decoration: none; display: inline-block;">See finance demo →</a>
</section>`,
      status: "draft",
      page_score: 36,
      notes: "Finance AP use case. Needs CFO social proof.",
    },
    message: "Seed SEO landing page: finance-automation",
    author: "seed-seo",
    minutesAgo: 91,
    useCases: ["seo-pages"],
  },
  {
    id: "rec_seed_seo_operations",
    baseId: ids.seoBase,
    commitId: "cmt_seed_seo_operations",
    fields: {
      slug: "/use-cases/operations-erp",
      category: "use-case",
      locale: "en",
      title: "Operations database with AI status tracking and approvals — Busabase",
      meta_description:
        "Track tasks, vendors, and operational status in Busabase. Agents reconcile status, humans approve before canonical records update. Lightweight ERP for small ops teams.",
      target_keywords: "operations database ai, lightweight erp, ops task approval workflow",
      html_body: `<section style="padding: 2.5rem 1.5rem; background: var(--muted);">
<p style="color: var(--foreground); font-size: 0.8rem; font-weight: 700; letter-spacing: 0.08em; margin: 0 0 0.75rem;">OPERATIONS USE CASE</p>
<h1 style="font-size: 1.9rem; font-weight: 600; margin: 0 0 1rem; color: var(--foreground); line-height: 1.2;">Operations tracking with AI reconciliation and manager review</h1>
<p style="max-width: 500px; color: var(--foreground); font-size: 1rem; line-height: 1.65; margin: 0 0 1.5rem;">Vendors, tasks, and timelines in one structured base. AI agents monitor status and propose updates. Managers approve. Nothing slips through without a reviewer.</p>
<a href="/dashboard?demo=operations" style="background: var(--primary); color: var(--primary-foreground); padding: 0.65rem 1.5rem; border-radius: 0.5rem; font-weight: 700; font-size: 0.9rem; text-decoration: none; display: inline-block;">See operations demo →</a>
</section>`,
      status: "draft",
      page_score: 33,
      notes: "Operations ERP use case.",
    },
    message: "Seed SEO landing page: operations-erp",
    author: "seed-seo",
    minutesAgo: 90,
    useCases: ["seo-pages"],
  },
  {
    id: "rec_seed_seo_vs_nocodb",
    baseId: ids.seoBase,
    commitId: "cmt_seed_seo_vs_nocodb",
    fields: {
      slug: "/busabase-vs-nocodb",
      category: "comparison",
      locale: "en",
      title: "Busabase vs NocoDB — AI agent write safety comparison",
      meta_description:
        "NocoDB is a spreadsheet-database hybrid. Busabase adds Change Requests and an approval inbox for AI agent writes. Compare features and pricing.",
      target_keywords: "busabase vs nocodb, nocodb alternative, open source database comparison",
      html_body: `<section style="padding: 2.5rem 1.5rem; text-align: center;">
<h1 style="font-size: 1.9rem; font-weight: 600; margin: 0 auto 1rem; max-width: 560px; color: var(--foreground);">Busabase vs NocoDB</h1>
<p style="max-width: 480px; margin: 0 auto 2rem; color: var(--muted-foreground); font-size: 1rem; line-height: 1.65;">Both are open-source, self-hosted databases. The difference: Busabase was designed from day one for AI agent write safety. NocoDB was designed for spreadsheet-style data entry.</p>
</section>`,
      status: "draft",
      page_score: 28,
      notes: "vs NocoDB draft. Comparison table needed.",
    },
    message: "Seed SEO landing page: vs-nocodb",
    author: "seed-seo",
    minutesAgo: 89,
    useCases: ["seo-pages"],
  },
  {
    id: "rec_seed_seo_vs_baserow",
    baseId: ids.seoBase,
    commitId: "cmt_seed_seo_vs_baserow",
    fields: {
      slug: "/busabase-vs-baserow",
      category: "comparison",
      locale: "en",
      title: "Busabase vs Baserow — approval workflows for AI agent writes",
      meta_description:
        "Baserow is a self-hosted Airtable alternative. Busabase adds AI agent safety with Change Requests. Compare the two open-source options.",
      target_keywords: "busabase vs baserow, baserow alternative, self-hosted airtable comparison",
      html_body: `<section style="padding: 2.5rem 1.5rem; text-align: center;">
<h1 style="font-size: 1.9rem; font-weight: 600; margin: 0 auto 1rem; max-width: 560px; color: var(--foreground);">Busabase vs Baserow</h1>
<p style="max-width: 480px; margin: 0 auto 2rem; color: var(--muted-foreground); font-size: 1rem; line-height: 1.65;">Baserow is a strong open-source no-code database. Busabase adds the AI safety layer: Change Requests, approval inbox, per-record commit history, and Code/Markdown/HTML typed fields.</p>
</section>`,
      status: "draft",
      page_score: 25,
      notes: "vs Baserow draft. Hero copy only.",
    },
    message: "Seed SEO landing page: vs-baserow",
    author: "seed-seo",
    minutesAgo: 88,
    useCases: ["seo-pages"],
  },
  {
    id: "rec_seed_seo_pricing",
    baseId: ids.seoBase,
    commitId: "cmt_seed_seo_pricing",
    fields: {
      slug: "/pricing",
      category: "core",
      locale: "en",
      title: "Busabase pricing — free, open source, self-hosted",
      meta_description:
        "Busabase is free and open source. Self-host on your own infrastructure at no cost. Enterprise support plans available.",
      target_keywords: "busabase pricing, free open source database, self-hosted ai database free",
      html_body: `<section style="padding: 3rem 1.5rem; text-align: center;">
<h1 style="font-size: 2rem; font-weight: 600; margin: 0 auto 1rem; color: var(--foreground);">Pricing</h1>
<p style="color: var(--foreground); font-size: 1.4rem; font-weight: 700; margin: 0 0 0.5rem;">$0 / forever</p>
<p style="max-width: 400px; margin: 0 auto 2rem; color: var(--primary-foreground); font-size: 1rem; line-height: 1.65;">Busabase is MIT licensed and free to self-host. No seat limits, no usage caps, no feature tiers. Enterprise support available on request.</p>
<a href="/dashboard" style="background: var(--primary); color: var(--primary-foreground); padding: 0.65rem 1.75rem; border-radius: 0.5rem; font-weight: 700; font-size: 0.9rem; text-decoration: none; display: inline-block;">Get started →</a>
</section>`,
      status: "draft",
      page_score: 22,
      notes: "Simple pricing page. Needs enterprise tier details.",
    },
    message: "Seed SEO landing page: pricing",
    author: "seed-seo",
    minutesAgo: 87,
    useCases: ["seo-pages"],
  },
  {
    id: "rec_seed_seo_developers",
    baseId: ids.seoBase,
    commitId: "cmt_seed_seo_developers",
    fields: {
      slug: "/developers",
      category: "core",
      locale: "en",
      title: "Busabase for developers — REST API, oRPC, Drizzle, TypeScript",
      meta_description:
        "Busabase exposes a typed oRPC API, REST endpoints, and a Drizzle ORM schema. Integrate it into your Next.js or Node.js app in minutes.",
      target_keywords: "busabase api, orpc database api, drizzle orm typescript database",
      html_body: `<section style="padding: 2.5rem 1.5rem; background: var(--background); color: var(--foreground); border-radius: 0 0 1.25rem 1.25rem;">
<p style="color: var(--muted-foreground); font-size: 0.8rem; font-weight: 700; letter-spacing: 0.08em; margin: 0 0 0.75rem;">FOR DEVELOPERS</p>
<h1 style="font-size: 1.9rem; font-weight: 600; margin: 0 0 1rem; color: var(--foreground); line-height: 1.2;">Typed API. SQLite. TypeScript. Zero magic.</h1>
<p style="max-width: 500px; color: var(--muted-foreground); font-size: 1rem; line-height: 1.65; margin: 0 0 1.5rem;">Busabase is Next.js 15 + Drizzle ORM + oRPC. Add it to your stack, fork it, extend it. The schema is yours.</p>
</section>
<section style="padding: 2rem 1.5rem;">
<div style="background: var(--primary); border-radius: 0.5rem; padding: 1.25rem;">
<p style="color: var(--primary-foreground); font-size: 0.75rem; margin: 0 0 0.75rem; font-weight: 600;">Fetch approved records via REST</p>
<pre style="color: var(--primary-foreground); font-size: 0.82rem; margin: 0; line-height: 1.6; overflow-x: auto;"><code>const res = await fetch("/api/v1/bases/blog/records?status=live");
const { records } = await res.json();
// records[0].fields.html_body → render as landing page</code></pre>
</div>
</section>`,
      status: "draft",
      page_score: 18,
      notes: "Developer docs landing. API examples need endpoint confirmation.",
    },
    message: "Seed SEO landing page: developers",
    author: "seed-seo",
    minutesAgo: 86,
    useCases: ["seo-pages"],
  },
  {
    id: "rec_seed_seo_enterprise",
    baseId: ids.seoBase,
    commitId: "cmt_seed_seo_enterprise",
    fields: {
      slug: "/enterprise",
      category: "core",
      locale: "en",
      title: "Busabase for enterprise — private cloud, SSO, audit compliance",
      meta_description:
        "Enterprise Busabase deployments with private cloud hosting, SSO, SLA support, and compliance audit exports. Contact us for pricing.",
      target_keywords:
        "busabase enterprise, self-hosted enterprise database, ai database enterprise",
      html_body: `<section style="padding: 2.5rem 1.5rem; text-align: center;">
<h1 style="font-size: 1.9rem; font-weight: 600; margin: 0 auto 1rem; max-width: 560px; color: var(--foreground);">Enterprise deployments</h1>
<p style="max-width: 480px; margin: 0 auto 2rem; color: var(--primary-foreground); font-size: 1rem; line-height: 1.65;">Private cloud, SSO integration, SLA-backed support, and compliance audit exports. Contact us to discuss your enterprise requirements.</p>
<a href="mailto:enterprise@busabase.local" style="background: var(--primary); color: var(--primary-foreground); padding: 0.65rem 1.75rem; border-radius: 0.5rem; font-weight: 700; font-size: 0.9rem; text-decoration: none; display: inline-block;">Contact sales →</a>
</section>`,
      status: "draft",
      page_score: 15,
      notes: "Enterprise page stub. Needs case studies.",
    },
    message: "Seed SEO landing page: enterprise",
    author: "seed-seo",
    minutesAgo: 85,
    useCases: ["seo-pages"],
  },
  {
    id: ids.configRecord,
    baseId: ids.configBase,
    commitId: ids.configCommit,
    fields: {
      name: "api-gateway",
      environment: "production",
      config:
        "server:\n  listen: 443\n  ssl: true\n  worker_processes: auto\n\nroutes:\n  - path: /api/v1\n    upstream: backend:8080\n    timeout: 30s\n\nrate_limit:\n  requests_per_minute: 1000\n  burst: 200\n\nlogging:\n  level: info\n  format: json",
      overrides: '{\n  "RATE_LIMIT_RPM": "1000",\n  "BURST_SIZE": "200",\n  "LOG_LEVEL": "info"\n}',
      status: "active",
      deployed_at: "2026-06-20",
      notes: "Production API gateway. Rate limits set by capacity planning.",
    },
    message: "Seed api-gateway production config",
    author: "seed-devops",
    minutesAgo: 110,
    useCases: ["config-mgmt"],
  },
];

const views: SeedViewDef[] = [
  {
    id: "viw_seed_private_knowledge_review",
    baseId: ids.knowledgeBase,
    slug: "private-agent-memory",
    name: "Private agent memory",
    description: "Approved private notes available to local agents.",
    config: {
      filters: [{ fieldSlug: "sensitivity", operator: "equals", value: "private" }],
      sorts: [{ direction: "desc", fieldSlug: "title" }],
      visibleFieldSlugs: ["title", "sensitivity", "tags", "source_url"],
    },
    minutesAgo: 90,
    useCases: ["knowledge"],
  },
  {
    id: "viw_seed_ops_blocked",
    baseId: ids.operationsBase,
    slug: "blocked",
    name: "Blocked",
    description: "Operational tasks that need manager review.",
    config: {
      filters: [{ fieldSlug: "status", operator: "equals", value: "blocked" }],
      sorts: [{ direction: "asc", fieldSlug: "due_date" }],
      visibleFieldSlugs: ["task", "vendor", "owner", "due_date", "status", "risk_flags"],
    },
    minutesAgo: 90,
    useCases: ["operations"],
  },
  {
    id: "viw_seed_routine_review",
    baseId: ids.routineBase,
    slug: "needs-review",
    name: "Needs review",
    description: "Routine runs waiting for a reviewer decision.",
    config: {
      filters: [{ fieldSlug: "status", operator: "equals", value: "needs-review" }],
      sorts: [{ direction: "desc", fieldSlug: "run_date" }],
      visibleFieldSlugs: ["run", "team", "run_date", "status", "ready_to_notify"],
    },
    minutesAgo: 90,
    useCases: ["routine"],
  },
  {
    id: "viw_seed_compliance_review",
    baseId: ids.complianceBase,
    slug: "in-review",
    name: "In review",
    description: "Compliance items with submitted or pending evidence.",
    config: {
      filters: [{ fieldSlug: "status", operator: "equals", value: "review" }],
      sorts: [{ direction: "asc", fieldSlug: "due_date" }],
      visibleFieldSlugs: ["item", "owner", "due_date", "status", "evidence"],
    },
    minutesAgo: 90,
    useCases: ["compliance"],
  },
  {
    id: "viw_seed_research_high",
    baseId: ids.researchBase,
    slug: "important-signals",
    name: "Important signals",
    description: "Market research rows above the analyst review threshold.",
    config: {
      filters: [{ fieldSlug: "importance", operator: "equals", value: "high" }],
      sorts: [{ direction: "desc", fieldSlug: "confidence" }],
      visibleFieldSlugs: ["signal", "competitor", "importance", "confidence", "source_url"],
    },
    minutesAgo: 90,
    useCases: ["research"],
  },
  {
    id: "viw_seed_content_ready",
    baseId: ids.contentBase,
    slug: "publish-ready",
    name: "Publish ready",
    description: "Content records close to publishing.",
    config: {
      filters: [{ fieldSlug: "status", operator: "equals", value: "ready" }],
      sorts: [{ direction: "asc", fieldSlug: "channel" }],
      visibleFieldSlugs: ["title", "channel", "status", "seo_title"],
    },
    minutesAgo: 90,
    useCases: ["content"],
  },
  {
    id: "viw_seed_training_high_quality",
    baseId: ids.trainingBase,
    slug: "high-quality",
    name: "High quality",
    description: "Training examples with reviewer scores above the bar.",
    config: {
      filters: [{ fieldSlug: "quality_score", operator: "not_empty" }],
      sorts: [{ direction: "desc", fieldSlug: "quality_score" }],
      visibleFieldSlugs: ["question", "domain", "difficulty", "quality_score"],
    },
    minutesAgo: 90,
    useCases: ["dataset"],
  },
  {
    id: "viw_seed_labeling_corrections",
    baseId: ids.labelingBase,
    slug: "needs-correction",
    name: "Needs correction",
    description: "Labels that need a human correction before export.",
    config: {
      filters: [{ fieldSlug: "status", operator: "equals", value: "needs-correction" }],
      sorts: [{ direction: "asc", fieldSlug: "confidence" }],
      visibleFieldSlugs: ["item", "labels", "confidence", "status"],
    },
    minutesAgo: 90,
    useCases: ["labeling"],
  },
  {
    id: "viw_seed_seo_live",
    baseId: ids.seoBase,
    slug: "live-pages",
    name: "Live pages",
    description: "Approved landing pages currently rendered by Next.js.",
    config: {
      filters: [{ fieldSlug: "status", operator: "equals", value: "live" }],
      sorts: [{ direction: "desc", fieldSlug: "page_score" }],
      visibleFieldSlugs: ["slug", "title", "category", "locale", "page_score", "status"],
    },
    minutesAgo: 90,
    useCases: ["seo-pages"],
  },
  // One tab per page category so the demo can filter Pages by type.
  ...(
    [
      ["comparison", "Comparison", "Competitor and alternative comparison pages."],
      ["use-case", "Use Cases", "Pages targeting a scenario, industry, or persona."],
      ["feature", "Features", "Pages built around a single product capability."],
      ["core", "Core", "Conversion and company pages (pricing, developers, enterprise)."],
    ] as const
  ).map(([value, name, description], i) => ({
    id: `viw_seed_seo_${value}`,
    baseId: ids.seoBase,
    slug: `category-${value}`,
    name,
    description,
    config: {
      filters: [{ fieldSlug: "category", operator: "equals" as const, value }],
      sorts: [{ direction: "desc" as const, fieldSlug: "page_score" }],
      visibleFieldSlugs: ["slug", "title", "locale", "target_keywords", "page_score", "status"],
    },
    minutesAgo: 89 - i,
    useCases: ["seo-pages" as const],
  })),
  {
    id: "viw_seed_config_production",
    baseId: ids.configBase,
    slug: "production",
    name: "Production",
    description: "Active production service configs.",
    config: {
      filters: [{ fieldSlug: "environment", operator: "equals", value: "production" }],
      sorts: [{ direction: "asc", fieldSlug: "name" }],
      visibleFieldSlugs: ["name", "status", "environment", "deployed_at"],
    },
    minutesAgo: 90,
    useCases: ["config-mgmt"],
  },
];

const changeRequests: SeedChangeRequestDef[] = [
  {
    id: ids.knowledgeCr,
    baseId: ids.knowledgeBase,
    status: "in_review",
    submittedBy: "local-research-agent",
    sourceMeta: {
      seed: true,
      scenario: "private-knowledge-enrichment",
      workflow: "local-agent-memory",
    },
    minutesAgo: 18,
    useCases: ["knowledge"],
    operations: [
      {
        id: "opr_seed_private_knowledge_enrich",
        commitId: "cmt_seed_private_knowledge_enrich",
        operation: "record_update",
        targetRecordId: ids.knowledgeRecord,
        baseCommitId: ids.knowledgeCommit,
        baseFields: records[0].fields,
        fields: {
          ...records[0].fields,
          body: "## Local agent memory\n\nStore only approved notes, source receipts, and redaction rules before exposing them to local agents.",
          tags: ["agent-memory", "source", "decision"],
        },
        message: "Add redaction rule to private agent memory",
        author: "local-research-agent",
      },
    ],
  },
  {
    id: ids.operationsCr,
    baseId: ids.operationsBase,
    status: "in_review",
    submittedBy: "ops-reconcile-agent",
    sourceMeta: { seed: true, scenario: "operations-status", workflow: "ops-review" },
    minutesAgo: 16,
    useCases: ["operations"],
    operations: [
      {
        id: "opr_seed_ops_status_reconcile",
        commitId: "cmt_seed_ops_status_reconcile",
        operation: "record_update",
        targetRecordId: ids.operationsRecord,
        baseCommitId: ids.operationsCommit,
        baseFields: records[1].fields,
        fields: {
          ...records[1].fields,
          due_date: "2026-06-25",
          risk_flags: ["security", "data"],
          status: "in-progress",
        },
        message: "Reconcile vendor onboarding status and risks",
        author: "ops-reconcile-agent",
      },
    ],
  },
  {
    id: ids.routineCr,
    baseId: ids.routineBase,
    status: "in_review",
    submittedBy: "support-qa-agent",
    sourceMeta: { seed: true, scenario: "routine-support-qa", workflow: "daily-quality-review" },
    minutesAgo: 14,
    useCases: ["routine"],
    operations: [
      {
        id: "opr_seed_routine_support_qa",
        commitId: "cmt_seed_routine_support_qa_notify",
        operation: "record_update",
        targetRecordId: ids.routineRecord,
        baseCommitId: ids.routineCommit,
        baseFields: records[2].fields,
        fields: {
          ...records[2].fields,
          findings:
            "Agent sampled 120 support conversations, found 7 tone risks, and attached reviewer-ready examples.",
          ready_to_notify: true,
          status: "approved",
        },
        message: "Submit support QA run for notification",
        author: "support-qa-agent",
      },
    ],
  },
  {
    id: ids.complianceCr,
    baseId: ids.complianceBase,
    status: "in_review",
    submittedBy: "compliance-evidence-agent",
    sourceMeta: { seed: true, scenario: "compliance-evidence", workflow: "access-review" },
    minutesAgo: 12,
    useCases: ["compliance"],
    operations: [
      {
        id: "opr_seed_compliance_evidence",
        commitId: "cmt_seed_compliance_evidence",
        operation: "record_update",
        targetRecordId: ids.complianceRecord,
        baseCommitId: ids.complianceCommit,
        baseFields: records[3].fields,
        fields: {
          ...records[3].fields,
          evidence: [
            {
              id: "att_access_review_export",
              attachmentId: "att_access_review_export",
              fileName: "admin-access-export.pdf",
              mimeType: "application/pdf",
              size: 512000,
              url: "/assets/readme/scenarios/compliance-checklists-base.png",
            },
          ],
          notes:
            "Admin export attached. Reviewer should confirm two stale admin users were removed.",
          status: "complete",
        },
        message: "Attach access review evidence",
        author: "compliance-evidence-agent",
      },
    ],
  },
  {
    id: ids.researchCr,
    baseId: ids.researchBase,
    status: "in_review",
    submittedBy: "market-intel-agent",
    sourceMeta: { seed: true, scenario: "market-signal", workflow: "research-monitoring" },
    minutesAgo: 10,
    useCases: ["research"],
    operations: [
      {
        id: "opr_seed_research_signal",
        commitId: "cmt_seed_research_signal",
        operation: "record_update",
        targetRecordId: ids.researchRecord,
        baseCommitId: ids.researchCommit,
        baseFields: records[4].fields,
        fields: {
          ...records[4].fields,
          confidence: 0.86,
          importance: "high",
          summary:
            "Two monitored sources now indicate review queues are becoming a standard feature for AI-written database rows.",
        },
        message: "Upgrade signal after second source confirms trend",
        author: "market-intel-agent",
      },
    ],
  },
  {
    id: ids.contentCr,
    baseId: ids.contentBase,
    status: "in_review",
    submittedBy: "content-ops-agent",
    sourceMeta: { seed: true, scenario: "content-brief-update", workflow: "content-factory" },
    minutesAgo: 8,
    useCases: ["content"],
    operations: [
      {
        id: "opr_seed_content_brief_update",
        commitId: "cmt_seed_content_brief_update",
        operation: "record_update",
        targetRecordId: ids.contentRecord,
        baseCommitId: ids.contentCommit,
        baseFields: records[5].fields,
        fields: {
          ...records[5].fields,
          brief:
            "Launch article, comparison section, screenshot plan, and SEO metadata for local-first approval databases.",
          seo_title: "Busabase: approval-first database for AI agents",
          status: "ready",
        },
        message: "Move launch brief to publish-ready",
        author: "content-ops-agent",
      },
    ],
  },
  {
    id: ids.trainingCr,
    baseId: ids.trainingBase,
    status: "in_review",
    submittedBy: "eval-curation-agent",
    sourceMeta: { seed: true, scenario: "training-quality-score", workflow: "dataset-curation" },
    minutesAgo: 6,
    useCases: ["dataset"],
    operations: [
      {
        id: "opr_seed_training_quality_score",
        commitId: "cmt_seed_training_quality_score",
        operation: "record_update",
        targetRecordId: ids.trainingRecord,
        baseCommitId: ids.trainingCommit,
        baseFields: records[6].fields,
        fields: { ...records[6].fields, difficulty: "medium", quality_score: 4.8 },
        message: "Raise dataset quality score after reviewer edits",
        author: "eval-curation-agent",
      },
    ],
  },
  {
    id: ids.labelingCr,
    baseId: ids.labelingBase,
    status: "in_review",
    submittedBy: "labeling-agent",
    sourceMeta: { seed: true, scenario: "label-correction", workflow: "dataset-labeling" },
    minutesAgo: 4,
    useCases: ["labeling"],
    operations: [
      {
        id: "opr_seed_labeling_correction",
        commitId: "cmt_seed_labeling_correction",
        operation: "record_update",
        targetRecordId: ids.labelingRecord,
        baseCommitId: ids.labelingCommit,
        baseFields: records[7].fields,
        fields: {
          ...records[7].fields,
          caption:
            "Reviewer inspects an agent-proposed Busabase metadata diff before approving it for the dataset.",
          confidence: 0.91,
          labels: ["dashboard", "review"],
          status: "approved",
        },
        message: "Correct scene caption and approve labels",
        author: "labeling-agent",
      },
    ],
  },
  {
    id: ids.seoCr,
    baseId: ids.seoBase,
    status: "in_review",
    submittedBy: "seo-agent",
    sourceMeta: { seed: true, scenario: "seo-page-draft", workflow: "seo-pages" },
    minutesAgo: 2,
    useCases: ["seo-pages"],
    operations: [
      {
        id: "opr_seed_seo_page_draft",
        commitId: "cmt_seed_seo_page_draft",
        operation: "record_create",
        fields: {
          slug: "/busabase-vs-airtable",
          category: "comparison",
          locale: "en",
          title: "Busabase vs Airtable — approval-first database for AI agent workflows",
          meta_description:
            "Airtable is built for human teams. Busabase is built for AI agents that propose data and humans that approve it. Compare local-first design, Change Requests, and agent hooks.",
          target_keywords: "busabase vs airtable, ai agent database, approval-first database",
          html_body:
            '<section class="hero"><h1>Busabase vs Airtable</h1><p>Airtable stores flexible data for human teams. Busabase gives AI agents a proposal layer — every agent write is a reviewable Change Request before it becomes a trusted record.</p></section><section class="comparison"><h2>Key differences</h2><ul><li>Busabase is local-first by default</li><li>Every write is a Change Request, not a direct row edit</li><li>Agents propose; humans approve</li></ul></section>',
          status: "draft",
          page_score: null,
          notes: null,
        },
        message: "Draft SEO landing page: Busabase vs Airtable",
        author: "seo-agent",
      },
    ],
  },
  {
    id: ids.configCr,
    baseId: ids.configBase,
    status: "in_review",
    submittedBy: "config-agent",
    sourceMeta: { seed: true, scenario: "rate-limit-increase", workflow: "config-mgmt" },
    minutesAgo: 5,
    useCases: ["config-mgmt"],
    operations: [
      {
        id: "opr_seed_config_rate_limit",
        commitId: "cmt_seed_config_rate_limit",
        operation: "record_update",
        targetRecordId: ids.configRecord,
        baseCommitId: ids.configCommit,
        baseFields: records[9].fields,
        fields: {
          ...records[9].fields,
          config:
            "server:\n  listen: 443\n  ssl: true\n  worker_processes: auto\n\nroutes:\n  - path: /api/v1\n    upstream: backend:8080\n    timeout: 30s\n\nrate_limit:\n  requests_per_minute: 5000\n  burst: 1000\n\nlogging:\n  level: info\n  format: json",
          overrides:
            '{\n  "RATE_LIMIT_RPM": "5000",\n  "BURST_SIZE": "1000",\n  "LOG_LEVEL": "info"\n}',
          notes:
            "Rate limits increased after Black Friday capacity review. config-agent validated against traffic projections.",
        },
        message: "Increase rate limits: 1000 → 5000 rpm, burst 200 → 1000",
        author: "config-agent",
      },
    ],
  },
];

// ────────────────────────────────────────────────────────────────────────────
// Bulk backlog rows per scene Base — bring every README scenario Base up to the
// same "full page" density as Pages (SEO), so each scenario screenshot shows a
// realistic table instead of 4 rows. Same `useCases` tags + field slugs as the
// curated rows above, so they flow through `buildDemoDataset()` and the DB seed.
// ────────────────────────────────────────────────────────────────────────────
const padR = (n: number) => String(n).padStart(3, "0");
const pad2R = (n: number) => String(n).padStart(2, "0");
const dueDate = (i: number) => `2026-${pad2R(7 + (i % 5))}-${pad2R(1 + (i % 27))}`;
const pick = <T>(arr: readonly T[], i: number) => arr[i % arr.length];

const bulkRows = (
  baseId: string,
  prefix: string,
  author: string,
  useCase: DemoUseCase,
  startMinutes: number,
  rows: Array<{ fields: Record<string, unknown>; message: string }>,
): SeedRecordDef[] =>
  rows.map((r, i) => ({
    id: `rec_seed_${prefix}_bulk_${padR(i)}`,
    baseId,
    commitId: `cmt_seed_${prefix}_bulk_${padR(i)}`,
    fields: r.fields,
    message: r.message,
    author,
    minutesAgo: startMinutes + i * 6,
    useCases: [useCase],
  }));

const KNOWLEDGE_TOPICS = [
  "Onboarding runbook",
  "API auth decision log",
  "Vendor shortlist notes",
  "Postmortem: cache outage",
  "Brand voice guidelines",
  "Pricing experiment notes",
  "Competitor teardown: Notion",
  "Security review checklist",
  "Data retention policy",
  "Agent prompt library",
  "Customer interview digest",
  "Roadmap rationale Q3",
  "Incident comms template",
  "Hiring rubric: engineering",
  "Release naming conventions",
  "Support macros source",
];
const KNOWLEDGE_SENSITIVITY = ["private", "team", "public"] as const;
const KNOWLEDGE_TAGS: string[][] = [
  ["agent-memory"],
  ["source"],
  ["decision"],
  ["agent-memory", "decision"],
];
const bulkKnowledge = bulkRows(
  ids.knowledgeBase,
  "knowledge",
  "seed-knowledge",
  "knowledge",
  320,
  KNOWLEDGE_TOPICS.map((title, i) => ({
    fields: {
      title,
      body: `## ${title}\n\nApproved memory note. Captured for private agents with source links and a clear decision trail.`,
      source_url: `https://notes.busabase.local/${i}`,
      sensitivity: pick(KNOWLEDGE_SENSITIVITY, i),
      tags: pick(KNOWLEDGE_TAGS, i),
    },
    message: `Seed knowledge note: ${title}`,
  })),
);

const OPS_TASKS = [
  "Renew SOC2 vendor contract",
  "Rotate production API keys",
  "Migrate billing to new gateway",
  "Audit S3 bucket access",
  "Onboard new payroll vendor",
  "Quarterly access review",
  "Update DPA with subprocessor",
  "Renew SSL certificates",
  "Consolidate logging pipeline",
  "Review on-call rotation",
  "Decommission legacy database",
  "Negotiate cloud commit",
  "Patch CVE in base image",
  "Set up DR failover test",
  "Renew domain registrations",
  "Review vendor SLAs",
];
const OPS_OWNERS = ["ops@busabase.local", "security@busabase.local", "finance@busabase.local"];
const OPS_VENDORS = ["Stripe", "AWS", "Datadog", "Okta", "Gusto", "Cloudflare"];
const OPS_STATUS = ["blocked", "in-progress", "ready"] as const;
const OPS_RISK: string[][] = [["contract"], ["security"], ["data"], ["security", "data"]];
const bulkOps = bulkRows(
  ids.operationsBase,
  "ops",
  "seed-ops",
  "operations",
  300,
  OPS_TASKS.map((task, i) => ({
    fields: {
      task,
      owner: pick(OPS_OWNERS, i),
      vendor: pick(OPS_VENDORS, i),
      due_date: dueDate(i),
      status: pick(OPS_STATUS, i),
      risk_flags: pick(OPS_RISK, i),
    },
    message: `Seed ops task: ${task}`,
  })),
);

const ROUTINE_RUNS = [
  "Daily support QA",
  "Weekly metrics digest",
  "Nightly data sync check",
  "Weekly security scan",
  "Daily agent output review",
  "Weekly churn report",
  "Daily uptime summary",
  "Weekly content audit",
  "Daily backlog triage",
  "Weekly cost review",
  "Daily error budget check",
  "Weekly NPS rollup",
  "Daily lead routing",
  "Weekly release notes",
  "Daily moderation sweep",
  "Weekly roadmap sync",
];
const ROUTINE_TEAMS = ["Support", "Data", "Security", "Growth"];
const ROUTINE_STATUS = ["queued", "needs-review", "approved"] as const;
const bulkRoutine = bulkRows(
  ids.routineBase,
  "routine",
  "seed-routine",
  "routine",
  290,
  ROUTINE_RUNS.map((run, i) => ({
    fields: {
      run: `${run} — ${dueDate(i)}`,
      team: pick(ROUTINE_TEAMS, i),
      run_date: dueDate(i),
      findings: `Agent processed ${10 + i} items; ${i % 4} flagged for human review before notification.`,
      status: pick(ROUTINE_STATUS, i),
      ready_to_notify: i % 3 === 2,
    },
    message: `Seed routine run: ${run}`,
  })),
);

const COMPLIANCE_ITEMS = [
  "Access review — production",
  "Encryption at rest verified",
  "Backup restore tested",
  "Vendor SOC2 on file",
  "Incident response drill",
  "Least-privilege IAM audit",
  "PII data map current",
  "Pen test remediation",
  "Change management log",
  "MFA enforced org-wide",
  "Log retention 1y verified",
  "DPA signed with vendors",
  "Vuln scan zero criticals",
  "Onboarding checklist signed",
  "Offboarding access revoked",
  "Audit trail integrity check",
];
const COMPLIANCE_OWNERS = ["compliance@busabase.local", "security@busabase.local"];
const COMPLIANCE_STATUS = ["missing", "review", "complete"] as const;
const bulkCompliance = bulkRows(
  ids.complianceBase,
  "compliance",
  "seed-compliance",
  "compliance",
  280,
  COMPLIANCE_ITEMS.map((item, i) => ({
    fields: {
      item,
      owner: pick(COMPLIANCE_OWNERS, i),
      due_date: dueDate(i),
      status: pick(COMPLIANCE_STATUS, i),
      notes: `Evidence attached and reviewed. Control checked against the quarterly audit plan.`,
    },
    message: `Seed compliance item: ${item}`,
  })),
);

const RESEARCH_SIGNALS = [
  "Notion AI adds DB automations",
  "Airtable raises pricing",
  "New entrant in agent-DB space",
  "Competitor ships approval flow",
  "Open-source clone gains stars",
  "Enterprise demand for audit trails",
  "Buyers ask about provenance",
  "Shift to usage-based pricing",
  "Video tools bundle publishing",
  "Small models cut inference cost",
  "Regulators float disclosure rules",
  "RAG tooling consolidates",
  "Agents move into ops workflows",
  "Security teams gate AI writes",
  "Creators want review loops",
  "Eval platforms gain traction",
];
const RESEARCH_COMPETITORS = ["Notion", "Airtable", "Coda", "Retool"];
const RESEARCH_IMPORTANCE = ["low", "medium", "high"] as const;
const RESEARCH_SUMMARIES = [
  (s: string, c: string) =>
    `**${s}.** Corroborated across two outlets; overlaps ${c}'s roadmap, so the analyst flagged it for review.`,
  (s: string, c: string) =>
    `**${s}.** Single-source signal pending a second citation; watching whether ${c} responds.`,
  (s: string, c: string) =>
    `**${s}.** Strong signal — multiple threads plus a ${c} changelog entry; recommend a positioning note.`,
];
const bulkResearch = bulkRows(
  ids.researchBase,
  "research",
  "seed-research",
  "research",
  270,
  RESEARCH_SIGNALS.map((signal, i) => ({
    fields: {
      signal,
      source_url: `https://news.busabase.local/${signal.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
      summary: RESEARCH_SUMMARIES[i % RESEARCH_SUMMARIES.length](
        signal,
        pick(RESEARCH_COMPETITORS, i),
      ),
      competitor: pick(RESEARCH_COMPETITORS, i),
      importance: pick(RESEARCH_IMPORTANCE, i),
      confidence: 60 + ((i * 7) % 40),
    },
    message: `Seed research signal: ${signal}`,
  })),
);

const CONTENT_TITLES = [
  "Launch brief: approval-first DB",
  "YouTube script: agent review loop",
  "Blog: provenance as a feature",
  "Social campaign: trust layer",
  "Comparison page: vs Airtable",
  "Tutorial: change requests 101",
  "Webinar: the operator inbox",
  "Case study: research desk",
  "Blog: small models win",
  "YouTube: multimodal review",
  "Newsletter: weekly AI brief",
  "Landing: for AI bloggers",
  "Blog: audit trails sell",
  "Social: boring agents",
  "Tutorial: seed your base",
  "Comparison page: vs Notion",
];
const CONTENT_CHANNEL = ["blog", "youtube", "social"] as const;
const CONTENT_STATUS = ["idea", "draft", "ready"] as const;
const bulkContent = bulkRows(
  ids.contentBase,
  "content",
  "seed-content",
  "content",
  260,
  CONTENT_TITLES.map((title, i) => ({
    fields: {
      title,
      brief: `## ${title}\n\nAngle, audience, and CTA defined. Draft routed through review before publishing.`,
      channel: pick(CONTENT_CHANNEL, i),
      status: pick(CONTENT_STATUS, i),
      seo_title: `${title} | Busabase`,
    },
    message: `Seed content brief: ${title}`,
  })),
);

const TRAINING_QUESTIONS = [
  "How should an agent handle a refusal?",
  "When should an agent escalate to a human?",
  "Explain change request vs commit.",
  "What fields are safe to expose to the client?",
  "How to summarize a long source faithfully?",
  "When is a write reversible?",
  "How to cite a source inline?",
  "What makes a good approval message?",
  "How to detect a stale base commit?",
  "When to archive vs hard delete?",
  "How to label a risky video clip?",
  "What is a canonical record?",
  "How to score answer quality?",
  "When to batch vs single edit?",
  "How to redact PII in output?",
  "What belongs in audit metadata?",
];
const TRAINING_DOMAIN = ["safety", "product", "support"] as const;
const TRAINING_DIFFICULTY = ["easy", "medium", "hard"] as const;
const bulkTraining = bulkRows(
  ids.trainingBase,
  "training",
  "seed-dataset",
  "dataset",
  250,
  TRAINING_QUESTIONS.map((question, i) => ({
    fields: {
      question,
      expected_answer: `A reviewer-approved answer that is reversible, source-cited, and safe to expose.`,
      domain: pick(TRAINING_DOMAIN, i),
      difficulty: pick(TRAINING_DIFFICULTY, i),
      quality_score: 70 + ((i * 5) % 30),
      source_url: `https://eval.busabase.local/${i}`,
    },
    message: `Seed training example: ${question}`,
  })),
);

const LABELING_ITEMS = [
  "Clip 014 — dashboard scene",
  "Clip 015 — review handoff",
  "Frame 221 — agent output",
  "Clip 016 — error state",
  "Frame 222 — approval modal",
  "Clip 017 — mobile review",
  "Frame 223 — diff view",
  "Clip 018 — search results",
  "Frame 224 — empty base",
  "Clip 019 — batch import",
  "Frame 225 — audit timeline",
  "Clip 020 — conflict merge",
  "Frame 226 — settings panel",
  "Clip 021 — skill publish",
  "Frame 227 — record detail",
  "Clip 022 — newsletter compose",
];
const LABELING_LABELS: string[][] = [["dashboard"], ["review"], ["risk"], ["dashboard", "review"]];
const LABELING_STATUS = ["queued", "needs-correction", "approved"] as const;
// Real product screenshots used as the labeled media so the queue shows
// thumbnails (every clip/frame is a captured frame of the Busabase UI).
const LABELING_ASSET_URLS = [
  "/assets/readme/scenarios/multimodal-review-base.png",
  "/assets/readme/busabase-inbox-review.png",
  "/assets/readme/scenarios/canonical-base.png",
  "/assets/readme/busabase-record-detail-audit.png",
  "/assets/readme/scenarios/field-types-record.png",
  "/assets/readme/busabase-base-table.png",
];
const LABELING_CAPTIONS = [
  (item: string) =>
    `${item}: the model proposed scene labels from this frame — a reviewer confirms before it becomes a trusted record.`,
  (item: string) =>
    `Auto-generated description of ${item.toLowerCase()}, flagged for human review of accuracy and tags.`,
  (item: string) =>
    `Agent caption for ${item.toLowerCase()}, pending a reviewer's correction of any mislabeled objects.`,
];
const bulkLabeling = bulkRows(
  ids.labelingBase,
  "labeling",
  "seed-labeling",
  "labeling",
  240,
  LABELING_ITEMS.map((item, i) => ({
    fields: {
      item,
      caption: LABELING_CAPTIONS[i % LABELING_CAPTIONS.length](item),
      labels: pick(LABELING_LABELS, i),
      status: pick(LABELING_STATUS, i),
      confidence: 50 + ((i * 11) % 50),
      asset: [
        {
          id: `att_seed_label_bulk_${i}`,
          attachmentId: `att_seed_label_bulk_${i}`,
          fileName: `${item.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.png`,
          mimeType: "image/png",
          size: 90000 + i * 1200,
          url: LABELING_ASSET_URLS[i % LABELING_ASSET_URLS.length],
        },
      ],
    },
    message: `Seed labeling item: ${item}`,
  })),
);

const CONFIG_SERVICES = [
  "api-gateway",
  "auth-service",
  "billing-worker",
  "search-indexer",
  "email-sender",
  "webhook-dispatcher",
  "rate-limiter",
  "cache-cluster",
  "image-cdn",
  "analytics-pipeline",
  "notification-service",
  "scheduler",
  "pdf-renderer",
  "feature-flags",
  "audit-logger",
  "backup-runner",
];
const CONFIG_ENV = ["development", "staging", "production"] as const;
const CONFIG_STATUS = ["active", "degraded", "maintenance"] as const;
const bulkConfig = bulkRows(
  ids.configBase,
  "config",
  "seed-config",
  "config-mgmt",
  230,
  CONFIG_SERVICES.map((name, i) => ({
    fields: {
      name,
      environment: pick(CONFIG_ENV, i),
      config: `service: ${name}\nreplicas: ${2 + (i % 4)}\ntimeout_ms: ${500 + i * 50}\nretry:\n  attempts: 3\n  backoff_ms: 200`,
      overrides: `{\n  "log_level": "info",\n  "canary": ${i % 2 === 0}\n}`,
      status: pick(CONFIG_STATUS, i),
      deployed_at: dueDate(i),
      notes: `Agent-proposed config change; pending team approval before deploy.`,
    },
    message: `Seed service config: ${name}`,
  })),
);

const bulkReadmeRecords: SeedRecordDef[] = [
  ...bulkKnowledge,
  ...bulkOps,
  ...bulkRoutine,
  ...bulkCompliance,
  ...bulkResearch,
  ...bulkContent,
  ...bulkTraining,
  ...bulkLabeling,
  ...bulkConfig,
];

// ────────────────────────────────────────────────────────────────────────────
// Comparison landing pages — new competitors + zh-CN variants. Generated from a
// compact spec so EN/zh stay in sync. EN lives at the root slug (keyword-matched
// for "busabase vs X"); zh-CN uses the subdirectory locale prefix /zh-CN/* with a
// `locale` field, the SEO-recommended i18n pattern (clean hreflang + breadcrumbs).
// ────────────────────────────────────────────────────────────────────────────
interface CompareSpec {
  key: string;
  name: string;
  /** New competitor → also emit an EN page (the original 5 already have one). */
  isNew?: boolean;
  enThem: string;
  zhThem: string;
  score: number;
}
const COMPARE_SPECS: CompareSpec[] = [
  { key: "notion", name: "Notion", enThem: "Wiki & docs", zhThem: "Wiki 与文档", score: 92 },
  {
    key: "airtable",
    name: "Airtable",
    enThem: "No-code database",
    zhThem: "无代码数据库",
    score: 88,
  },
  {
    key: "google-sheets",
    name: "Google Sheets",
    enThem: "Spreadsheet",
    zhThem: "电子表格",
    score: 84,
  },
  {
    key: "nocodb",
    name: "NocoDB",
    enThem: "Open-source Airtable alt",
    zhThem: "开源 Airtable 替代品",
    score: 80,
  },
  {
    key: "baserow",
    name: "Baserow",
    enThem: "Open-source no-code DB",
    zhThem: "开源无代码数据库",
    score: 80,
  },
  {
    key: "supabase",
    name: "Supabase",
    isNew: true,
    enThem: "Backend-as-a-service",
    zhThem: "后端即服务（BaaS）",
    score: 86,
  },
  {
    key: "appwrite",
    name: "Appwrite",
    isNew: true,
    enThem: "Open-source backend server",
    zhThem: "开源后端服务器",
    score: 82,
  },
  {
    key: "aitable-ai",
    name: "AITable.ai",
    isNew: true,
    enThem: "AI spreadsheet",
    zhThem: "AI 电子表格",
    score: 81,
  },
  {
    key: "apitable",
    name: "APITable",
    isNew: true,
    enThem: "Open-source Airtable alt",
    zhThem: "开源 Airtable 替代品",
    score: 80,
  },
];

const compareTable = (head: [string, string, string], rows: [string, string, string][]) =>
  `<table style="width:100%;border-collapse:collapse;font-size:0.88rem;border:1px solid var(--border);border-radius:0.5rem;overflow:hidden;">
<thead><tr style="background:var(--muted);"><th style="text-align:left;padding:0.7rem 1rem;border-bottom:1px solid var(--border);color:var(--muted-foreground);font-weight:600;">${head[0]}</th><th style="text-align:center;padding:0.7rem 1rem;border-bottom:1px solid var(--border);color:var(--muted-foreground);font-weight:600;">${head[1]}</th><th style="text-align:center;padding:0.7rem 1rem;border-bottom:2px solid var(--foreground);color:var(--foreground);font-weight:700;">${head[2]}</th></tr></thead>
<tbody>${rows
    .map(
      ([l, them, us], i) =>
        `<tr${i % 2 ? ' style="background:var(--muted);"' : ""}><td style="padding:0.6rem 1rem;border-bottom:1px solid var(--border);color:var(--foreground);">${l}</td><td style="text-align:center;padding:0.6rem 1rem;border-bottom:1px solid var(--border);color:var(--muted-foreground);">${them}</td><td style="text-align:center;padding:0.6rem 1rem;border-bottom:1px solid var(--border);color:var(--foreground);font-weight:600;">${us}</td></tr>`,
    )
    .join("")}</tbody></table>`;

const buildComparePage = (spec: CompareSpec, locale: "en" | "zh-CN"): SeedRecordDef => {
  const en = locale === "en";
  const slug = `${en ? "" : "/zh-CN"}/busabase-vs-${spec.key}`;
  const html = en
    ? `<section style="padding:3rem 1.5rem;text-align:center;background:var(--background);">
<p style="display:inline-block;background:var(--muted);color:var(--foreground);border:1px solid var(--border);border-radius:9999px;padding:0.2rem 0.9rem;font-size:0.75rem;font-weight:700;margin-bottom:1.25rem;letter-spacing:0.06em;">COMPARISON</p>
<h1 style="font-size:2.2rem;font-weight: 600;line-height:1.2;margin:0 auto 1rem;max-width:600px;color:var(--foreground);">Busabase vs ${spec.name}<br><span style="color:var(--foreground);">Which is safe for AI agents?</span></h1>
<p style="max-width:520px;margin:0 auto 2rem;color:var(--muted-foreground);font-size:1.05rem;line-height:1.65;">${spec.name} is a great ${spec.enThem.toLowerCase()}. Busabase is an approval-first structured database where AI agents <strong>propose</strong> changes and humans <strong>approve</strong> before anything becomes canonical.</p>
<a href="/dashboard" style="background:var(--primary);color:var(--primary-foreground);padding:0.65rem 1.75rem;border-radius:0.5rem;font-weight:700;font-size:0.9rem;text-decoration:none;display:inline-block;">Try Busabase free →</a>
</section>
<section style="padding:2.25rem 1.5rem;">
<h2 style="text-align:center;font-size:1.35rem;font-weight:700;margin:0 0 1.5rem;color:var(--foreground);">Busabase vs ${spec.name} at a glance</h2>
${compareTable(
  ["Capability", spec.name, "Busabase"],
  [
    ["Primary use", spec.enThem, "Approval-first DB for AI agents"],
    ["AI agent write gate", "✗ direct writes", "✓ Change Requests"],
    ["Human approval inbox", "✗", "✓ Built-in"],
    ["Audit / commit trail", "~ limited", "✓ Every write logged"],
    ["Pricing", "Per-seat / managed", "Free & open source"],
  ],
)}
</section>`
    : `<section style="padding:3rem 1.5rem;text-align:center;background:var(--background);">
<p style="display:inline-block;background:var(--muted);color:var(--foreground);border:1px solid var(--border);border-radius:9999px;padding:0.2rem 0.9rem;font-size:0.75rem;font-weight:700;margin-bottom:1.25rem;letter-spacing:0.06em;">对比</p>
<h1 style="font-size:2.2rem;font-weight: 600;line-height:1.25;margin:0 auto 1rem;max-width:600px;color:var(--foreground);">Busabase vs ${spec.name}<br><span style="color:var(--foreground);">谁更适合 AI agent？</span></h1>
<p style="max-width:520px;margin:0 auto 2rem;color:var(--muted-foreground);font-size:1.05rem;line-height:1.7;">${spec.name} 是很好的${spec.zhThem}。Busabase 是面向 AI agent 的<strong>审批优先</strong>结构化数据库——agent <strong>提议</strong>修改，人工<strong>审批</strong>后才会成为正式数据。</p>
<a href="/dashboard" style="background:var(--primary);color:var(--primary-foreground);padding:0.65rem 1.75rem;border-radius:0.5rem;font-weight:700;font-size:0.9rem;text-decoration:none;display:inline-block;">免费试用 Busabase →</a>
</section>
<section style="padding:2.25rem 1.5rem;">
<h2 style="text-align:center;font-size:1.35rem;font-weight:700;margin:0 0 1.5rem;color:var(--foreground);">Busabase vs ${spec.name} 一览</h2>
${compareTable(
  ["能力", spec.name, "Busabase"],
  [
    ["核心定位", spec.zhThem, "面向 AI agent 的审批优先数据库"],
    ["AI 写入闸门", "✗ 直接写入", "✓ 变更请求"],
    ["人工审批收件箱", "✗", "✓ 内置"],
    ["审计 / 提交记录", "~ 有限", "✓ 每次写入留痕"],
    ["价格", "按席位 / 托管", "免费 & 开源"],
  ],
)}
</section>`;
  return {
    id: `rec_seed_seo_cmp_${spec.key.replace(/-/g, "_")}_${en ? "en" : "zh"}`,
    baseId: ids.seoBase,
    commitId: `cmt_seed_seo_cmp_${spec.key.replace(/-/g, "_")}_${en ? "en" : "zh"}`,
    fields: {
      slug,
      title: en
        ? `Busabase vs ${spec.name} — approval-first database for AI agents`
        : `Busabase vs ${spec.name} —— 面向 AI agent 的审批优先数据库`,
      meta_description: en
        ? `Compare Busabase and ${spec.name} for AI-agent workflows. Busabase adds Change Requests, a human approval inbox, and a full commit trail on top of a local-first database.`
        : `对比 Busabase 与 ${spec.name} 在 AI agent 工作流中的差异。Busabase 在本地优先数据库之上提供变更请求、人工审批收件箱与完整提交记录。`,
      target_keywords: en
        ? `busabase vs ${spec.name.toLowerCase()}, ${spec.name.toLowerCase()} alternative, ai agent database`
        : `busabase vs ${spec.name.toLowerCase()}, ${spec.name} 替代, AI agent 数据库`,
      category: "comparison",
      locale,
      html_body: html,
      status: spec.isNew && en ? "in-review" : "live",
      page_score: spec.score,
      notes: en
        ? `Hero + comparison table + CTA. Generated EN comparison page for ${spec.name}.`
        : `中文对比页（/zh-CN 前缀）：${spec.name}。`,
    },
    message: `Seed comparison page: busabase vs ${spec.name} (${locale})`,
    author: "seed-seo",
    minutesAgo: (en ? 70 : 50) + COMPARE_SPECS.indexOf(spec),
    useCases: ["seo-pages"],
  };
};

const bulkSeoPages: SeedRecordDef[] = [
  ...COMPARE_SPECS.filter((s) => s.isNew).map((s) => buildComparePage(s, "en")),
  ...COMPARE_SPECS.map((s) => buildComparePage(s, "zh-CN")),
];

readmeScenario.records = [...records, ...bulkReadmeRecords, ...bulkSeoPages];
readmeScenario.views = views;
readmeScenario.changeRequests = changeRequests;
