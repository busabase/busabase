import type { SeedBaseDef, SeedRecordDef, SeedScenario } from "../seed-types";

/**
 * Cross-functional EN demo bases — the English twins of the zh-cn `expand` scenario,
 * so EN and ZH have the same base set. Each base lives in an existing folder
 * (finance / knowledge / operations / routine-work / compliance / research /
 * content-factory / datasets) with the same slug + field schema as its zh twin.
 */

// ── Base ids (referenced by inter-base relation fields) ──────────────────────
const EXPENSE = "bse_local_expense";
const MEETING = "bse_local_meeting";
const PROJDOC = "bse_local_projdoc";
const EVENTS = "bse_local_events";
const CHANNELS = "bse_local_channels";
const TODOS = "bse_local_todos";
const WEEKLY = "bse_local_weekly";
const RISKS = "bse_local_risks";
const CONTRACTS = "bse_local_contracts";
const COMPETITORS = "bse_local_competitors";
const INTERVIEWS = "bse_local_interviews";
const TOPICS = "bse_local_topics";
const EDITORIAL = "bse_local_editorial";
const EVALS = "bse_local_evals";

export const CROSS_FUNCTIONAL_BASES: SeedBaseDef[] = [
  // ── Finance ────────────────────────────────────────────────────────────────
  {
    id: EXPENSE,
    nodeId: "nod_base_expense",
    folderNodeId: "nod_finance",
    slug: "expense-reimbursements",
    name: "Expense Reimbursements",
    description: "Employee expense claims and approvals, linked to contracts.",
    useCases: ["finance"],
    fields: [
      {
        id: "bsf_exp_title",
        slug: "title",
        name: "Title",
        type: "text",
        required: true,
        options: {},
      },
      {
        id: "bsf_exp_amount",
        slug: "amount",
        name: "Amount",
        type: "number",
        required: true,
        options: {},
      },
      {
        id: "bsf_exp_category",
        slug: "category",
        name: "Category",
        type: "select",
        required: false,
        options: {
          choices: [
            { id: "travel", name: "Travel", color: "blue" },
            { id: "meal", name: "Meals", color: "amber" },
            { id: "office", name: "Office supplies", color: "emerald" },
            { id: "equipment", name: "Equipment", color: "violet" },
            { id: "other", name: "Other", color: "slate" },
          ],
        },
      },
      {
        id: "bsf_exp_applicant",
        slug: "applicant",
        name: "Applicant",
        type: "text",
        required: true,
        options: {},
      },
      {
        id: "bsf_exp_date",
        slug: "apply_date",
        name: "Apply Date",
        type: "date",
        required: false,
        options: {},
      },
      {
        id: "bsf_exp_status",
        slug: "status",
        name: "Status",
        type: "select",
        required: false,
        options: {
          choices: [
            { id: "pending", name: "Pending", color: "amber" },
            { id: "approved", name: "Approved", color: "emerald" },
            { id: "rejected", name: "Rejected", color: "rose" },
            { id: "reimbursed", name: "Reimbursed", color: "slate" },
          ],
        },
      },
      {
        id: "bsf_exp_notes",
        slug: "notes",
        name: "Notes",
        type: "text",
        required: false,
        options: {},
      },
      {
        id: "bsf_exp_contract_ref",
        slug: "contract-ref",
        name: "Linked Contract",
        type: "relation",
        required: false,
        options: { targetBaseId: CONTRACTS },
      },
    ],
  },
  // ── Knowledge ──────────────────────────────────────────────────────────────
  {
    id: MEETING,
    nodeId: "nod_base_meeting",
    folderNodeId: "nod_knowledge",
    slug: "meeting-notes",
    name: "Meeting Notes",
    description: "Meeting records with agenda, decisions, and follow-ups.",
    useCases: ["knowledge"],
    fields: [
      {
        id: "bsf_mtg_title",
        slug: "title",
        name: "Topic",
        type: "text",
        required: true,
        options: {},
      },
      { id: "bsf_mtg_date", slug: "date", name: "Date", type: "date", required: true, options: {} },
      {
        id: "bsf_mtg_attendees",
        slug: "attendees",
        name: "Attendees",
        type: "text",
        required: false,
        options: {},
      },
      {
        id: "bsf_mtg_summary",
        slug: "summary",
        name: "Summary",
        type: "markdown",
        required: false,
        options: {},
      },
      {
        id: "bsf_mtg_actions",
        slug: "action_items",
        name: "Action Items",
        type: "text",
        required: false,
        options: {},
      },
      {
        id: "bsf_mtg_status",
        slug: "status",
        name: "Status",
        type: "select",
        required: false,
        options: {
          choices: [
            { id: "draft", name: "Draft", color: "amber" },
            { id: "confirmed", name: "Confirmed", color: "emerald" },
          ],
        },
      },
      {
        id: "bsf_mtg_todos_ref",
        slug: "action-items-ref",
        name: "Linked Todos",
        type: "relation",
        required: false,
        options: { targetBaseId: TODOS },
      },
    ],
  },
  {
    id: PROJDOC,
    nodeId: "nod_base_projdoc",
    folderNodeId: "nod_knowledge",
    slug: "project-docs",
    name: "Project Docs",
    description: "Project specs, design docs, technical reports, and milestones.",
    useCases: ["knowledge"],
    fields: [
      {
        id: "bsf_pd_title",
        slug: "title",
        name: "Doc Title",
        type: "text",
        required: true,
        options: {},
      },
      {
        id: "bsf_pd_project",
        slug: "project",
        name: "Project",
        type: "text",
        required: true,
        options: {},
      },
      {
        id: "bsf_pd_type",
        slug: "type",
        name: "Type",
        type: "select",
        required: false,
        options: {
          choices: [
            { id: "spec", name: "Spec", color: "blue" },
            { id: "design", name: "Design", color: "violet" },
            { id: "report", name: "Report", color: "emerald" },
            { id: "standard", name: "Standard", color: "amber" },
          ],
        },
      },
      {
        id: "bsf_pd_version",
        slug: "version",
        name: "Version",
        type: "text",
        required: false,
        options: {},
      },
      {
        id: "bsf_pd_content",
        slug: "content",
        name: "Content",
        type: "markdown",
        required: false,
        options: {},
      },
      {
        id: "bsf_pd_status",
        slug: "status",
        name: "Status",
        type: "select",
        required: false,
        options: {
          choices: [
            { id: "draft", name: "Draft", color: "amber" },
            { id: "review", name: "In review", color: "blue" },
            { id: "published", name: "Published", color: "emerald" },
          ],
        },
      },
      {
        id: "bsf_pd_meeting_ref",
        slug: "meeting-ref",
        name: "Linked Meeting",
        type: "relation",
        required: false,
        options: { targetBaseId: MEETING },
      },
    ],
  },
  // ── Operations ─────────────────────────────────────────────────────────────
  {
    id: EVENTS,
    nodeId: "nod_base_events",
    folderNodeId: "nod_operations",
    slug: "event-planning",
    name: "Event Planning",
    description: "Marketing and community events with budget, owner, and status.",
    useCases: ["operations"],
    fields: [
      { id: "bsf_ev_name", slug: "name", name: "Name", type: "text", required: true, options: {} },
      {
        id: "bsf_ev_type",
        slug: "type",
        name: "Type",
        type: "select",
        required: false,
        options: {
          choices: [
            { id: "online", name: "Online", color: "blue" },
            { id: "offline", name: "Offline", color: "emerald" },
            { id: "hybrid", name: "Hybrid", color: "violet" },
          ],
        },
      },
      {
        id: "bsf_ev_date",
        slug: "event_date",
        name: "Event Date",
        type: "date",
        required: false,
        options: {},
      },
      {
        id: "bsf_ev_budget",
        slug: "budget",
        name: "Budget",
        type: "number",
        required: false,
        options: {},
      },
      {
        id: "bsf_ev_owner",
        slug: "owner",
        name: "Owner",
        type: "text",
        required: false,
        options: {},
      },
      {
        id: "bsf_ev_desc",
        slug: "description",
        name: "Description",
        type: "text",
        required: false,
        options: {},
      },
      {
        id: "bsf_ev_status",
        slug: "status",
        name: "Status",
        type: "select",
        required: false,
        options: {
          choices: [
            { id: "planning", name: "Planning", color: "amber" },
            { id: "ongoing", name: "Ongoing", color: "blue" },
            { id: "done", name: "Done", color: "emerald" },
            { id: "cancelled", name: "Cancelled", color: "rose" },
          ],
        },
      },
      {
        id: "bsf_ev_channel_ref",
        slug: "channel-ref",
        name: "Linked Channel",
        type: "relation",
        required: false,
        options: { targetBaseId: CHANNELS },
      },
    ],
  },
  {
    id: CHANNELS,
    nodeId: "nod_base_channels",
    folderNodeId: "nod_operations",
    slug: "channel-management",
    name: "Channel Management",
    description: "Marketing/sales channels with owner, monthly goal, and status.",
    useCases: ["operations"],
    fields: [
      { id: "bsf_ch_name", slug: "name", name: "Name", type: "text", required: true, options: {} },
      {
        id: "bsf_ch_platform",
        slug: "platform",
        name: "Platform",
        type: "select",
        required: false,
        options: {
          choices: [
            { id: "wechat", name: "WeChat", color: "emerald" },
            { id: "douyin", name: "Douyin", color: "slate" },
            { id: "weibo", name: "Weibo", color: "rose" },
            { id: "linkedin", name: "LinkedIn", color: "blue" },
            { id: "website", name: "Website", color: "violet" },
            { id: "other", name: "Other", color: "amber" },
          ],
        },
      },
      {
        id: "bsf_ch_owner",
        slug: "owner",
        name: "Owner",
        type: "text",
        required: false,
        options: {},
      },
      {
        id: "bsf_ch_goal",
        slug: "monthly_goal",
        name: "Monthly Goal",
        type: "number",
        required: false,
        options: {},
      },
      {
        id: "bsf_ch_status",
        slug: "status",
        name: "Status",
        type: "select",
        required: false,
        options: {
          choices: [
            { id: "active", name: "Active", color: "emerald" },
            { id: "paused", name: "Paused", color: "amber" },
            { id: "inactive", name: "Inactive", color: "slate" },
          ],
        },
      },
      {
        id: "bsf_ch_notes",
        slug: "notes",
        name: "Notes",
        type: "text",
        required: false,
        options: {},
      },
    ],
  },
  // ── Routine Work ───────────────────────────────────────────────────────────
  {
    id: TODOS,
    nodeId: "nod_base_todos",
    folderNodeId: "nod_routine",
    slug: "todos",
    name: "Todos",
    description: "Personal and team todos with priority, assignee, and status.",
    useCases: ["routine"],
    fields: [
      {
        id: "bsf_td_title",
        slug: "title",
        name: "Title",
        type: "text",
        required: true,
        options: {},
      },
      {
        id: "bsf_td_priority",
        slug: "priority",
        name: "Priority",
        type: "select",
        required: false,
        options: {
          choices: [
            { id: "high", name: "High", color: "rose" },
            { id: "medium", name: "Medium", color: "amber" },
            { id: "low", name: "Low", color: "slate" },
          ],
        },
      },
      {
        id: "bsf_td_due",
        slug: "due_date",
        name: "Due Date",
        type: "date",
        required: false,
        options: {},
      },
      {
        id: "bsf_td_assignee",
        slug: "assignee",
        name: "Assignee",
        type: "text",
        required: false,
        options: {},
      },
      {
        id: "bsf_td_status",
        slug: "status",
        name: "Status",
        type: "select",
        required: false,
        options: {
          choices: [
            { id: "open", name: "Open", color: "amber" },
            { id: "in_progress", name: "In progress", color: "blue" },
            { id: "done", name: "Done", color: "emerald" },
            { id: "blocked", name: "Blocked", color: "rose" },
          ],
        },
      },
      {
        id: "bsf_td_desc",
        slug: "description",
        name: "Description",
        type: "text",
        required: false,
        options: {},
      },
    ],
  },
  {
    id: WEEKLY,
    nodeId: "nod_base_weekly",
    folderNodeId: "nod_routine",
    slug: "weekly-reports",
    name: "Weekly Reports",
    description: "Weekly status reports — highlights, blockers, and next week.",
    useCases: ["routine"],
    fields: [
      {
        id: "bsf_wk_period",
        slug: "period",
        name: "Period",
        type: "text",
        required: true,
        options: {},
      },
      {
        id: "bsf_wk_highlights",
        slug: "highlights",
        name: "Highlights",
        type: "markdown",
        required: false,
        options: {},
      },
      {
        id: "bsf_wk_blockers",
        slug: "blockers",
        name: "Blockers",
        type: "text",
        required: false,
        options: {},
      },
      {
        id: "bsf_wk_next",
        slug: "next_week",
        name: "Next Week",
        type: "text",
        required: false,
        options: {},
      },
      {
        id: "bsf_wk_status",
        slug: "status",
        name: "Status",
        type: "select",
        required: false,
        options: {
          choices: [
            { id: "draft", name: "Draft", color: "amber" },
            { id: "submitted", name: "Submitted", color: "emerald" },
          ],
        },
      },
    ],
  },
  // ── Compliance ─────────────────────────────────────────────────────────────
  {
    id: RISKS,
    nodeId: "nod_base_risks",
    folderNodeId: "nod_compliance",
    slug: "risk-register",
    name: "Risk Register",
    description: "Risks with category, severity, mitigation, and linked contracts.",
    useCases: ["compliance"],
    fields: [
      {
        id: "bsf_rk_title",
        slug: "title",
        name: "Title",
        type: "text",
        required: true,
        options: {},
      },
      {
        id: "bsf_rk_category",
        slug: "category",
        name: "Category",
        type: "select",
        required: false,
        options: {
          choices: [
            { id: "security", name: "Security", color: "rose" },
            { id: "compliance", name: "Compliance", color: "amber" },
            { id: "ops", name: "Operations", color: "blue" },
            { id: "finance", name: "Finance", color: "emerald" },
            { id: "legal", name: "Legal", color: "violet" },
          ],
        },
      },
      {
        id: "bsf_rk_severity",
        slug: "severity",
        name: "Severity",
        type: "select",
        required: false,
        options: {
          choices: [
            { id: "high", name: "High", color: "rose" },
            { id: "medium", name: "Medium", color: "amber" },
            { id: "low", name: "Low", color: "emerald" },
          ],
        },
      },
      {
        id: "bsf_rk_owner",
        slug: "owner",
        name: "Owner",
        type: "text",
        required: false,
        options: {},
      },
      {
        id: "bsf_rk_mitigation",
        slug: "mitigation",
        name: "Mitigation",
        type: "text",
        required: false,
        options: {},
      },
      {
        id: "bsf_rk_status",
        slug: "status",
        name: "Status",
        type: "select",
        required: false,
        options: {
          choices: [
            { id: "identified", name: "Identified", color: "amber" },
            { id: "mitigating", name: "Mitigating", color: "blue" },
            { id: "mitigated", name: "Mitigated", color: "emerald" },
            { id: "closed", name: "Closed", color: "slate" },
          ],
        },
      },
      {
        id: "bsf_rk_contract_ref",
        slug: "contract-ref",
        name: "Linked Contract",
        type: "relation",
        required: false,
        options: { targetBaseId: CONTRACTS },
      },
    ],
  },
  {
    id: CONTRACTS,
    nodeId: "nod_base_contracts",
    folderNodeId: "nod_compliance",
    slug: "contract-ledger",
    name: "Contract Ledger",
    description: "Contracts with party, amount, type, dates, and status.",
    useCases: ["compliance"],
    fields: [
      { id: "bsf_ct_name", slug: "name", name: "Name", type: "text", required: true, options: {} },
      {
        id: "bsf_ct_party",
        slug: "party",
        name: "Party",
        type: "text",
        required: true,
        options: {},
      },
      {
        id: "bsf_ct_amount",
        slug: "amount",
        name: "Amount",
        type: "number",
        required: false,
        options: {},
      },
      {
        id: "bsf_ct_type",
        slug: "type",
        name: "Type",
        type: "select",
        required: false,
        options: {
          choices: [
            { id: "service", name: "Service agreement", color: "blue" },
            { id: "purchase", name: "Purchase", color: "emerald" },
            { id: "partnership", name: "Partnership", color: "violet" },
            { id: "nda", name: "NDA", color: "amber" },
          ],
        },
      },
      {
        id: "bsf_ct_start",
        slug: "start_date",
        name: "Start Date",
        type: "date",
        required: false,
        options: {},
      },
      {
        id: "bsf_ct_end",
        slug: "end_date",
        name: "End Date",
        type: "date",
        required: false,
        options: {},
      },
      {
        id: "bsf_ct_status",
        slug: "status",
        name: "Status",
        type: "select",
        required: false,
        options: {
          choices: [
            { id: "draft", name: "Draft", color: "amber" },
            { id: "active", name: "Active", color: "emerald" },
            { id: "expired", name: "Expired", color: "rose" },
            { id: "terminated", name: "Terminated", color: "slate" },
          ],
        },
      },
    ],
  },
  // ── Research ───────────────────────────────────────────────────────────────
  {
    id: COMPETITORS,
    nodeId: "nod_base_competitors",
    folderNodeId: "nod_research",
    slug: "competitor-analysis",
    name: "Competitor Analysis",
    description: "Competitors with strengths, weaknesses, and linked interviews.",
    useCases: ["research"],
    fields: [
      { id: "bsf_cp_name", slug: "name", name: "Name", type: "text", required: true, options: {} },
      {
        id: "bsf_cp_category",
        slug: "category",
        name: "Category",
        type: "select",
        required: false,
        options: {
          choices: [
            { id: "direct", name: "Direct", color: "rose" },
            { id: "indirect", name: "Indirect", color: "amber" },
            { id: "alternative", name: "Alternative", color: "slate" },
          ],
        },
      },
      {
        id: "bsf_cp_strengths",
        slug: "strengths",
        name: "Strengths",
        type: "markdown",
        required: false,
        options: {},
      },
      {
        id: "bsf_cp_weaknesses",
        slug: "weaknesses",
        name: "Weaknesses",
        type: "markdown",
        required: false,
        options: {},
      },
      {
        id: "bsf_cp_analyzed",
        slug: "analyzed_at",
        name: "Analyzed At",
        type: "date",
        required: false,
        options: {},
      },
      {
        id: "bsf_cp_status",
        slug: "status",
        name: "Status",
        type: "select",
        required: false,
        options: {
          choices: [
            { id: "ongoing", name: "Ongoing", color: "blue" },
            { id: "done", name: "Done", color: "emerald" },
          ],
        },
      },
      {
        id: "bsf_cp_interview_ref",
        slug: "interview-ref",
        name: "Linked Interview",
        type: "relation",
        required: false,
        options: { targetBaseId: INTERVIEWS },
      },
    ],
  },
  {
    id: INTERVIEWS,
    nodeId: "nod_base_interviews",
    folderNodeId: "nod_research",
    slug: "user-interviews",
    name: "User Interviews",
    description: "User interviews — insights, pain points, and status.",
    useCases: ["research"],
    fields: [
      {
        id: "bsf_iv_interviewee",
        slug: "interviewee",
        name: "Interviewee",
        type: "text",
        required: true,
        options: {},
      },
      {
        id: "bsf_iv_date",
        slug: "interview_date",
        name: "Interview Date",
        type: "date",
        required: false,
        options: {},
      },
      { id: "bsf_iv_role", slug: "role", name: "Role", type: "text", required: false, options: {} },
      {
        id: "bsf_iv_insights",
        slug: "key_insights",
        name: "Key Insights",
        type: "markdown",
        required: false,
        options: {},
      },
      {
        id: "bsf_iv_pains",
        slug: "pain_points",
        name: "Pain Points",
        type: "text",
        required: false,
        options: {},
      },
      {
        id: "bsf_iv_status",
        slug: "status",
        name: "Status",
        type: "select",
        required: false,
        options: {
          choices: [
            { id: "scheduled", name: "Scheduled", color: "amber" },
            { id: "done", name: "Done", color: "emerald" },
            { id: "analyzed", name: "Analyzed", color: "blue" },
          ],
        },
      },
    ],
  },
  // ── Content Factory ────────────────────────────────────────────────────────
  {
    id: TOPICS,
    nodeId: "nod_base_topics",
    folderNodeId: "nod_content_factory",
    slug: "topic-ideas",
    name: "Topic Ideas",
    description: "Content topic backlog with priority, source, and editorial link.",
    useCases: ["content"],
    fields: [
      {
        id: "bsf_tp_title",
        slug: "title",
        name: "Title",
        type: "text",
        required: true,
        options: {},
      },
      {
        id: "bsf_tp_category",
        slug: "category",
        name: "Category",
        type: "select",
        required: false,
        options: {
          choices: [
            { id: "insight", name: "Industry insight", color: "blue" },
            { id: "tutorial", name: "Tutorial", color: "emerald" },
            { id: "case", name: "Case study", color: "violet" },
            { id: "opinion", name: "Opinion", color: "amber" },
          ],
        },
      },
      {
        id: "bsf_tp_source",
        slug: "source",
        name: "Source",
        type: "text",
        required: false,
        options: {},
      },
      {
        id: "bsf_tp_priority",
        slug: "priority",
        name: "Priority",
        type: "select",
        required: false,
        options: {
          choices: [
            { id: "high", name: "High", color: "rose" },
            { id: "medium", name: "Medium", color: "amber" },
            { id: "low", name: "Low", color: "slate" },
          ],
        },
      },
      {
        id: "bsf_tp_status",
        slug: "status",
        name: "Status",
        type: "select",
        required: false,
        options: {
          choices: [
            { id: "idea", name: "Idea", color: "slate" },
            { id: "approved", name: "Approved", color: "blue" },
            { id: "writing", name: "Writing", color: "amber" },
            { id: "published", name: "Published", color: "emerald" },
          ],
        },
      },
      {
        id: "bsf_tp_notes",
        slug: "notes",
        name: "Notes",
        type: "text",
        required: false,
        options: {},
      },
      {
        id: "bsf_tp_editorial_ref",
        slug: "editorial-ref",
        name: "Linked Editorial",
        type: "relation",
        required: false,
        options: { targetBaseId: EDITORIAL },
      },
    ],
  },
  {
    id: EDITORIAL,
    nodeId: "nod_base_editorial",
    folderNodeId: "nod_content_factory",
    slug: "editorial-calendar",
    name: "Editorial Calendar",
    description: "Editorial calendar — content type, channel, publish date, author.",
    useCases: ["content"],
    fields: [
      {
        id: "bsf_ed_title",
        slug: "title",
        name: "Title",
        type: "text",
        required: true,
        options: {},
      },
      {
        id: "bsf_ed_content_type",
        slug: "content_type",
        name: "Content Type",
        type: "select",
        required: false,
        options: {
          choices: [
            { id: "blog", name: "Blog", color: "blue" },
            { id: "video", name: "Video", color: "violet" },
            { id: "social", name: "Social", color: "emerald" },
            { id: "email", name: "Email", color: "amber" },
            { id: "whitepaper", name: "Whitepaper", color: "slate" },
          ],
        },
      },
      {
        id: "bsf_ed_channel",
        slug: "channel",
        name: "Channel",
        type: "text",
        required: false,
        options: {},
      },
      {
        id: "bsf_ed_publish",
        slug: "publish_date",
        name: "Publish Date",
        type: "date",
        required: false,
        options: {},
      },
      {
        id: "bsf_ed_author",
        slug: "author",
        name: "Author",
        type: "text",
        required: false,
        options: {},
      },
      {
        id: "bsf_ed_status",
        slug: "status",
        name: "Status",
        type: "select",
        required: false,
        options: {
          choices: [
            { id: "planned", name: "Planned", color: "slate" },
            { id: "writing", name: "Writing", color: "amber" },
            { id: "review", name: "Review", color: "blue" },
            { id: "published", name: "Published", color: "emerald" },
          ],
        },
      },
    ],
  },
  // ── Datasets ───────────────────────────────────────────────────────────────
  {
    id: EVALS,
    nodeId: "nod_base_evals",
    folderNodeId: "nod_datasets",
    slug: "model-evals",
    name: "Model Evals",
    description: "Model evaluation runs — task, score, benchmark, and notes.",
    useCases: ["dataset"],
    fields: [
      {
        id: "bsf_ml_model",
        slug: "model",
        name: "Model",
        type: "text",
        required: true,
        options: {},
      },
      { id: "bsf_ml_task", slug: "task", name: "Task", type: "text", required: false, options: {} },
      {
        id: "bsf_ml_score",
        slug: "score",
        name: "Score",
        type: "number",
        required: false,
        options: {},
      },
      {
        id: "bsf_ml_benchmark",
        slug: "benchmark",
        name: "Benchmark",
        type: "text",
        required: false,
        options: {},
      },
      {
        id: "bsf_ml_date",
        slug: "eval_date",
        name: "Eval Date",
        type: "date",
        required: false,
        options: {},
      },
      {
        id: "bsf_ml_notes",
        slug: "notes",
        name: "Notes",
        type: "text",
        required: false,
        options: {},
      },
    ],
  },
];

// ── Records ──────────────────────────────────────────────────────────────────
type Row = { fields: Record<string, unknown>; minutesAgo: number };
const recs: SeedRecordDef[] = [];
const seed = (key: string, baseId: string, useCase: string, rows: Row[]) => {
  rows.forEach((r, i) => {
    recs.push({
      id: `rec_seed_${key}_${i + 1}`,
      baseId,
      commitId: `cmt_seed_${key}_${i + 1}`,
      fields: r.fields,
      message: `Seed ${key} record ${i + 1}`,
      author: "seed-ops",
      // Offset so these additive demo records are older than the core seed records
      // (which tests expect in the most-recent page) — they don't displace them.
      minutesAgo: r.minutesAgo + 5000,
      useCases: [useCase as SeedRecordDef["useCases"][number]],
    });
  });
};

seed("expense", EXPENSE, "finance", [
  {
    minutesAgo: 120,
    fields: {
      title: "Q2 client visit — flights & hotel",
      amount: 1840,
      category: "travel",
      applicant: "alex@busabase.local",
      apply_date: "2026-05-22",
      status: "reimbursed",
      notes: "Two nights, economy flights.",
    },
  },
  {
    minutesAgo: 260,
    fields: {
      title: "Team offsite lunch",
      amount: 320,
      category: "meal",
      applicant: "mia@busabase.local",
      apply_date: "2026-05-28",
      status: "approved",
      notes: "8 people.",
    },
  },
  {
    minutesAgo: 500,
    fields: {
      title: "Standing desks (x2)",
      amount: 760,
      category: "equipment",
      applicant: "sam@busabase.local",
      apply_date: "2026-06-02",
      status: "pending",
      notes: "Awaiting manager sign-off.",
    },
  },
  {
    minutesAgo: 800,
    fields: {
      title: "Printer paper & toner",
      amount: 95,
      category: "office",
      applicant: "lee@busabase.local",
      apply_date: "2026-06-05",
      status: "approved",
      notes: "",
    },
  },
  {
    minutesAgo: 1300,
    fields: {
      title: "Conference ticket (rejected)",
      amount: 1200,
      category: "other",
      applicant: "kai@busabase.local",
      apply_date: "2026-06-08",
      status: "rejected",
      notes: "Over budget this quarter.",
    },
  },
]);

seed("meeting", MEETING, "knowledge", [
  {
    minutesAgo: 90,
    fields: {
      title: "Weekly product sync",
      date: "2026-06-22",
      attendees: "Product, Eng, Design",
      summary: "## Decisions\n- Ship the inbox redesign\n- Defer bulk-edit to next sprint",
      action_items: "Eng to spike bulk-edit",
      status: "confirmed",
    },
  },
  {
    minutesAgo: 300,
    fields: {
      title: "Go-to-market planning",
      date: "2026-06-19",
      attendees: "GTM, Founders",
      summary: "## Plan\n- Product Hunt launch in 2 weeks\n- Line up 3 directories",
      action_items: "Draft launch checklist",
      status: "confirmed",
    },
  },
  {
    minutesAgo: 700,
    fields: {
      title: "Design review — record detail",
      date: "2026-06-15",
      attendees: "Design, Eng",
      summary: "Reviewed the new field-type previews.",
      action_items: "Fix attachment thumbnails",
      status: "confirmed",
    },
  },
  {
    minutesAgo: 1200,
    fields: {
      title: "Hiring debrief",
      date: "2026-06-10",
      attendees: "Founders, Eng lead",
      summary: "Two strong backend candidates.",
      action_items: "Send offers",
      status: "draft",
    },
  },
  {
    minutesAgo: 2000,
    fields: {
      title: "Q3 OKR kickoff",
      date: "2026-06-01",
      attendees: "All hands",
      summary: "Set the three company OKRs for Q3.",
      action_items: "Owners to draft KRs",
      status: "confirmed",
    },
  },
]);

seed("projdoc", PROJDOC, "knowledge", [
  {
    minutesAgo: 150,
    fields: {
      title: "Field-type system — spec",
      project: "Field types",
      type: "spec",
      version: "1.2",
      content: "## Goal\nSupport every field type incl. relations.",
      status: "published",
    },
  },
  {
    minutesAgo: 400,
    fields: {
      title: "Change-request merge design",
      project: "Review loop",
      type: "design",
      version: "0.9",
      content: "State machine: in_review → approved → merged.",
      status: "review",
    },
  },
  {
    minutesAgo: 900,
    fields: {
      title: "Sync engine — technical report",
      project: "Local-first",
      type: "report",
      version: "1.0",
      content: "Benchmarks for the local-first sync layer.",
      status: "published",
    },
  },
  {
    minutesAgo: 1600,
    fields: {
      title: "API naming standard",
      project: "Platform",
      type: "standard",
      version: "2.1",
      content: "REST conventions for /api/v1.",
      status: "draft",
    },
  },
  {
    minutesAgo: 2300,
    fields: {
      title: "AirApp sandbox — architecture notes",
      project: "AirApp",
      type: "report",
      version: "1.0",
      content:
        "Nodepod runs Node's API surface inside a Web Worker — no real OS process, so anything needing a native binary or a real headless browser is out of scope. See the AirApp docs for the current working/broken tool matrix.",
      status: "published",
    },
  },
  {
    minutesAgo: 3100,
    fields: {
      title: "Unified grep — retrieval strategy",
      project: "Search",
      type: "spec",
      version: "1.1",
      content:
        "One regex/literal scan across files, Docs, and Base records, with one coverage report per query.",
      status: "published",
    },
  },
]);

seed("events", EVENTS, "operations", [
  {
    minutesAgo: 110,
    fields: {
      name: "Product Hunt launch day",
      type: "online",
      event_date: "2026-07-01",
      budget: 500,
      owner: "growth@busabase.local",
      description: "Coordinated launch + AMA.",
      status: "planning",
    },
  },
  {
    minutesAgo: 280,
    fields: {
      name: "Local AI builders meetup",
      type: "offline",
      event_date: "2026-06-25",
      budget: 1200,
      owner: "mia@busabase.local",
      description: "Talk + demo, 40 seats.",
      status: "ongoing",
    },
  },
  {
    minutesAgo: 600,
    fields: {
      name: "Webinar: review-first AI data",
      type: "online",
      event_date: "2026-06-12",
      budget: 300,
      owner: "growth@busabase.local",
      description: "45-min webinar + Q&A.",
      status: "done",
    },
  },
  {
    minutesAgo: 1100,
    fields: {
      name: "Conference booth",
      type: "offline",
      event_date: "2026-05-30",
      budget: 8000,
      owner: "founders@busabase.local",
      description: "Booth + swag.",
      status: "done",
    },
  },
  {
    minutesAgo: 1900,
    fields: {
      name: "Hybrid launch party (cancelled)",
      type: "hybrid",
      event_date: "2026-05-20",
      budget: 2000,
      owner: "ops@busabase.local",
      description: "Cut for budget.",
      status: "cancelled",
    },
  },
]);

seed("channels", CHANNELS, "operations", [
  {
    minutesAgo: 130,
    fields: {
      name: "Company X (LinkedIn)",
      platform: "linkedin",
      owner: "growth@busabase.local",
      monthly_goal: 20,
      status: "active",
      notes: "Founder-led posting.",
    },
  },
  {
    minutesAgo: 320,
    fields: {
      name: "Product blog",
      platform: "website",
      owner: "content@busabase.local",
      monthly_goal: 8,
      status: "active",
      notes: "2 posts/week.",
    },
  },
  {
    minutesAgo: 700,
    fields: {
      name: "WeChat official account",
      platform: "wechat",
      owner: "mia@busabase.local",
      monthly_goal: 12,
      status: "active",
      notes: "China audience.",
    },
  },
  {
    minutesAgo: 1300,
    fields: {
      name: "Douyin shortform",
      platform: "douyin",
      owner: "video@busabase.local",
      monthly_goal: 10,
      status: "paused",
      notes: "Resuming after rebrand.",
    },
  },
  {
    minutesAgo: 2100,
    fields: {
      name: "Weibo (inactive)",
      platform: "weibo",
      owner: "mia@busabase.local",
      monthly_goal: 0,
      status: "inactive",
      notes: "Deprioritized.",
    },
  },
]);

seed("todos", TODOS, "routine", [
  {
    minutesAgo: 60,
    fields: {
      title: "Fix attachment thumbnail crop",
      priority: "high",
      due_date: "2026-06-24",
      assignee: "eng@busabase.local",
      status: "in_progress",
      description: "Square crop in record detail.",
    },
  },
  {
    minutesAgo: 200,
    fields: {
      title: "Write Product Hunt copy",
      priority: "high",
      due_date: "2026-06-28",
      assignee: "growth@busabase.local",
      status: "open",
      description: "Tagline + first comment.",
    },
  },
  {
    minutesAgo: 450,
    fields: {
      title: "Refresh StackShare listing",
      priority: "low",
      due_date: "2026-07-02",
      assignee: "seo@busabase.local",
      status: "open",
      description: "Stale logo + copy.",
    },
  },
  {
    minutesAgo: 900,
    fields: {
      title: "Triage inbound bug reports",
      priority: "medium",
      due_date: "2026-06-20",
      assignee: "eng@busabase.local",
      status: "done",
      description: "Weekly triage.",
    },
  },
  {
    minutesAgo: 1500,
    fields: {
      title: "Unblock CI flaky test",
      priority: "high",
      due_date: "2026-06-18",
      assignee: "eng@busabase.local",
      status: "blocked",
      description: "Waiting on infra.",
    },
  },
]);

seed("weekly", WEEKLY, "routine", [
  {
    minutesAgo: 100,
    fields: {
      period: "2026-W25",
      highlights: "## Highlights\n- Shipped field-type previews\n- Closed 12 issues",
      blockers: "CI flakiness",
      next_week: "Launch prep",
      status: "submitted",
    },
  },
  {
    minutesAgo: 10100,
    fields: {
      period: "2026-W24",
      highlights: "## Highlights\n- Inbox redesign merged",
      blockers: "None",
      next_week: "Bulk-edit spike",
      status: "submitted",
    },
  },
  {
    minutesAgo: 20100,
    fields: {
      period: "2026-W23",
      highlights: "Onboarding revamp started.",
      blockers: "Design bandwidth",
      next_week: "Finish onboarding",
      status: "draft",
    },
  },
  {
    minutesAgo: 30100,
    fields: {
      period: "2026-W22",
      highlights:
        "## Highlights\n- Migrated search to the unified grep index\n- Fixed 3 flaky e2e specs",
      blockers: "None",
      next_week: "Onboarding revamp kickoff",
      status: "submitted",
    },
  },
  {
    minutesAgo: 40100,
    fields: {
      period: "2026-W21",
      highlights: "## Highlights\n- Webhook retries shipped\n- Docs pass on the API reference",
      blockers: "Waiting on design review for the new empty states",
      next_week: "Search migration",
      status: "submitted",
    },
  },
]);

seed("risks", RISKS, "compliance", [
  {
    minutesAgo: 140,
    fields: {
      title: "PII in demo data",
      category: "compliance",
      severity: "medium",
      owner: "legal@busabase.local",
      mitigation: "Use synthetic data only.",
      status: "mitigated",
    },
  },
  {
    minutesAgo: 350,
    fields: {
      title: "Single cloud region dependency",
      category: "ops",
      severity: "high",
      owner: "eng@busabase.local",
      mitigation: "Add a second region.",
      status: "mitigating",
    },
  },
  {
    minutesAgo: 750,
    fields: {
      title: "Vendor lock-in (auth)",
      category: "legal",
      severity: "low",
      owner: "founders@busabase.local",
      mitigation: "Abstract the auth layer.",
      status: "identified",
    },
  },
  {
    minutesAgo: 1400,
    fields: {
      title: "Secrets in CI logs",
      category: "security",
      severity: "high",
      owner: "eng@busabase.local",
      mitigation: "Mask secrets in logs.",
      status: "closed",
    },
  },
  {
    minutesAgo: 2200,
    fields: {
      title: "Late invoice payments",
      category: "finance",
      severity: "low",
      owner: "finance@busabase.local",
      mitigation: "Net-30 reminders.",
      status: "identified",
    },
  },
]);

seed("contracts", CONTRACTS, "compliance", [
  {
    minutesAgo: 160,
    fields: {
      name: "Cloud platform agreement",
      party: "Globex Cloud",
      amount: 125000,
      type: "service",
      start_date: "2026-01-01",
      end_date: "2026-12-31",
      status: "active",
    },
  },
  {
    minutesAgo: 380,
    fields: {
      name: "Design tool seats",
      party: "Figma",
      amount: 8400,
      type: "purchase",
      start_date: "2026-03-01",
      end_date: "2027-02-28",
      status: "active",
    },
  },
  {
    minutesAgo: 820,
    fields: {
      name: "Reseller partnership",
      party: "Acme SaaS",
      amount: 0,
      type: "partnership",
      start_date: "2026-04-15",
      end_date: "2027-04-14",
      status: "active",
    },
  },
  {
    minutesAgo: 1500,
    fields: {
      name: "Mutual NDA — Northwind",
      party: "Northwind Retail",
      amount: 0,
      type: "nda",
      start_date: "2026-02-10",
      end_date: "2028-02-09",
      status: "active",
    },
  },
  {
    minutesAgo: 2400,
    fields: {
      name: "Old hosting contract",
      party: "LegacyHost",
      amount: 24000,
      type: "service",
      start_date: "2025-01-01",
      end_date: "2025-12-31",
      status: "expired",
    },
  },
]);

seed("competitors", COMPETITORS, "research", [
  {
    minutesAgo: 170,
    fields: {
      name: "Airtable",
      category: "direct",
      strengths: "Mature, huge template library.",
      weaknesses: "Not local-first; pricey at scale.",
      analyzed_at: "2026-06-10",
      status: "done",
    },
  },
  {
    minutesAgo: 420,
    fields: {
      name: "Notion",
      category: "indirect",
      strengths: "Docs + DB blend, great UX.",
      weaknesses: "Weak as a real database.",
      analyzed_at: "2026-06-08",
      status: "done",
    },
  },
  {
    minutesAgo: 900,
    fields: {
      name: "Baserow",
      category: "alternative",
      strengths: "Open source, self-hostable.",
      weaknesses: "Smaller ecosystem.",
      analyzed_at: "2026-06-04",
      status: "done",
    },
  },
  {
    minutesAgo: 1600,
    fields: {
      name: "Retool",
      category: "indirect",
      strengths: "Strong internal-tools story.",
      weaknesses: "Not a spreadsheet/DB.",
      analyzed_at: "2026-05-30",
      status: "ongoing",
    },
  },
  {
    minutesAgo: 2600,
    fields: {
      name: "Google Sheets",
      category: "alternative",
      strengths: "Ubiquitous, free.",
      weaknesses: "No structure, no review loop.",
      analyzed_at: "2026-05-25",
      status: "ongoing",
    },
  },
]);

seed("interviews", INTERVIEWS, "research", [
  {
    minutesAgo: 190,
    fields: {
      interviewee: "Dana (ops lead)",
      interview_date: "2026-06-11",
      role: "Operations",
      key_insights: "Wants an approval trail on every edit.",
      pain_points: "Spreadsheets get overwritten silently.",
      status: "analyzed",
    },
  },
  {
    minutesAgo: 460,
    fields: {
      interviewee: "Wei (data PM)",
      interview_date: "2026-06-07",
      role: "Data PM",
      key_insights: "Needs AI summaries reviewable, not auto-applied.",
      pain_points: "AI fields can't be trusted blindly.",
      status: "analyzed",
    },
  },
  {
    minutesAgo: 1000,
    fields: {
      interviewee: "Priya (founder)",
      interview_date: "2026-06-03",
      role: "Founder",
      key_insights: "Local-first is a buying trigger.",
      pain_points: "Data leaving the building.",
      status: "done",
    },
  },
  {
    minutesAgo: 1800,
    fields: {
      interviewee: "Tom (analyst)",
      interview_date: "2026-05-28",
      role: "Analyst",
      key_insights: "Wants relation fields across bases.",
      pain_points: "Copy-pasting IDs by hand.",
      status: "done",
    },
  },
  {
    minutesAgo: 2800,
    fields: {
      interviewee: "Mara (content)",
      interview_date: "2026-05-22",
      role: "Content lead",
      key_insights: "An editorial calendar in the same DB.",
      pain_points: "Calendar lives in a separate tool.",
      status: "scheduled",
    },
  },
]);

seed("topics", TOPICS, "content", [
  {
    minutesAgo: 100,
    fields: {
      title: "Why review-first beats auto-apply for AI data",
      category: "opinion",
      source: "User interviews",
      priority: "high",
      status: "approved",
      notes: "Tie to the change-request workflow.",
    },
  },
  {
    minutesAgo: 240,
    fields: {
      title: "Local-first databases, explained",
      category: "insight",
      source: "Competitor analysis",
      priority: "high",
      status: "writing",
      notes: "",
    },
  },
  {
    minutesAgo: 520,
    fields: {
      title: "Tutorial: model a CRM with relations",
      category: "tutorial",
      source: "Docs gap",
      priority: "medium",
      status: "idea",
      notes: "Use companies/contacts/deals.",
    },
  },
  {
    minutesAgo: 1000,
    fields: {
      title: "Case study: a content team on Busabase",
      category: "case",
      source: "Customer",
      priority: "medium",
      status: "published",
      notes: "",
    },
  },
  {
    minutesAgo: 1700,
    fields: {
      title: "Field types you didn't know you needed",
      category: "tutorial",
      source: "Field-type lab",
      priority: "low",
      status: "idea",
      notes: "Cover attachment + relation.",
    },
  },
]);

seed("editorial", EDITORIAL, "content", [
  {
    minutesAgo: 105,
    fields: {
      title: "Review-first AI data (blog)",
      content_type: "blog",
      channel: "Product blog",
      publish_date: "2026-06-26",
      author: "content@busabase.local",
      status: "review",
    },
  },
  {
    minutesAgo: 250,
    fields: {
      title: "Local-first explainer (video)",
      content_type: "video",
      channel: "YouTube",
      publish_date: "2026-06-30",
      author: "video@busabase.local",
      status: "writing",
    },
  },
  {
    minutesAgo: 540,
    fields: {
      title: "PH launch announcement (social)",
      content_type: "social",
      channel: "LinkedIn",
      publish_date: "2026-07-01",
      author: "growth@busabase.local",
      status: "planned",
    },
  },
  {
    minutesAgo: 1050,
    fields: {
      title: "Monthly product newsletter",
      content_type: "email",
      channel: "Newsletter",
      publish_date: "2026-06-15",
      author: "content@busabase.local",
      status: "published",
    },
  },
  {
    minutesAgo: 1750,
    fields: {
      title: "Local-first whitepaper",
      content_type: "whitepaper",
      channel: "Website",
      publish_date: "2026-07-10",
      author: "founders@busabase.local",
      status: "planned",
    },
  },
]);

seed("evals", EVALS, "dataset", [
  {
    minutesAgo: 115,
    fields: {
      model: "gpt-5-mini",
      task: "Record summarization",
      score: 0.91,
      benchmark: "internal-summ-v2",
      eval_date: "2026-06-18",
      notes: "Best cost/quality.",
    },
  },
  {
    minutesAgo: 330,
    fields: {
      model: "claude-haiku",
      task: "Tag extraction",
      score: 0.88,
      benchmark: "internal-tags-v1",
      eval_date: "2026-06-14",
      notes: "Fast, slightly noisier tags.",
    },
  },
  {
    minutesAgo: 760,
    fields: {
      model: "gpt-5",
      task: "Change-request risk scoring",
      score: 0.94,
      benchmark: "internal-risk-v1",
      eval_date: "2026-06-09",
      notes: "Strong but pricier.",
    },
  },
  {
    minutesAgo: 1450,
    fields: {
      model: "local-llama",
      task: "Record summarization",
      score: 0.79,
      benchmark: "internal-summ-v2",
      eval_date: "2026-05-27",
      notes: "On-device fallback.",
    },
  },
  {
    minutesAgo: 2100,
    fields: {
      model: "gpt-5-mini",
      task: "Change-request risk scoring",
      score: 0.85,
      benchmark: "internal-risk-v1",
      eval_date: "2026-05-20",
      notes:
        "Cheaper alternative to gpt-5 for risk scoring — 9 points lower but well within acceptable range for low-stakes changes.",
    },
  },
]);

export const CROSS_FUNCTIONAL_RECORDS = recs;

export const crossFunctionalScenario: SeedScenario = {
  bases: CROSS_FUNCTIONAL_BASES,
  records: CROSS_FUNCTIONAL_RECORDS,
};
