// Demo scenario: an insurance agency / brokerage book of business. This is the
// "industry vertical" counterpart to finance-invoice.ts — an advisor's day job
// (prospect → needs analysis → proposal → policy → renewal) modeled as three
// related Bases, plus one node of every other kind so a fresh workspace shows
// what a real vertical looks like when it is fully built out:
//
//   Base        → Clients / Policies / Renewal Tasks (relation + lookup + formula)
//   Views       → table, kanban, calendar, gantt
//   Doc         → the advisor playbook (with an in-review doc_update)
//   File        → commission ledger CSV + underwriting cheat-sheet JSON
//   Skill       → a renewal assistant the agent reads before it proposes
//   Drive       → the client-facing material library
//   AirApp      → a renewal board that reads the Policies Base live over /api/v1
//   Whiteboard  → the advisor's book-of-business map
//   Workflow    → the renewal-outreach flow, approval gated
//   HTML        → a proposal one-pager prototype
//   Form        → the public consultation form, submitting as a pending CR
//
// The zh-CN counterpart (`insurance-agency.zh-cn.ts`) reuses every structural
// id exported here, with Chinese content and CNY amounts — exactly the split
// finance-invoice.ts / finance-invoice.zh-cn.ts already uses.
import { evaluateFormula, type FormulaValue } from "../../domains/base/formula";
import type {
  SeedBaseDef,
  SeedChangeRequestDef,
  SeedCommentDef,
  SeedDocDef,
  SeedFileDef,
  SeedFileTreeDef,
  SeedFolderDef,
  SeedFormDef,
  SeedRecordDef,
  SeedRichNodeDef,
  SeedScenario,
  SeedViewDef,
} from "../seed-types";

// ── Structural ids (shared with the zh-CN scenario) ──────────────────────────

export const DEMO_INSURANCE_FOLDER_NODE_ID = "nod_insurance";

export const DEMO_INSURANCE_CLIENTS_BASE_ID = "bse_local_insurance_clients";
export const DEMO_INSURANCE_CLIENTS_BASE_NODE_ID = "nod_base_insurance_clients";
export const DEMO_INSURANCE_POLICIES_BASE_ID = "bse_local_insurance_policies";
export const DEMO_INSURANCE_POLICIES_BASE_NODE_ID = "nod_base_insurance_policies";
export const DEMO_INSURANCE_RENEWALS_BASE_ID = "bse_local_insurance_renewals";
export const DEMO_INSURANCE_RENEWALS_BASE_NODE_ID = "nod_base_insurance_renewals";

export const INSURANCE_CLIENT_NEW_PARENTS_ID = "rec_seed_ins_client_new_parents";
export const INSURANCE_CLIENT_BUSINESS_OWNER_ID = "rec_seed_ins_client_business_owner";
export const INSURANCE_CLIENT_FLEET_MANAGER_ID = "rec_seed_ins_client_fleet_manager";
export const INSURANCE_CLIENT_PRE_RETIREE_ID = "rec_seed_ins_client_pre_retiree";
export const INSURANCE_CLIENT_EXPAT_ID = "rec_seed_ins_client_expat";
export const INSURANCE_CLIENT_FAMILY_OFFICE_ID = "rec_seed_ins_client_family_office";
export const INSURANCE_CLIENT_CORPORATE_GROUP_ID = "rec_seed_ins_client_corporate_group";

export const INSURANCE_POLICY_TERM_LIFE_ID = "rec_seed_ins_policy_term_life";
export const INSURANCE_POLICY_CRITICAL_ILLNESS_ID = "rec_seed_ins_policy_critical_illness";
export const INSURANCE_POLICY_KEYMAN_ID = "rec_seed_ins_policy_keyman";
export const INSURANCE_POLICY_FLEET_AUTO_ID = "rec_seed_ins_policy_fleet_auto";
export const INSURANCE_POLICY_SENIOR_HEALTH_ID = "rec_seed_ins_policy_senior_health";
export const INSURANCE_POLICY_TRAVEL_ID = "rec_seed_ins_policy_travel";
export const INSURANCE_POLICY_ESTATE_UL_ID = "rec_seed_ins_policy_estate_ul";
export const INSURANCE_POLICY_GROUP_TERM_ID = "rec_seed_ins_policy_group_term";

export const INSURANCE_RENEWAL_FLEET_ID = "rec_seed_ins_renewal_fleet";
export const INSURANCE_RENEWAL_SENIOR_HEALTH_ID = "rec_seed_ins_renewal_senior_health";
export const INSURANCE_RENEWAL_TRAVEL_ID = "rec_seed_ins_renewal_travel";
export const INSURANCE_RENEWAL_KEYMAN_ID = "rec_seed_ins_renewal_keyman";
export const INSURANCE_RENEWAL_ESTATE_ID = "rec_seed_ins_renewal_estate";
export const INSURANCE_RENEWAL_GROUP_ID = "rec_seed_ins_renewal_group";

export const INSURANCE_CLIENT_NEW_PARENTS_COMMIT_ID = "cmt_seed_ins_client_new_parents";
export const INSURANCE_CLIENT_BUSINESS_OWNER_COMMIT_ID = "cmt_seed_ins_client_business_owner";
export const INSURANCE_CLIENT_FLEET_MANAGER_COMMIT_ID = "cmt_seed_ins_client_fleet_manager";
export const INSURANCE_CLIENT_PRE_RETIREE_COMMIT_ID = "cmt_seed_ins_client_pre_retiree";
export const INSURANCE_CLIENT_EXPAT_COMMIT_ID = "cmt_seed_ins_client_expat";
export const INSURANCE_CLIENT_FAMILY_OFFICE_COMMIT_ID = "cmt_seed_ins_client_family_office";
export const INSURANCE_CLIENT_CORPORATE_GROUP_COMMIT_ID = "cmt_seed_ins_client_corporate_group";

export const INSURANCE_POLICY_TERM_LIFE_COMMIT_ID = "cmt_seed_ins_policy_term_life";
export const INSURANCE_POLICY_CRITICAL_ILLNESS_COMMIT_ID = "cmt_seed_ins_policy_critical_illness";
export const INSURANCE_POLICY_KEYMAN_COMMIT_ID = "cmt_seed_ins_policy_keyman";
export const INSURANCE_POLICY_FLEET_AUTO_COMMIT_ID = "cmt_seed_ins_policy_fleet_auto";
export const INSURANCE_POLICY_SENIOR_HEALTH_COMMIT_ID = "cmt_seed_ins_policy_senior_health";
export const INSURANCE_POLICY_TRAVEL_COMMIT_ID = "cmt_seed_ins_policy_travel";
export const INSURANCE_POLICY_ESTATE_UL_COMMIT_ID = "cmt_seed_ins_policy_estate_ul";
export const INSURANCE_POLICY_GROUP_TERM_COMMIT_ID = "cmt_seed_ins_policy_group_term";

export const INSURANCE_RENEWAL_FLEET_COMMIT_ID = "cmt_seed_ins_renewal_fleet";
export const INSURANCE_RENEWAL_SENIOR_HEALTH_COMMIT_ID = "cmt_seed_ins_renewal_senior_health";
export const INSURANCE_RENEWAL_TRAVEL_COMMIT_ID = "cmt_seed_ins_renewal_travel";
export const INSURANCE_RENEWAL_KEYMAN_COMMIT_ID = "cmt_seed_ins_renewal_keyman";
export const INSURANCE_RENEWAL_ESTATE_COMMIT_ID = "cmt_seed_ins_renewal_estate";
export const INSURANCE_RENEWAL_GROUP_COMMIT_ID = "cmt_seed_ins_renewal_group";

export const INSURANCE_REQUOTE_CR_ID = "crq_seed_ins_fleet_requote";
export const INSURANCE_INTAKE_CR_ID = "crq_seed_ins_client_intake";
export const INSURANCE_PLAYBOOK_CR_ID = "crq_seed_ins_doc_playbook";
export const INSURANCE_SKILL_CR_ID = "crq_seed_ins_skill_renewal_assistant";

export const INSURANCE_PLAYBOOK_DOC_NODE_ID = "nod_doc_insurance_playbook";
export const INSURANCE_PRODUCT_MATRIX_DOC_NODE_ID = "nod_doc_insurance_product_matrix";
export const INSURANCE_COMMISSION_FILE_NODE_ID = "nod_file_insurance_commission_ledger";
export const INSURANCE_UNDERWRITING_FILE_NODE_ID = "nod_file_insurance_underwriting_rules";
export const INSURANCE_SKILL_NODE_ID = "nod_skill_policy_renewal_assistant";
export const INSURANCE_DRIVE_NODE_ID = "nod_drive_insurance_materials";
export const INSURANCE_AIRAPP_NODE_ID = "nod_airapp_insurance_renewal_board";
export const INSURANCE_AGENT_DESK_NODE_ID = "nod_airapp_insurance_agent_desk";
export const INSURANCE_AGENCY_SCOREBOARD_NODE_ID = "nod_airapp_insurance_agency_scoreboard";
export const INSURANCE_ISSUANCE_DESK_NODE_ID = "nod_airapp_insurance_issuance_desk";
export const INSURANCE_WHITEBOARD_NODE_ID = "nod_whiteboard_insurance_book";
export const INSURANCE_WORKFLOW_NODE_ID = "nod_workflow_insurance_renewal";
export const INSURANCE_HTML_NODE_ID = "nod_html_insurance_proposal";
export const INSURANCE_FORM_NODE_ID = "nod_form_insurance_consult";
export const INSURANCE_FORM_ID = "frm_insurance_consult";

// ── Formula: commission earned on a policy ───────────────────────────────────
// The real merge path computes `formula` fields through field-types.ts's
// `compute` registry, but the seed path writes commit fields directly and never
// runs it (same reason stock-picking.ts bakes its signals in). Evaluate with the
// SAME engine and the SAME expression string the field definition carries, so a
// seeded commission can never drift from what a real write would produce.
export const INSURANCE_COMMISSION_EXPRESSION = "ROUND({premium} * {commission_rate} / 100, 2)";

// Record fields are `Record<string, unknown>` (they hold attachment refs and
// relation id arrays too), so narrow to the scalar shapes the engine accepts
// rather than casting — the expression only ever reads numeric columns.
const toFormulaValue = (value: unknown): FormulaValue =>
  typeof value === "number" || typeof value === "string" || typeof value === "boolean"
    ? value
    : null;

export const withComputedCommission = <T extends Record<string, unknown>>(fields: T) => ({
  ...fields,
  commission_amount: evaluateFormula(INSURANCE_COMMISSION_EXPRESSION, (slug) =>
    toFormulaValue(fields[slug]),
  ),
});

// ── Folder ───────────────────────────────────────────────────────────────────

const INSURANCE_FOLDERS: SeedFolderDef[] = [
  {
    nodeId: DEMO_INSURANCE_FOLDER_NODE_ID,
    slug: "insurance",
    name: "Insurance Agency",
    description:
      "An advisor's book of business — clients, policies in force, and the renewal work that keeps them there.",
    position: 7,
  },
];

// ── Fields ───────────────────────────────────────────────────────────────────

const clientFields = [
  {
    id: "bsf_ins_client_name",
    slug: "client_name",
    name: "Client",
    type: "text",
    required: true,
    options: {},
  },
  {
    id: "bsf_ins_client_phone",
    slug: "phone",
    name: "Phone",
    type: "phone",
    required: false,
    options: {},
  },
  {
    id: "bsf_ins_client_email",
    slug: "email",
    name: "Email",
    type: "email",
    required: false,
    options: {},
  },
  {
    id: "bsf_ins_client_stage",
    slug: "stage",
    name: "Stage",
    type: "select",
    required: false,
    options: {
      choices: [
        { id: "lead", name: "Lead", color: "slate" },
        { id: "contacted", name: "Contacted", color: "sky" },
        { id: "needs-analysis", name: "Needs analysis", color: "violet" },
        { id: "proposal", name: "Proposal sent", color: "amber" },
        { id: "insured", name: "Insured", color: "emerald" },
        { id: "lost", name: "Lost", color: "rose" },
      ],
    },
  },
  {
    id: "bsf_ins_client_source",
    slug: "source",
    name: "Source",
    type: "select",
    required: false,
    options: {
      choices: [
        { id: "referral", name: "Client referral", color: "emerald" },
        { id: "community", name: "Community event", color: "sky" },
        { id: "social", name: "Social content", color: "violet" },
        { id: "orphan-book", name: "Orphan book", color: "amber" },
        { id: "walk-in", name: "Walk-in", color: "slate" },
      ],
    },
  },
  {
    id: "bsf_ins_client_focus",
    slug: "protection_focus",
    name: "Protection Focus",
    type: "multiselect",
    required: false,
    options: {
      choices: [
        { id: "life", name: "Life", color: "sky" },
        { id: "health", name: "Health", color: "emerald" },
        { id: "auto", name: "Auto", color: "amber" },
        { id: "property", name: "Property", color: "violet" },
        { id: "travel", name: "Travel", color: "rose" },
        { id: "retirement", name: "Retirement", color: "slate" },
      ],
    },
  },
  {
    id: "bsf_ins_client_budget",
    slug: "annual_budget",
    name: "Annual Budget",
    type: "number",
    required: false,
    options: { number: { format: "currency", currency: "USD", locale: "en-US" } },
  },
  {
    id: "bsf_ins_client_next_follow_up",
    slug: "next_follow_up",
    name: "Next Follow-up",
    type: "date",
    required: false,
    options: {},
  },
  {
    id: "bsf_ins_client_advisor",
    slug: "advisor",
    name: "Advisor",
    type: "text",
    required: false,
    options: {},
  },
  {
    id: "bsf_ins_client_policies",
    slug: "policies",
    name: "Policies",
    type: "relation",
    required: false,
    options: { multiple: true, targetBaseId: DEMO_INSURANCE_POLICIES_BASE_ID },
  },
  // The two numbers an advisor is actually measured on. Both are lookups rather
  // than stored columns: they must move the moment a policy's premium changes,
  // which is exactly what read-time rollups are for.
  {
    id: "bsf_ins_client_policy_count",
    slug: "policy_count",
    name: "Policies In Force",
    type: "lookup",
    required: false,
    options: {
      lookup: {
        relationFieldSlug: "policies",
        targetFieldSlug: "policy_number",
        rollup: "count",
      },
    },
  },
  {
    id: "bsf_ins_client_premium_in_force",
    slug: "premium_in_force",
    name: "Premium In Force",
    type: "lookup",
    required: false,
    options: {
      lookup: {
        relationFieldSlug: "policies",
        targetFieldSlug: "premium",
        rollup: "sum",
      },
      number: { format: "currency", currency: "USD" },
    },
  },
  {
    id: "bsf_ins_client_notes",
    slug: "notes",
    name: "Advisor Notes",
    type: "longtext",
    required: false,
    options: {},
  },
  {
    id: "bsf_ins_client_ai_summary",
    slug: "ai_summary",
    name: "AI Summary",
    type: "ai_summary",
    required: false,
    options: {
      ai: { model: "gpt-5-mini", reviewRequired: true, sourceFieldIds: ["bsf_ins_client_notes"] },
    },
  },
] satisfies SeedBaseDef["fields"];

const policyFields = [
  {
    id: "bsf_ins_policy_number",
    slug: "policy_number",
    name: "Policy Number",
    type: "text",
    required: true,
    options: {},
  },
  {
    id: "bsf_ins_policy_client",
    slug: "client",
    name: "Client",
    type: "relation",
    required: false,
    options: { multiple: false, targetBaseId: DEMO_INSURANCE_CLIENTS_BASE_ID },
  },
  {
    id: "bsf_ins_policy_insurer",
    slug: "insurer",
    name: "Insurer",
    type: "text",
    required: false,
    options: {},
  },
  {
    id: "bsf_ins_policy_product",
    slug: "product",
    name: "Product",
    type: "text",
    required: false,
    options: {},
  },
  {
    id: "bsf_ins_policy_line",
    slug: "product_line",
    name: "Product Line",
    type: "select",
    required: false,
    options: {
      choices: [
        { id: "life", name: "Life", color: "sky" },
        { id: "health", name: "Health", color: "emerald" },
        { id: "auto", name: "Auto", color: "amber" },
        { id: "property", name: "Property", color: "violet" },
        { id: "travel", name: "Travel", color: "rose" },
      ],
    },
  },
  {
    id: "bsf_ins_policy_premium",
    slug: "premium",
    name: "Annual Premium",
    type: "number",
    required: false,
    options: { number: { format: "currency", currency: "USD", locale: "en-US" } },
  },
  {
    id: "bsf_ins_policy_sum_insured",
    slug: "sum_insured",
    name: "Sum Insured",
    type: "number",
    required: false,
    options: { number: { format: "currency", currency: "USD", locale: "en-US" } },
  },
  {
    id: "bsf_ins_policy_commission_rate",
    slug: "commission_rate",
    name: "Commission Rate (%)",
    type: "number",
    required: false,
    options: { number: { format: "plain" } },
  },
  // Unit lives in the field NAME, not in `options.number`: the cell renderer
  // only applies currency formatting to `number` and `lookup` fields (see
  // dashboard/helpers/field.ts), so a `number` option here would be dead config.
  {
    id: "bsf_ins_policy_commission_amount",
    slug: "commission_amount",
    name: "Commission (USD)",
    type: "formula",
    required: false,
    options: { formula: { expression: INSURANCE_COMMISSION_EXPRESSION } },
  },
  {
    id: "bsf_ins_policy_effective_date",
    slug: "effective_date",
    name: "Effective Date",
    type: "date",
    required: false,
    options: {},
  },
  {
    id: "bsf_ins_policy_renewal_date",
    slug: "renewal_date",
    name: "Renewal Date",
    type: "date",
    required: false,
    options: {},
  },
  {
    id: "bsf_ins_policy_status",
    slug: "status",
    name: "Status",
    type: "select",
    required: false,
    options: {
      choices: [
        { id: "quoting", name: "Quoting", color: "slate" },
        { id: "underwriting", name: "Underwriting", color: "amber" },
        { id: "active", name: "Active", color: "emerald" },
        { id: "lapsed", name: "Lapsed", color: "rose" },
        { id: "renewed", name: "Renewed", color: "sky" },
      ],
    },
  },
  {
    id: "bsf_ins_policy_file",
    slug: "policy_file",
    name: "Policy Document",
    type: "attachment",
    required: false,
    options: {
      attachment: {
        allowedMimeTypes: ["application/pdf", "image/png"],
        maxFileSize: 15 * 1024 * 1024,
        maxFiles: 3,
      },
    },
  },
  {
    id: "bsf_ins_policy_notes",
    slug: "notes",
    name: "Underwriting Notes",
    type: "longtext",
    required: false,
    options: {},
  },
] satisfies SeedBaseDef["fields"];

const renewalFields = [
  {
    id: "bsf_ins_renewal_task",
    slug: "task",
    name: "Task",
    type: "text",
    required: true,
    options: {},
  },
  {
    id: "bsf_ins_renewal_policy",
    slug: "policy",
    name: "Policy",
    type: "relation",
    required: false,
    options: { multiple: false, targetBaseId: DEMO_INSURANCE_POLICIES_BASE_ID },
  },
  {
    id: "bsf_ins_renewal_due_date",
    slug: "due_date",
    name: "Due Date",
    type: "date",
    required: false,
    options: {},
  },
  {
    id: "bsf_ins_renewal_channel",
    slug: "channel",
    name: "Channel",
    type: "select",
    required: false,
    options: {
      choices: [
        { id: "call", name: "Phone call", color: "sky" },
        { id: "message", name: "Message", color: "emerald" },
        { id: "email", name: "Email", color: "violet" },
        { id: "in-person", name: "In person", color: "amber" },
      ],
    },
  },
  {
    id: "bsf_ins_renewal_status",
    slug: "status",
    name: "Status",
    type: "select",
    required: false,
    options: {
      choices: [
        { id: "todo", name: "To do", color: "slate" },
        { id: "in-progress", name: "In progress", color: "amber" },
        { id: "done", name: "Done", color: "emerald" },
        { id: "deferred", name: "Deferred", color: "rose" },
      ],
    },
  },
  {
    id: "bsf_ins_renewal_owner",
    slug: "owner",
    name: "Owner",
    type: "text",
    required: false,
    options: {},
  },
  {
    id: "bsf_ins_renewal_outcome",
    slug: "outcome",
    name: "Outcome",
    type: "longtext",
    required: false,
    options: {},
  },
] satisfies SeedBaseDef["fields"];

// ── Bases ────────────────────────────────────────────────────────────────────

const INSURANCE_BASES: SeedBaseDef[] = [
  {
    id: DEMO_INSURANCE_CLIENTS_BASE_ID,
    nodeId: DEMO_INSURANCE_CLIENTS_BASE_NODE_ID,
    slug: "insurance-clients",
    name: "Clients",
    description:
      "Prospects and insured households, with the policies in force rolled up per client.",
    folderNodeId: DEMO_INSURANCE_FOLDER_NODE_ID,
    useCases: ["insurance"],
    fields: clientFields,
  },
  {
    id: DEMO_INSURANCE_POLICIES_BASE_ID,
    nodeId: DEMO_INSURANCE_POLICIES_BASE_NODE_ID,
    slug: "insurance-policies",
    name: "Policies",
    description:
      "Every policy the agency placed — premium, sum insured, renewal date, and the commission it earns.",
    folderNodeId: DEMO_INSURANCE_FOLDER_NODE_ID,
    useCases: ["insurance"],
    fields: policyFields,
  },
  {
    id: DEMO_INSURANCE_RENEWALS_BASE_ID,
    nodeId: DEMO_INSURANCE_RENEWALS_BASE_NODE_ID,
    slug: "insurance-renewals",
    name: "Renewal Tasks",
    description: "The outreach queue that keeps policies from lapsing at renewal.",
    folderNodeId: DEMO_INSURANCE_FOLDER_NODE_ID,
    useCases: ["insurance"],
    fields: renewalFields,
  },
];

// ── Records ──────────────────────────────────────────────────────────────────

const FLEET_AUTO_BASE_FIELDS = withComputedCommission({
  client: [INSURANCE_CLIENT_FLEET_MANAGER_ID],
  commission_rate: 12,
  effective_date: "2025-12-01",
  insurer: "Northwind Casualty",
  notes:
    "18 vans, two at-fault claims last year. Carrier signalled a rate increase at renewal; re-quote before proposing.",
  policy_number: "POL-AUTO-2025-0914",
  policy_file: [
    {
      id: "att_seed_ins_policy_fleet",
      attachmentId: "att_seed_ins_policy_fleet",
      fileName: "fleet-auto-policy-2025.pdf",
      mimeType: "application/pdf",
      size: 512_000,
      url: "/assets/readme/scenarios/finance-review-record.png",
    },
  ],
  premium: 41200,
  product: "Commercial Fleet Auto",
  product_line: "auto",
  renewal_date: "2026-12-01",
  status: "active",
  sum_insured: 900000,
});

const FLEET_AUTO_REQUOTE_FIELDS = withComputedCommission({
  ...FLEET_AUTO_BASE_FIELDS,
  commission_rate: 11,
  notes:
    "Re-quoted across three carriers after the loss-run review. Northwind held the risk at +9% instead of the +23% first indicated, with a higher deductible on the two claim vehicles.",
  premium: 44900,
  status: "underwriting",
});

const INSURANCE_RECORDS: SeedRecordDef[] = [
  {
    id: INSURANCE_CLIENT_NEW_PARENTS_ID,
    baseId: DEMO_INSURANCE_CLIENTS_BASE_ID,
    commitId: INSURANCE_CLIENT_NEW_PARENTS_COMMIT_ID,
    fields: {
      advisor: "dana.reyes@busabase.local",
      ai_summary:
        "New parents with a mortgage and a single income — term life plus critical illness is the right first layer.",
      annual_budget: 3600,
      client_name: "Maya & Theo Brandt",
      email: "maya.brandt@example.com",
      next_follow_up: "2026-09-15",
      notes:
        "First child born in March. Mortgage runs 22 more years and Theo is the only earner right now. Wants the cheapest structure that covers the mortgage plus five years of living costs.",
      phone: "+1-415-555-0142",
      policies: [INSURANCE_POLICY_TERM_LIFE_ID, INSURANCE_POLICY_CRITICAL_ILLNESS_ID],
      protection_focus: ["life", "health"],
      source: "referral",
      stage: "insured",
    },
    message: "Seed insured household — term life plus critical illness",
    author: "seed-insurance",
    minutesAgo: 210,
    useCases: ["insurance"],
  },
  {
    id: INSURANCE_CLIENT_BUSINESS_OWNER_ID,
    baseId: DEMO_INSURANCE_CLIENTS_BASE_ID,
    commitId: INSURANCE_CLIENT_BUSINESS_OWNER_COMMIT_ID,
    fields: {
      advisor: "dana.reyes@busabase.local",
      ai_summary:
        "Owner-operator whose bank requires key-person cover before the expansion loan closes.",
      annual_budget: 12000,
      client_name: "Priya Raman (Raman Bakehouse)",
      email: "priya@ramanbakehouse.example.com",
      next_follow_up: "2026-09-17",
      notes:
        "Bank wants key-person cover in place before the second-location loan closes. Also asked about group health for nine staff — separate conversation, do not bundle into this proposal.",
      phone: "+1-206-555-0188",
      policies: [INSURANCE_POLICY_KEYMAN_ID],
      protection_focus: ["life", "property"],
      source: "community",
      stage: "insured",
    },
    message: "Seed SME owner with key-person cover",
    author: "seed-insurance",
    minutesAgo: 205,
    useCases: ["insurance"],
  },
  {
    id: INSURANCE_CLIENT_FLEET_MANAGER_ID,
    baseId: DEMO_INSURANCE_CLIENTS_BASE_ID,
    commitId: INSURANCE_CLIENT_FLEET_MANAGER_COMMIT_ID,
    fields: {
      advisor: "marco.silva@busabase.local",
      ai_summary:
        "Fleet account facing a rate increase at renewal — the re-quote decides whether it stays.",
      annual_budget: 48000,
      client_name: "Harborline Logistics",
      email: "ops@harborline.example.com",
      next_follow_up: "2026-09-14",
      notes:
        "Largest account by premium. Two at-fault claims last year, so the carrier flagged a rate increase. They will shop the market if we bring back anything above +10%.",
      phone: "+1-312-555-0110",
      policies: [INSURANCE_POLICY_FLEET_AUTO_ID],
      protection_focus: ["auto", "property"],
      source: "referral",
      stage: "insured",
    },
    message: "Seed fleet account up for renewal",
    author: "seed-insurance",
    minutesAgo: 200,
    useCases: ["insurance"],
  },
  {
    id: INSURANCE_CLIENT_PRE_RETIREE_ID,
    baseId: DEMO_INSURANCE_CLIENTS_BASE_ID,
    commitId: INSURANCE_CLIENT_PRE_RETIREE_COMMIT_ID,
    fields: {
      advisor: "marco.silva@busabase.local",
      ai_summary:
        "Pre-retiree comparing a senior health plan against an annuity — proposal is out, decision pending.",
      annual_budget: 7800,
      client_name: "Gerald Okonkwo",
      email: "g.okonkwo@example.com",
      next_follow_up: "2026-09-16",
      notes:
        "Retires in 14 months. Comparing our senior health plan against an annuity his bank pitched. Price-sensitive on the rider, not on the base plan.",
      phone: "+1-617-555-0164",
      policies: [INSURANCE_POLICY_SENIOR_HEALTH_ID],
      protection_focus: ["health", "retirement"],
      source: "orphan-book",
      stage: "proposal",
    },
    message: "Seed pre-retiree with an open proposal",
    author: "seed-insurance",
    minutesAgo: 195,
    useCases: ["insurance"],
  },
  {
    id: INSURANCE_CLIENT_EXPAT_ID,
    baseId: DEMO_INSURANCE_CLIENTS_BASE_ID,
    commitId: INSURANCE_CLIENT_EXPAT_COMMIT_ID,
    fields: {
      advisor: "dana.reyes@busabase.local",
      ai_summary:
        "Frequent traveller on an annual multi-trip plan; health top-up is the next step.",
      annual_budget: 2400,
      client_name: "Lina Fontaine",
      email: "lina.fontaine@example.com",
      next_follow_up: "2026-09-28",
      notes:
        "Travels 9 months a year for work. Annual multi-trip plan renewed without issue. Open to an international health top-up once the new contract is signed.",
      phone: "+33-1-55-55-0177",
      policies: [INSURANCE_POLICY_TRAVEL_ID],
      protection_focus: ["travel", "health"],
      source: "social",
      stage: "needs-analysis",
    },
    message: "Seed frequent-traveller client",
    author: "seed-insurance",
    minutesAgo: 190,
    useCases: ["insurance"],
  },
  {
    id: INSURANCE_CLIENT_FAMILY_OFFICE_ID,
    baseId: DEMO_INSURANCE_CLIENTS_BASE_ID,
    commitId: INSURANCE_CLIENT_FAMILY_OFFICE_COMMIT_ID,
    fields: {
      advisor: "dana.reyes@busabase.local",
      ai_summary:
        "Family office funding a large estate-tax liability through universal life — coordinated with outside counsel, not a standalone sale.",
      annual_budget: 150000,
      client_name: "Elliot Kessler (Kessler Family Office)",
      email: "elliot.kessler@kesslerfo.example.com",
      next_follow_up: "2026-09-19",
      notes:
        "Multi-generational family office restructuring the estate plan ahead of a liquidity event. The universal life policy funds the estate tax liability without forcing a sale of the operating business. Coordinating with their outside counsel on the ILIT structure.",
      phone: "+1-212-555-0199",
      policies: [INSURANCE_POLICY_ESTATE_UL_ID],
      protection_focus: ["life", "property", "retirement"],
      source: "referral",
      stage: "insured",
    },
    message: "Seed family office with estate-planning cover",
    author: "seed-insurance",
    minutesAgo: 188,
    useCases: ["insurance"],
  },
  {
    id: INSURANCE_CLIENT_CORPORATE_GROUP_ID,
    baseId: DEMO_INSURANCE_CLIENTS_BASE_ID,
    commitId: INSURANCE_CLIENT_CORPORATE_GROUP_COMMIT_ID,
    fields: {
      advisor: "marco.silva@busabase.local",
      ai_summary:
        "Fast-growing group account — renewal timing lines up with headcount growth, so the AD&D face amount needs to move too.",
      annual_budget: 210000,
      client_name: "Vantage Robotics (People Team)",
      email: "benefits@vantagerobotics.example.com",
      next_follow_up: "2026-09-20",
      notes:
        "Series C robotics company, 128 employees after the fall hiring push. Group term life and AD&D renews every October; the People team wants a wellness rider quoted alongside this year's renewal.",
      phone: "+1-650-555-0173",
      policies: [INSURANCE_POLICY_GROUP_TERM_ID],
      protection_focus: ["life", "health"],
      source: "referral",
      stage: "insured",
    },
    message: "Seed corporate group benefits account",
    author: "seed-insurance",
    minutesAgo: 187,
    useCases: ["insurance"],
  },

  {
    id: INSURANCE_POLICY_TERM_LIFE_ID,
    baseId: DEMO_INSURANCE_POLICIES_BASE_ID,
    commitId: INSURANCE_POLICY_TERM_LIFE_COMMIT_ID,
    fields: withComputedCommission({
      client: [INSURANCE_CLIENT_NEW_PARENTS_ID],
      commission_rate: 35,
      effective_date: "2026-04-15",
      insurer: "Meridian Life",
      notes: "Standard non-smoker rates. Medical exam waived on the simplified issue track.",
      policy_number: "POL-LIFE-2026-0415",
      premium: 1180,
      product: "20-Year Term Life",
      product_line: "life",
      renewal_date: "2027-04-15",
      status: "active",
      sum_insured: 750000,
    }),
    message: "Seed term life policy in force",
    author: "seed-insurance",
    minutesAgo: 185,
    useCases: ["insurance"],
  },
  {
    id: INSURANCE_POLICY_CRITICAL_ILLNESS_ID,
    baseId: DEMO_INSURANCE_POLICIES_BASE_ID,
    commitId: INSURANCE_POLICY_CRITICAL_ILLNESS_COMMIT_ID,
    fields: withComputedCommission({
      client: [INSURANCE_CLIENT_NEW_PARENTS_ID],
      commission_rate: 28,
      effective_date: "2026-04-15",
      insurer: "Meridian Life",
      notes: "Covers 32 conditions with a 90-day waiting period. Rider on the term life policy.",
      policy_number: "POL-CI-2026-0415",
      premium: 940,
      product: "Critical Illness Rider",
      product_line: "health",
      renewal_date: "2027-04-15",
      status: "active",
      sum_insured: 120000,
    }),
    message: "Seed critical illness rider",
    author: "seed-insurance",
    minutesAgo: 184,
    useCases: ["insurance"],
  },
  {
    id: INSURANCE_POLICY_KEYMAN_ID,
    baseId: DEMO_INSURANCE_POLICIES_BASE_ID,
    commitId: INSURANCE_POLICY_KEYMAN_COMMIT_ID,
    fields: withComputedCommission({
      client: [INSURANCE_CLIENT_BUSINESS_OWNER_ID],
      commission_rate: 22,
      effective_date: "2026-02-01",
      insurer: "Cascade Mutual",
      notes:
        "Bank is the assignee until the expansion loan is repaid. Assignment letter is on file in the Drive.",
      policy_number: "POL-KEY-2026-0201",
      premium: 5400,
      product: "Key Person Life",
      product_line: "life",
      renewal_date: "2027-02-01",
      status: "active",
      sum_insured: 1000000,
    }),
    message: "Seed key-person policy",
    author: "seed-insurance",
    minutesAgo: 183,
    useCases: ["insurance"],
  },
  {
    id: INSURANCE_POLICY_FLEET_AUTO_ID,
    baseId: DEMO_INSURANCE_POLICIES_BASE_ID,
    commitId: INSURANCE_POLICY_FLEET_AUTO_COMMIT_ID,
    fields: FLEET_AUTO_BASE_FIELDS,
    message: "Seed commercial fleet policy up for renewal",
    author: "seed-insurance",
    minutesAgo: 182,
    useCases: ["insurance"],
  },
  {
    id: INSURANCE_POLICY_SENIOR_HEALTH_ID,
    baseId: DEMO_INSURANCE_POLICIES_BASE_ID,
    commitId: INSURANCE_POLICY_SENIOR_HEALTH_COMMIT_ID,
    fields: withComputedCommission({
      client: [INSURANCE_CLIENT_PRE_RETIREE_ID],
      commission_rate: 18,
      effective_date: "2026-09-20",
      insurer: "Cascade Mutual",
      notes:
        "Quoted with and without the dental rider. Underwriting asked for a follow-up on the 2024 cardiology referral.",
      policy_number: "POL-HLTH-2026-0620",
      premium: 6200,
      product: "Senior Health Plan",
      product_line: "health",
      renewal_date: "2027-09-20",
      status: "quoting",
      sum_insured: 250000,
    }),
    message: "Seed senior health quote awaiting decision",
    author: "seed-insurance",
    minutesAgo: 181,
    useCases: ["insurance"],
  },
  {
    id: INSURANCE_POLICY_TRAVEL_ID,
    baseId: DEMO_INSURANCE_POLICIES_BASE_ID,
    commitId: INSURANCE_POLICY_TRAVEL_COMMIT_ID,
    fields: withComputedCommission({
      client: [INSURANCE_CLIENT_EXPAT_ID],
      commission_rate: 15,
      effective_date: "2026-05-05",
      insurer: "Northwind Casualty",
      notes: "Annual multi-trip, 90 days max per trip, winter-sports rider included.",
      policy_number: "POL-TRV-2026-0505",
      premium: 780,
      product: "Annual Multi-Trip Travel",
      product_line: "travel",
      renewal_date: "2027-05-05",
      status: "renewed",
      sum_insured: 200000,
    }),
    message: "Seed renewed travel policy",
    author: "seed-insurance",
    minutesAgo: 180,
    useCases: ["insurance"],
  },
  {
    id: INSURANCE_POLICY_ESTATE_UL_ID,
    baseId: DEMO_INSURANCE_POLICIES_BASE_ID,
    commitId: INSURANCE_POLICY_ESTATE_UL_COMMIT_ID,
    fields: withComputedCommission({
      client: [INSURANCE_CLIENT_FAMILY_OFFICE_ID],
      commission_rate: 6,
      effective_date: "2026-03-01",
      insurer: "Sovereign Trust Life",
      notes:
        "Indexed UL funding the estate tax liability. Annual review timed to the family office's own audit cycle, not a standard renewal conversation.",
      policy_number: "POL-UL-2026-0301",
      premium: 92000,
      product: "Estate Protection Universal Life",
      product_line: "life",
      renewal_date: "2027-03-01",
      status: "active",
      sum_insured: 10000000,
    }),
    message: "Seed estate-planning universal life policy",
    author: "seed-insurance",
    minutesAgo: 179,
    useCases: ["insurance"],
  },
  {
    id: INSURANCE_POLICY_GROUP_TERM_ID,
    baseId: DEMO_INSURANCE_POLICIES_BASE_ID,
    commitId: INSURANCE_POLICY_GROUP_TERM_COMMIT_ID,
    fields: withComputedCommission({
      client: [INSURANCE_CLIENT_CORPORATE_GROUP_ID],
      commission_rate: 5,
      effective_date: "2025-10-01",
      insurer: "Continental Group Benefits",
      notes:
        "Face amount is a per-employee salary multiple, so headcount growth alone can move the total sum insured materially. Reconcile the census before quoting the October renewal.",
      policy_number: "POL-GRP-2025-1001",
      premium: 148000,
      product: "Group Term Life & AD&D (128 lives)",
      product_line: "life",
      renewal_date: "2026-10-01",
      status: "active",
      sum_insured: 64000000,
    }),
    message: "Seed corporate group term life & AD&D policy",
    author: "seed-insurance",
    minutesAgo: 178,
    useCases: ["insurance"],
  },

  {
    id: INSURANCE_RENEWAL_FLEET_ID,
    baseId: DEMO_INSURANCE_RENEWALS_BASE_ID,
    commitId: INSURANCE_RENEWAL_FLEET_COMMIT_ID,
    fields: {
      channel: "call",
      due_date: "2026-10-10",
      outcome:
        "Loss runs pulled and sent to three carriers. Waiting on the final Northwind indication before booking the renewal meeting.",
      owner: "marco.silva@busabase.local",
      policy: [INSURANCE_POLICY_FLEET_AUTO_ID],
      status: "in-progress",
      task: "Re-quote the Harborline fleet before renewal",
    },
    message: "Seed in-progress fleet renewal task",
    author: "seed-insurance",
    minutesAgo: 96,
    useCases: ["insurance"],
  },
  {
    id: INSURANCE_RENEWAL_SENIOR_HEALTH_ID,
    baseId: DEMO_INSURANCE_RENEWALS_BASE_ID,
    commitId: INSURANCE_RENEWAL_SENIOR_HEALTH_COMMIT_ID,
    fields: {
      channel: "in-person",
      due_date: "2026-09-18",
      outcome: "",
      owner: "marco.silva@busabase.local",
      policy: [INSURANCE_POLICY_SENIOR_HEALTH_ID],
      status: "todo",
      task: "Walk Gerald through the plan-vs-annuity comparison",
    },
    message: "Seed pending proposal follow-up",
    author: "seed-insurance",
    minutesAgo: 94,
    useCases: ["insurance"],
  },
  {
    id: INSURANCE_RENEWAL_TRAVEL_ID,
    baseId: DEMO_INSURANCE_RENEWALS_BASE_ID,
    commitId: INSURANCE_RENEWAL_TRAVEL_COMMIT_ID,
    fields: {
      channel: "message",
      due_date: "2026-08-02",
      outcome:
        "Renewed at the same premium. Health top-up parked until her new contract is signed.",
      owner: "dana.reyes@busabase.local",
      policy: [INSURANCE_POLICY_TRAVEL_ID],
      status: "done",
      task: "Confirm the annual travel renewal",
    },
    message: "Seed completed travel renewal",
    author: "seed-insurance",
    minutesAgo: 92,
    useCases: ["insurance"],
  },
  {
    id: INSURANCE_RENEWAL_KEYMAN_ID,
    baseId: DEMO_INSURANCE_RENEWALS_BASE_ID,
    commitId: INSURANCE_RENEWAL_KEYMAN_COMMIT_ID,
    fields: {
      channel: "email",
      due_date: "2026-11-20",
      outcome:
        "Deferred until the bank confirms the loan balance — the assignment amount depends on it.",
      owner: "dana.reyes@busabase.local",
      policy: [INSURANCE_POLICY_KEYMAN_ID],
      status: "deferred",
      task: "Review the key-person sum insured against the loan balance",
    },
    message: "Seed deferred key-person review",
    author: "seed-insurance",
    minutesAgo: 90,
    useCases: ["insurance"],
  },
  {
    id: INSURANCE_RENEWAL_ESTATE_ID,
    baseId: DEMO_INSURANCE_RENEWALS_BASE_ID,
    commitId: INSURANCE_RENEWAL_ESTATE_COMMIT_ID,
    fields: {
      channel: "in-person",
      due_date: "2026-11-15",
      outcome: "",
      owner: "dana.reyes@busabase.local",
      policy: [INSURANCE_POLICY_ESTATE_UL_ID],
      status: "todo",
      task: "Coordinate the estate policy review with the family office's outside counsel",
    },
    message: "Seed pending estate policy review",
    author: "seed-insurance",
    minutesAgo: 88,
    useCases: ["insurance"],
  },
  {
    id: INSURANCE_RENEWAL_GROUP_ID,
    baseId: DEMO_INSURANCE_RENEWALS_BASE_ID,
    commitId: INSURANCE_RENEWAL_GROUP_COMMIT_ID,
    fields: {
      channel: "email",
      due_date: "2026-09-30",
      outcome:
        "Sent the census template to their People team; waiting on the updated employee list before quoting the AD&D face amount.",
      owner: "marco.silva@busabase.local",
      policy: [INSURANCE_POLICY_GROUP_TERM_ID],
      status: "in-progress",
      task: "Reconcile the Vantage Robotics census before the October renewal",
    },
    message: "Seed in-progress group census reconciliation",
    author: "seed-insurance",
    minutesAgo: 86,
    useCases: ["insurance"],
  },
];

// ── Views ────────────────────────────────────────────────────────────────────

const INSURANCE_VIEWS: SeedViewDef[] = [
  {
    id: "viw_seed_ins_client_pipeline",
    baseId: DEMO_INSURANCE_CLIENTS_BASE_ID,
    slug: "pipeline",
    name: "Pipeline",
    description: "Every client stacked by where they are between first contact and insured.",
    type: "kanban",
    config: { filters: [], sorts: [], stackByFieldSlug: "stage" },
    minutesAgo: 175,
    useCases: ["insurance"],
  },
  {
    id: "viw_seed_ins_client_follow_ups",
    baseId: DEMO_INSURANCE_CLIENTS_BASE_ID,
    slug: "follow-ups",
    name: "Follow-up calendar",
    description: "Clients placed on the day they are due for their next conversation.",
    type: "calendar",
    config: { filters: [], sorts: [], dateFieldSlug: "next_follow_up" },
    minutesAgo: 174,
    useCases: ["insurance"],
  },
  {
    id: "viw_seed_ins_client_open_proposals",
    baseId: DEMO_INSURANCE_CLIENTS_BASE_ID,
    slug: "open-proposals",
    name: "Open proposals",
    description:
      "Clients with a proposal out and no decision yet — the queue that goes stale first.",
    config: {
      filters: [{ fieldSlug: "stage", operator: "equals", value: "proposal" }],
      sorts: [{ direction: "asc", fieldSlug: "next_follow_up" }],
      visibleFieldSlugs: [
        "client_name",
        "stage",
        "protection_focus",
        "annual_budget",
        "next_follow_up",
        "advisor",
      ],
    },
    minutesAgo: 173,
    useCases: ["insurance"],
  },
  {
    id: "viw_seed_ins_policy_board",
    baseId: DEMO_INSURANCE_POLICIES_BASE_ID,
    slug: "board",
    name: "Policy board",
    description: "Policies stacked by status, from first quote to renewed.",
    type: "kanban",
    config: { filters: [], sorts: [], stackByFieldSlug: "status" },
    minutesAgo: 172,
    useCases: ["insurance"],
  },
  {
    id: "viw_seed_ins_policy_renewals_due",
    baseId: DEMO_INSURANCE_POLICIES_BASE_ID,
    slug: "renewals-due",
    name: "Renewals due",
    description: "Active policies sorted by renewal date — the advisor's working list.",
    config: {
      filters: [{ fieldSlug: "status", operator: "equals", value: "active" }],
      sorts: [{ direction: "asc", fieldSlug: "renewal_date" }],
      visibleFieldSlugs: [
        "policy_number",
        "client",
        "product",
        "premium",
        "commission_amount",
        "renewal_date",
        "status",
      ],
    },
    minutesAgo: 171,
    useCases: ["insurance"],
  },
  {
    id: "viw_seed_ins_policy_coverage_timeline",
    baseId: DEMO_INSURANCE_POLICIES_BASE_ID,
    slug: "coverage-timeline",
    name: "Coverage timeline",
    description: "Each policy drawn from its effective date to its renewal date.",
    type: "gantt",
    config: {
      filters: [],
      sorts: [],
      startFieldSlug: "effective_date",
      endFieldSlug: "renewal_date",
      ganttScale: "month",
    },
    minutesAgo: 170,
    useCases: ["insurance"],
  },
  {
    id: "viw_seed_ins_renewal_board",
    baseId: DEMO_INSURANCE_RENEWALS_BASE_ID,
    slug: "board",
    name: "Renewal board",
    description: "The outreach queue stacked by status.",
    type: "kanban",
    config: { filters: [], sorts: [], stackByFieldSlug: "status" },
    minutesAgo: 169,
    useCases: ["insurance"],
  },
];

// ── Change requests ──────────────────────────────────────────────────────────

const INSURANCE_CHANGE_REQUESTS: SeedChangeRequestDef[] = [
  {
    id: INSURANCE_REQUOTE_CR_ID,
    baseId: DEMO_INSURANCE_POLICIES_BASE_ID,
    status: "in_review",
    submittedBy: "renewal-assistant-agent",
    sourceMeta: {
      seed: true,
      scenario: "fleet-renewal-requote",
      workflow: "renewal-review",
    },
    minutesAgo: 8,
    useCases: ["insurance"],
    operations: [
      {
        id: "opr_seed_ins_fleet_requote",
        commitId: "cmt_seed_ins_fleet_requote",
        operation: "record_update",
        targetRecordId: INSURANCE_POLICY_FLEET_AUTO_ID,
        baseCommitId: INSURANCE_POLICY_FLEET_AUTO_COMMIT_ID,
        baseFields: FLEET_AUTO_BASE_FIELDS,
        fields: FLEET_AUTO_REQUOTE_FIELDS,
        message: "Re-quoted fleet renewal at +9% with a higher deductible on two vehicles",
        author: "renewal-assistant-agent",
      },
    ],
  },
  {
    id: INSURANCE_INTAKE_CR_ID,
    baseId: DEMO_INSURANCE_CLIENTS_BASE_ID,
    status: "in_review",
    submittedBy: "intake-form",
    sourceMeta: {
      seed: true,
      scenario: "consultation-form-intake",
      workflow: "lead-intake",
      provenance: { channel: "web_ui", owner: { id: "local-admin", image: null, name: "Kelly" } },
    },
    minutesAgo: 21,
    useCases: ["insurance"],
    operations: [
      {
        id: "opr_seed_ins_client_intake",
        commitId: "cmt_seed_ins_client_intake",
        operation: "record_create",
        fields: {
          advisor: "",
          annual_budget: 2000,
          client_name: "Owen Castellanos",
          email: "owen.c@example.com",
          next_follow_up: "2026-09-22",
          notes:
            "Submitted through the consultation form: newly self-employed, lost group health when he left his job, wants a health plan plus income protection.",
          phone: "+1-503-555-0129",
          protection_focus: ["health", "life"],
          source: "social",
          stage: "lead",
        },
        message: "New consultation request from the public form",
        author: "intake-form",
      },
    ],
  },
];

// ── Docs ─────────────────────────────────────────────────────────────────────

const ADVISOR_PLAYBOOK_BODY = `# Advisor Playbook

How this agency runs a client from first contact to a policy that stays in force.

## 1. Needs analysis before product

Never open with a product. Establish the income, the debt, the dependents, and the
existing cover first, then show the gap. A proposal that does not name the gap it
closes gets compared on price alone.

## 2. Propose two options, not five

One option reads like a sales pitch; five reads like homework. Bring the
recommended structure and one cheaper alternative, and say plainly what the
cheaper one gives up.

## 3. Renewals start 90 days out

A renewal reached in the last week is a price negotiation. A renewal reached at
90 days is a review — the only point where an advisor can still change the risk,
the deductible, or the carrier.

## 4. Everything goes through review

Premium changes, sum-insured changes, and carrier switches are proposed as change
requests, not edited in place. The client's file has to show who changed what and
why, because a year from now that is the only defence against "I never agreed to
this".
`;

const INSURANCE_DOCS: SeedDocDef[] = [
  {
    nodeId: INSURANCE_PLAYBOOK_DOC_NODE_ID,
    slug: "advisor-playbook",
    name: "Advisor Playbook",
    description: "How the agency runs a client from first contact to a policy that stays in force.",
    position: 3,
    body: ADVISOR_PLAYBOOK_BODY,
    changeRequest: {
      id: INSURANCE_PLAYBOOK_CR_ID,
      operationId: "opr_seed_ins_doc_playbook",
      commitId: "cmt_seed_ins_doc_playbook",
      submittedBy: "renewal-assistant-agent",
      minutesAgo: 12,
      message: "Add a lapse-recovery section to the Advisor Playbook",
      nextBody: `${ADVISOR_PLAYBOOK_BODY}
## 5. Lapse recovery

A lapsed policy is not a lost client. Reach out within 30 days, lead with what the
lapse actually costs them (reinstatement underwriting, a new waiting period), and
propose the smallest change that makes the premium sustainable — a lower sum
insured beats no cover at all.
`,
    },
  },
  {
    nodeId: INSURANCE_PRODUCT_MATRIX_DOC_NODE_ID,
    slug: "product-matrix",
    name: "Product Matrix",
    description: "Which carrier to lead with per product line, and where each one is weak.",
    position: 4,
    body: `# Product Matrix

Which carrier to lead with per line, and the honest caveat for each.

## Life

- **Meridian Life** — fastest simplified-issue track, medical exam waived under $1M. Weak on substandard ratings.
- **Cascade Mutual** — best for key-person and assignment cases; slower underwriting (10-15 business days).

## Health

- **Cascade Mutual** — broad network, strong senior plans. Dental rider is priced above market.
- **Meridian Life** — competitive critical-illness riders when written alongside term life.

## Auto & Property

- **Northwind Casualty** — the only carrier here that writes commercial fleets under 25 vehicles. Rate increases after at-fault claims are steep; always pull loss runs before renewal.

## Travel

- **Northwind Casualty** — annual multi-trip with a winter-sports rider included, 90-day trip cap.

## Estate & wealth transfer

- **Sovereign Trust Life** — the only carrier here comfortable underwriting eight-figure
  sums insured for a family office without a syndication. Slow to issue (20+ business days)
  but the illustration desk will work directly with outside counsel on ILIT structuring.

## Group benefits

- **Continental Group Benefits** — the group term life and AD&D carrier for anything
  from 25 to a few hundred lives. Renewal pricing is census-driven, so a stale headcount
  is the single most common reason a group quote comes back wrong.

Keep this doc current through change requests — a stale matrix is how a client
ends up quoted with the wrong carrier.
`,
  },
];

// ── Files ────────────────────────────────────────────────────────────────────

const INSURANCE_FILES: SeedFileDef[] = [
  {
    nodeId: INSURANCE_COMMISSION_FILE_NODE_ID,
    slug: "commission-ledger",
    name: "Commission Ledger",
    description: "A CSV File node — what each placed policy actually paid out.",
    fileName: "commission-ledger.csv",
    mimeType: "text/csv",
    attachmentId: "att_seed_ins_commission_ledger",
    assetId: "ast_seed_ins_commission_ledger",
    storageKey: "attachments/blobs/seed/commission-ledger.csv",
    position: 3,
    body: `policy_number,product_line,premium,commission_rate,commission,paid_on
POL-LIFE-2026-0415,life,1180,35,413.00,2026-05-01
POL-CI-2026-0415,health,940,28,263.20,2026-05-01
POL-KEY-2026-0201,life,5400,22,1188.00,2026-03-01
POL-AUTO-2025-0914,auto,41200,12,4944.00,2025-12-15
POL-TRV-2026-0505,travel,780,15,117.00,2026-06-01
`,
  },
  {
    nodeId: INSURANCE_UNDERWRITING_FILE_NODE_ID,
    slug: "underwriting-rules",
    name: "Underwriting Cheat Sheet",
    description:
      "A JSON File node — the thresholds that decide what needs a medical or a referral.",
    fileName: "underwriting-rules.json",
    mimeType: "application/json",
    attachmentId: "att_seed_ins_underwriting_rules",
    assetId: "ast_seed_ins_underwriting_rules",
    storageKey: "attachments/blobs/seed/underwriting-rules.json",
    position: 4,
    body: `{
  "life": {
    "medicalExamRequiredAbove": 1000000,
    "simplifiedIssueMaxAge": 50,
    "smokerLoading": "1.6x"
  },
  "health": {
    "waitingPeriodDays": 90,
    "referralTriggers": ["cardiology", "oncology", "bariatric"]
  },
  "auto": {
    "fleetMinVehicles": 5,
    "lossRunsRequired": true,
    "atFaultClaimsBeforeReferral": 2
  }
}
`,
  },
];

// ── Skill + Drive + AirApp (file-tree nodes) ─────────────────────────────────

const RENEWAL_ASSISTANT_SKILL_MD = `---
name: policy-renewal-assistant
description: Prepares a renewal recommendation for a policy and proposes it for advisor review.
---

# Policy Renewal Assistant

Use this skill when a policy in the Policies Base is inside 90 days of its
renewal date and needs a recommendation before the advisor calls the client.

## Workflow

1. Read the policy record: premium, sum insured, status, and underwriting notes.
2. Read the client record it links to — budget, protection focus, and advisor notes.
3. Check the Product Matrix Doc for the leading carrier on that product line.
4. Propose the renewal as a change request: the new premium, the reason, and what
   the client gives up if they take a cheaper structure.

## Rules

- Never change a premium or sum insured without a stated reason in the change request.
- If the increase is above 10%, re-quote at least two other carriers first.
- Always leave the advisor a one-line script for the call.
`;

export const RENEWAL_BOARD_PACKAGE_JSON = `${JSON.stringify(
  {
    name: "insurance-renewal-board",
    private: true,
    version: "0.1.0",
    type: "module",
    scripts: { dev: "node server.js" },
  },
  null,
  2,
)}\n`;

// The same dependency-free static-file server the Pure HTML / Deal Pipeline
// AirApp demos use: the fetch to Busabase's own REST API happens client-side,
// so the app needs no credentials of its own and no build step.
export const RENEWAL_BOARD_SERVER_JS = `import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { extname } from "node:path";

const contentTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
};

const server = createServer((req, res) => {
  const path = req.url === "/" ? "/index.html" : req.url;
  try {
    const body = readFileSync(\`.\${path}\`);
    res.writeHead(200, {
      "Content-Type": contentTypes[extname(path)] || "application/octet-stream",
    });
    res.end(body);
  } catch {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Not found");
  }
});
// Nodepod's in-browser Node does not bind \`this\` to the server in the listen
// callback, so \`this.address()\` throws and the dev server exits before it ever
// listens. Close over the port instead.
const port = Number(process.env.PORT) || 3000;
server.listen(port, () => {
  console.log(\`Renewal Board listening on port \${port}\`);
});
`;

export const RENEWAL_BOARD_STYLE_CSS = `:root { color-scheme: light; }

body {
  margin: 0;
  min-height: 100vh;
  font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
  background: #f8fafc;
  color: #0f172a;
}

header {
  padding: 1.5rem 2rem 1rem;
  border-bottom: 1px solid #e2e8f0;
  background: white;
}

header .badge {
  display: inline-block;
  padding: 0.2rem 0.6rem;
  border-radius: 999px;
  background: #ecfdf5;
  color: #047857;
  font-size: 0.7rem;
  font-weight: 700;
  letter-spacing: 0.05em;
  text-transform: uppercase;
}

header h1 { margin: 0.5rem 0 0.25rem; font-size: 1.4rem; }
header p { margin: 0; color: #64748b; font-size: 0.85rem; }

.stats {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(11rem, 1fr));
  gap: 1rem;
  padding: 1.25rem 2rem 0;
}

.stat {
  background: white;
  border: 1px solid #e2e8f0;
  border-radius: 0.75rem;
  padding: 0.9rem 1.1rem;
}

.stat .label {
  font-size: 0.72rem;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: #64748b;
}

.stat .value {
  font-size: 1.35rem;
  font-weight: 700;
  color: #0f172a;
  margin-top: 0.15rem;
}

#board {
  display: grid;
  grid-auto-flow: column;
  grid-auto-columns: minmax(15rem, 1fr);
  gap: 1rem;
  padding: 1.5rem 2rem;
  align-items: start;
}

.column {
  background: #f1f5f9;
  border-radius: 0.75rem;
  padding: 0.75rem;
}

.column h2 {
  font-size: 0.8rem;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  margin: 0.25rem 0.5rem 0.75rem;
  display: flex;
  justify-content: space-between;
  color: #475569;
}

.column .total { font-weight: 700; color: #0f172a; }

.item {
  background: white;
  border-radius: 0.5rem;
  padding: 0.75rem;
  margin-bottom: 0.5rem;
  box-shadow: 0 1px 2px rgba(15, 23, 42, 0.06);
  font-size: 0.85rem;
}

.item .name { font-weight: 600; margin-bottom: 0.25rem; }
.item .meta { color: #64748b; font-size: 0.78rem; }
.item.soon { border-left: 3px solid #d97706; }

#empty {
  margin: 2rem;
  padding: 1.5rem;
  border: 1px dashed #cbd5e1;
  border-radius: 0.75rem;
  color: #64748b;
  font-size: 0.9rem;
  max-width: 32rem;
}

/* Shared across every insurance AirApp (Agent Desk, Agency Scoreboard, Issuance
   Desk) so the four dashboards read as one product, not four demos glued together. */

.kicker {
  margin: 2rem 2rem 0.6rem;
  font-size: 0.72rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: #64748b;
}

.panel {
  margin: 0 2rem 1.5rem;
  background: white;
  border: 1px solid #e2e8f0;
  border-radius: 0.75rem;
  padding: 1.1rem 1.4rem;
}

.bar-row {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.45rem 0;
  font-size: 0.85rem;
}

.bar-row .bar-label {
  width: 9rem;
  flex-shrink: 0;
  color: #334155;
}

.bar-row .bar-track {
  flex: 1;
  height: 0.55rem;
  background: #f1f5f9;
  border-radius: 999px;
  overflow: hidden;
}

.bar-row .bar-fill {
  height: 100%;
  border-radius: 999px;
  background: #059669;
}

.bar-row .bar-value {
  width: 7rem;
  flex-shrink: 0;
  text-align: right;
  font-weight: 600;
  color: #0f172a;
}

table.data-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.85rem;
}

table.data-table th,
table.data-table td {
  text-align: left;
  padding: 0.55rem 0.6rem;
  border-bottom: 1px solid #e2e8f0;
}

table.data-table th {
  color: #64748b;
  font-weight: 600;
  font-size: 0.72rem;
  text-transform: uppercase;
  letter-spacing: 0.03em;
}

.rank {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 1.5rem;
  height: 1.5rem;
  border-radius: 999px;
  background: #f1f5f9;
  font-weight: 700;
  font-size: 0.75rem;
  color: #334155;
  margin-right: 0.5rem;
}

.pill {
  display: inline-block;
  padding: 0.15rem 0.55rem;
  border-radius: 999px;
  font-size: 0.72rem;
  font-weight: 600;
  white-space: nowrap;
}

.pill.due-soon { background: #fef3c7; color: #92400e; }
.pill.overdue { background: #fee2e2; color: #b91c1c; }
.pill.ok { background: #ecfdf5; color: #047857; }
.pill.missing { background: #fee2e2; color: #b91c1c; }

.queue-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 1rem;
  padding: 0.65rem 0;
  border-bottom: 1px solid #f1f5f9;
  font-size: 0.85rem;
}

.queue-item:last-child { border-bottom: none; }

.queue-item .name { font-weight: 600; color: #0f172a; }
.queue-item .meta { color: #64748b; font-size: 0.78rem; margin-top: 0.1rem; }
`;

const RENEWAL_BOARD_INDEX_HTML = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Renewal Board</title>
    <link rel="stylesheet" href="style.css" />
  </head>
  <body>
    <header>
      <span class="badge">AirApp · Live workspace data</span>
      <h1>Renewal Board</h1>
      <p>Reads this workspace's own "insurance-policies" Base via the Busabase REST API — not seeded, not synthetic.</p>
    </header>
    <div id="stats" class="stats"></div>
    <div id="board"></div>
    <script src="client.js"></script>
  </body>
</html>
`;

const RENEWAL_BOARD_CLIENT_JS = `const STATUSES = [
  { id: "quoting", label: "Quoting" },
  { id: "underwriting", label: "Underwriting" },
  { id: "active", label: "Active" },
  { id: "renewed", label: "Renewed" },
  { id: "lapsed", label: "Lapsed" },
];

const board = document.getElementById("board");

function money(n) {
  return typeof n === "number" ? "$" + n.toLocaleString("en-US") : "—";
}

function daysUntil(dateString) {
  if (!dateString) return null;
  const target = new Date(dateString);
  if (Number.isNaN(target.getTime())) return null;
  return Math.round((target.getTime() - Date.now()) / 86400000);
}

function showEmpty(message) {
  document.getElementById("stats")?.remove();
  board.innerHTML = "";
  const div = document.createElement("div");
  div.id = "empty";
  div.textContent = message;
  board.replaceWith(div);
}

function renderStats(records) {
  const statsEl = document.getElementById("stats");
  if (!statsEl) return;

  const totalPremium = records.reduce((sum, r) => sum + (Number(r.headCommit?.payload?.premium) || 0), 0);
  const totalCommission = records.reduce(
    (sum, r) => sum + (Number(r.headCommit?.payload?.commission_amount) || 0),
    0,
  );
  const activeCount = records.filter((r) => r.headCommit?.payload?.status === "active").length;
  const dueSoonCount = records.filter((r) => {
    const remaining = daysUntil(r.headCommit?.payload?.renewal_date);
    return remaining !== null && remaining >= 0 && remaining <= 90;
  }).length;

  const tiles = [
    ["Premium in force", money(totalPremium)],
    ["Commission earned", money(totalCommission)],
    ["Active policies", String(activeCount)],
    ["Renewals due ≤ 90d", String(dueSoonCount)],
  ];

  statsEl.innerHTML = tiles
    .map(
      ([label, value]) =>
        '<div class="stat"><div class="label">' +
        label +
        '</div><div class="value">' +
        value +
        "</div></div>",
    )
    .join("");
}

async function loadPolicies() {
  const basesRes = await fetch("/api/v1/bases");
  if (!basesRes.ok) throw new Error("GET /api/v1/bases → " + basesRes.status);
  const bases = await basesRes.json();
  const policies = bases.find((b) => b.slug === "insurance-policies");
  if (!policies) {
    showEmpty(
      'No "insurance-policies" Base found in this workspace. This demo reads a real Base live — seed the standard demo dataset (Insurance Agency folder) to see it populated.',
    );
    return;
  }

  const recordsRes = await fetch("/api/v1/records?baseId=" + policies.id + "&limit=100");
  if (!recordsRes.ok) throw new Error("GET /api/v1/records → " + recordsRes.status);
  const { records } = await recordsRes.json();

  renderStats(records);

  for (const status of STATUSES) {
    const items = records.filter((r) => r.headCommit?.payload?.status === status.id);
    const total = items.reduce((sum, r) => sum + (Number(r.headCommit?.payload?.premium) || 0), 0);

    const column = document.createElement("div");
    column.className = "column";
    column.innerHTML =
      '<h2>' + status.label + ' <span class="total">' + money(total) + "</span></h2>";

    for (const record of items) {
      const fields = record.headCommit?.payload ?? {};
      const remaining = daysUntil(fields.renewal_date);
      const item = document.createElement("div");
      item.className = remaining !== null && remaining <= 90 ? "item soon" : "item";
      item.innerHTML = '<div class="name"></div><div class="meta"></div>';
      item.querySelector(".name").textContent = fields.product || fields.policy_number || "(untitled)";
      item.querySelector(".meta").textContent = [
        money(fields.premium),
        fields.insurer,
        remaining === null ? null : remaining + "d to renewal",
      ]
        .filter(Boolean)
        .join(" · ");
      column.appendChild(item);
    }
    board.appendChild(column);
  }
}

loadPolicies().catch((err) => showEmpty("Couldn't load policies: " + err.message));
`;

// ── Agent Desk AirApp — the advisor's own view: who ranks where, and what's due today ──

const AGENT_DESK_INDEX_HTML = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Agent Desk</title>
    <link rel="stylesheet" href="style.css" />
  </head>
  <body>
    <header>
      <span class="badge">AirApp · Live workspace data</span>
      <h1>Agent Desk</h1>
      <p>Every advisor's book, ranked, plus what's due across the Clients and Renewal Tasks Bases — read live, not seeded.</p>
    </header>
    <div class="kicker">Book leaderboard</div>
    <div class="panel"><table class="data-table" id="leaderboard"></table></div>
    <div class="kicker">Today's queue — follow-ups &amp; renewal tasks, soonest first</div>
    <div class="panel" id="queue"></div>
  </body>
  <script src="client.js"></script>
</html>
`;

const AGENT_DESK_CLIENT_JS = `function money(n) {
  return typeof n === "number" ? "$" + n.toLocaleString("en-US") : "—";
}

function daysUntil(dateString) {
  if (!dateString) return null;
  const target = new Date(dateString);
  if (Number.isNaN(target.getTime())) return null;
  return Math.round((target.getTime() - Date.now()) / 86400000);
}

function pillFor(remaining) {
  if (remaining === null) return { cls: "ok", label: "no date" };
  if (remaining < 0) return { cls: "overdue", label: Math.abs(remaining) + "d overdue" };
  if (remaining <= 14) return { cls: "due-soon", label: remaining + "d left" };
  return { cls: "ok", label: remaining + "d left" };
}

function showEmpty(message) {
  document.querySelector(".kicker")?.remove();
  document.querySelectorAll(".panel").forEach((el) => el.remove());
  const div = document.createElement("div");
  div.id = "empty";
  div.textContent = message;
  document.body.appendChild(div);
}

async function fetchBaseRecords(bases, slug) {
  const base = bases.find((b) => b.slug === slug);
  if (!base) return null;
  const res = await fetch("/api/v1/records?baseId=" + base.id + "&limit=100");
  if (!res.ok) throw new Error("GET /api/v1/records (" + slug + ") → " + res.status);
  const { records } = await res.json();
  return records;
}

async function load() {
  const basesRes = await fetch("/api/v1/bases");
  if (!basesRes.ok) throw new Error("GET /api/v1/bases → " + basesRes.status);
  const bases = await basesRes.json();

  const [clients, policies, renewals] = await Promise.all([
    fetchBaseRecords(bases, "insurance-clients"),
    fetchBaseRecords(bases, "insurance-policies"),
    fetchBaseRecords(bases, "insurance-renewals"),
  ]);
  if (!clients || !policies || !renewals) {
    showEmpty(
      'This workspace is missing one of "insurance-clients", "insurance-policies" or "insurance-renewals". This demo reads real Bases live — seed the standard demo dataset (Insurance Agency folder) to see it populated.',
    );
    return;
  }

  const clientById = {};
  for (const c of clients) clientById[c.id] = c.headCommit?.payload ?? {};

  const byAdvisor = {};
  for (const p of policies) {
    const f = p.headCommit?.payload ?? {};
    const clientId = Array.isArray(f.client) ? f.client[0] : null;
    const advisor = (clientId && clientById[clientId]?.advisor) || "(unassigned)";
    const row = byAdvisor[advisor] || { advisor, policyCount: 0, premium: 0, commission: 0 };
    row.policyCount += 1;
    row.premium += Number(f.premium) || 0;
    row.commission += Number(f.commission_amount) || 0;
    byAdvisor[advisor] = row;
  }
  const leaderboard = Object.values(byAdvisor).sort((a, b) => b.premium - a.premium);

  const table = document.getElementById("leaderboard");
  table.innerHTML =
    "<thead><tr><th>Advisor</th><th>Policies</th><th>Premium in force</th><th>Commission earned</th></tr></thead><tbody></tbody>";
  const tbody = table.querySelector("tbody");
  leaderboard.forEach((row, i) => {
    const tr = document.createElement("tr");
    tr.innerHTML =
      "<td><span class=\\"rank\\">" +
      (i + 1) +
      "</span>" +
      row.advisor +
      "</td><td>" +
      row.policyCount +
      "</td><td>" +
      money(row.premium) +
      "</td><td>" +
      money(row.commission) +
      "</td>";
    tbody.appendChild(tr);
  });

  const queueItems = [];
  for (const c of clients) {
    const f = c.headCommit?.payload ?? {};
    if (!f.next_follow_up) continue;
    queueItems.push({
      type: "Follow-up",
      date: f.next_follow_up,
      name: f.client_name || "(unnamed client)",
      meta: (f.advisor || "(unassigned)") + " · " + (f.stage || ""),
    });
  }
  for (const r of renewals) {
    const f = r.headCommit?.payload ?? {};
    if (f.status === "done") continue;
    if (!f.due_date) continue;
    queueItems.push({
      type: "Renewal",
      date: f.due_date,
      name: f.task || "(untitled task)",
      meta: (f.owner || "(unassigned)") + " · " + (f.status || ""),
    });
  }
  queueItems.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

  const queueEl = document.getElementById("queue");
  if (queueItems.length === 0) {
    queueEl.textContent = "Nothing due — the queue is clear.";
  } else {
    queueEl.innerHTML = "";
    for (const item of queueItems.slice(0, 10)) {
      const remaining = daysUntil(item.date);
      const pill = pillFor(remaining);
      const row = document.createElement("div");
      row.className = "queue-item";
      row.innerHTML =
        '<div><div class="name">[' +
        item.type +
        "] " +
        item.name +
        '</div><div class="meta">' +
        item.meta +
        '</div></div><span class="pill ' +
        pill.cls +
        '">' +
        pill.label +
        "</span>";
      queueEl.appendChild(row);
    }
  }
}

load().catch((err) => showEmpty("Couldn't load the agent desk: " + err.message));
`;

// ── Agency Scoreboard AirApp — the owner's view: the whole book, at a glance ──

const AGENCY_SCOREBOARD_INDEX_HTML = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Agency Scoreboard</title>
    <link rel="stylesheet" href="style.css" />
  </head>
  <body>
    <header>
      <span class="badge">AirApp · Live workspace data</span>
      <h1>Agency Scoreboard</h1>
      <p>The whole book in one screen — premium, commission, and where it's concentrated. Reads the Clients and Policies Bases live.</p>
    </header>
    <div id="stats" class="stats"></div>
    <div class="kicker">Premium by product line</div>
    <div class="panel" id="by-line"></div>
    <div class="kicker">Premium by carrier</div>
    <div class="panel" id="by-carrier"></div>
  </body>
  <script src="client.js"></script>
</html>
`;

const AGENCY_SCOREBOARD_CLIENT_JS = `function money(n) {
  return typeof n === "number" ? "$" + n.toLocaleString("en-US") : "—";
}

function showEmpty(message) {
  document.getElementById("stats")?.remove();
  document.querySelectorAll(".kicker, .panel").forEach((el) => el.remove());
  const div = document.createElement("div");
  div.id = "empty";
  div.textContent = message;
  document.body.appendChild(div);
}

function renderBars(containerId, rows, total) {
  const el = document.getElementById(containerId);
  el.innerHTML = "";
  const max = rows.reduce((m, r) => Math.max(m, r.value), 0) || 1;
  for (const row of rows) {
    const pct = Math.round((row.value / max) * 100);
    const div = document.createElement("div");
    div.className = "bar-row";
    div.innerHTML =
      '<div class="bar-label">' +
      row.label +
      '</div><div class="bar-track"><div class="bar-fill" style="width:' +
      pct +
      '%"></div></div><div class="bar-value">' +
      money(row.value) +
      "</div>";
    el.appendChild(div);
  }
  if (rows.length === 0) {
    el.textContent = "No data yet.";
  }
}

async function fetchBaseRecords(bases, slug) {
  const base = bases.find((b) => b.slug === slug);
  if (!base) return null;
  const res = await fetch("/api/v1/records?baseId=" + base.id + "&limit=100");
  if (!res.ok) throw new Error("GET /api/v1/records (" + slug + ") → " + res.status);
  const { records } = await res.json();
  return records;
}

async function load() {
  const basesRes = await fetch("/api/v1/bases");
  if (!basesRes.ok) throw new Error("GET /api/v1/bases → " + basesRes.status);
  const bases = await basesRes.json();

  const [clients, policies] = await Promise.all([
    fetchBaseRecords(bases, "insurance-clients"),
    fetchBaseRecords(bases, "insurance-policies"),
  ]);
  if (!clients || !policies) {
    showEmpty(
      'This workspace is missing "insurance-clients" or "insurance-policies". This demo reads real Bases live — seed the standard demo dataset (Insurance Agency folder) to see it populated.',
    );
    return;
  }

  let totalPremium = 0;
  let totalCommission = 0;
  const byLine = {};
  const byCarrier = {};
  for (const p of policies) {
    const f = p.headCommit?.payload ?? {};
    const premium = Number(f.premium) || 0;
    totalPremium += premium;
    totalCommission += Number(f.commission_amount) || 0;
    const line = f.product_line || "other";
    byLine[line] = (byLine[line] || 0) + premium;
    const carrier = f.insurer || "(unnamed carrier)";
    byCarrier[carrier] = (byCarrier[carrier] || 0) + premium;
  }

  const insuredCount = clients.filter((c) => c.headCommit?.payload?.stage === "insured").length;
  const pipeline = clients
    .filter((c) => c.headCommit?.payload?.stage !== "insured" && c.headCommit?.payload?.stage !== "lost")
    .reduce((sum, c) => sum + (Number(c.headCommit?.payload?.annual_budget) || 0), 0);

  const statsEl = document.getElementById("stats");
  const tiles = [
    ["Premium in force", money(totalPremium)],
    ["Commission earned", money(totalCommission)],
    ["Insured clients", String(insuredCount)],
    ["Active policies", String(policies.length)],
    ["Open pipeline", money(pipeline)],
  ];
  statsEl.innerHTML = tiles
    .map(
      ([label, value]) =>
        '<div class="stat"><div class="label">' + label + '</div><div class="value">' + value + "</div></div>",
    )
    .join("");

  renderBars(
    "by-line",
    Object.entries(byLine)
      .map(([label, value]) => ({ label, value }))
      .sort((a, b) => b.value - a.value),
  );
  renderBars(
    "by-carrier",
    Object.entries(byCarrier)
      .map(([label, value]) => ({ label, value }))
      .sort((a, b) => b.value - a.value),
  );
}

load().catch((err) => showEmpty("Couldn't load the scoreboard: " + err.message));
`;

// ── Issuance Desk AirApp — back office: what's still in flight, and what's missing ──

const ISSUANCE_DESK_INDEX_HTML = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Issuance Desk</title>
    <link rel="stylesheet" href="style.css" />
  </head>
  <body>
    <header>
      <span class="badge">AirApp · Live workspace data</span>
      <h1>Issuance Desk</h1>
      <p>Where every policy sits between a quote and an in-force contract, and which files are still missing. Reads the Policies Base live.</p>
    </header>
    <div class="kicker">By stage</div>
    <div class="panel" id="funnel"></div>
    <div class="kicker">Needs attention — quoting or underwriting</div>
    <div class="panel"><table class="data-table" id="queue-table"></table></div>
  </body>
  <script src="client.js"></script>
</html>
`;

const ISSUANCE_DESK_CLIENT_JS = `const STAGE_ORDER = [
  { id: "quoting", label: "Quoting" },
  { id: "underwriting", label: "Underwriting" },
  { id: "active", label: "Active" },
  { id: "renewed", label: "Renewed" },
  { id: "lapsed", label: "Lapsed" },
];

function money(n) {
  return typeof n === "number" ? "$" + n.toLocaleString("en-US") : "—";
}

function daysUntil(dateString) {
  if (!dateString) return null;
  const target = new Date(dateString);
  if (Number.isNaN(target.getTime())) return null;
  return Math.round((target.getTime() - Date.now()) / 86400000);
}

function showEmpty(message) {
  document.querySelectorAll(".kicker, .panel").forEach((el) => el.remove());
  const div = document.createElement("div");
  div.id = "empty";
  div.textContent = message;
  document.body.appendChild(div);
}

async function load() {
  const basesRes = await fetch("/api/v1/bases");
  if (!basesRes.ok) throw new Error("GET /api/v1/bases → " + basesRes.status);
  const bases = await basesRes.json();
  const policiesBase = bases.find((b) => b.slug === "insurance-policies");
  const clientsBase = bases.find((b) => b.slug === "insurance-clients");
  if (!policiesBase || !clientsBase) {
    showEmpty(
      'This workspace is missing "insurance-policies" or "insurance-clients". This demo reads a real Base live — seed the standard demo dataset (Insurance Agency folder) to see it populated.',
    );
    return;
  }

  const [policiesRes, clientsRes] = await Promise.all([
    fetch("/api/v1/records?baseId=" + policiesBase.id + "&limit=100"),
    fetch("/api/v1/records?baseId=" + clientsBase.id + "&limit=100"),
  ]);
  if (!policiesRes.ok) throw new Error("GET /api/v1/records → " + policiesRes.status);
  if (!clientsRes.ok) throw new Error("GET /api/v1/records → " + clientsRes.status);
  const { records: policies } = await policiesRes.json();
  const { records: clients } = await clientsRes.json();
  const clientNameById = {};
  for (const c of clients) clientNameById[c.id] = c.headCommit?.payload?.client_name || "(unnamed client)";

  const funnelEl = document.getElementById("funnel");
  funnelEl.innerHTML = "";
  const max = policies.length || 1;
  for (const stage of STAGE_ORDER) {
    const items = policies.filter((p) => p.headCommit?.payload?.status === stage.id);
    const premium = items.reduce((sum, p) => sum + (Number(p.headCommit?.payload?.premium) || 0), 0);
    const pct = Math.round((items.length / max) * 100);
    const div = document.createElement("div");
    div.className = "bar-row";
    div.innerHTML =
      '<div class="bar-label">' +
      stage.label +
      '</div><div class="bar-track"><div class="bar-fill" style="width:' +
      pct +
      '%"></div></div><div class="bar-value">' +
      items.length +
      " · " +
      money(premium) +
      "</div>";
    funnelEl.appendChild(div);
  }

  const inFlight = policies
    .filter((p) => ["quoting", "underwriting"].includes(p.headCommit?.payload?.status))
    .sort(
      (a, b) =>
        new Date(a.headCommit?.payload?.effective_date || 0).getTime() -
        new Date(b.headCommit?.payload?.effective_date || 0).getTime(),
    );

  const table = document.getElementById("queue-table");
  table.innerHTML =
    "<thead><tr><th>Policy</th><th>Client</th><th>Product</th><th>Premium</th><th>Status</th><th>Policy file</th></tr></thead><tbody></tbody>";
  const tbody = table.querySelector("tbody");
  if (inFlight.length === 0) {
    const tr = document.createElement("tr");
    tr.innerHTML = '<td colspan="6">Nothing in flight — every policy is issued or renewed.</td>';
    tbody.appendChild(tr);
  }
  for (const p of inFlight) {
    const f = p.headCommit?.payload ?? {};
    const clientId = Array.isArray(f.client) ? f.client[0] : null;
    const hasFile = Array.isArray(f.policy_file) && f.policy_file.length > 0;
    const tr = document.createElement("tr");
    tr.innerHTML =
      "<td>" +
      (f.policy_number || "—") +
      "</td><td>" +
      (clientNameById[clientId] || "—") +
      "</td><td>" +
      (f.product || "—") +
      "</td><td>" +
      money(f.premium) +
      '</td><td><span class="pill due-soon">' +
      (STAGE_ORDER.find((s) => s.id === f.status)?.label || f.status || "—") +
      "</span></td><td>" +
      (hasFile
        ? '<span class="pill ok">on file</span>'
        : '<span class="pill missing">missing</span>') +
      "</td>";
    tbody.appendChild(tr);
  }
}

load().catch((err) => showEmpty("Couldn't load the issuance desk: " + err.message));
`;

const INSURANCE_FILE_TREE_NODES: SeedFileTreeDef[] = [
  {
    nodeType: "skill",
    nodeId: INSURANCE_SKILL_NODE_ID,
    slug: "policy-renewal-assistant",
    name: "Policy Renewal Assistant",
    description: "Prepares a renewal recommendation and proposes it for advisor review.",
    position: 1,
    files: [
      { path: "SKILL.md", content: RENEWAL_ASSISTANT_SKILL_MD },
      {
        path: "skill.json",
        content: `${JSON.stringify(
          {
            name: "policy-renewal-assistant",
            description:
              "Prepares a renewal recommendation for a policy and proposes it for advisor review.",
            version: "0.1.0",
          },
          null,
          2,
        )}\n`,
      },
      {
        path: "references/renewal-thresholds.md",
        content:
          "# Renewal thresholds\n\n| Increase | Action |\n| --- | --- |\n| Under 5% | Renew as-is, notify the client |\n| 5-10% | Renew, but explain the driver on the call |\n| Over 10% | Re-quote at least two other carriers before proposing |\n\nA fleet account with two or more at-fault claims always gets loss runs pulled first, regardless of the indicated increase.\n",
      },
      {
        path: "examples/renewal-note.md",
        content:
          "Northwind held the fleet at +9% (not the +23% first indicated) by moving the two claim vehicles to a higher deductible. Net premium $44,900. Call script: lead with the deductible change, then the number.\n",
      },
    ],
    changeRequest: {
      id: INSURANCE_SKILL_CR_ID,
      operationId: "opr_seed_ins_skill_renewal_assistant",
      commitId: "cmt_seed_ins_skill_renewal_assistant",
      submittedBy: "skill-maintainer-agent",
      minutesAgo: 9,
      filePath: "SKILL.md",
      nextContent: `${RENEWAL_ASSISTANT_SKILL_MD}
## Suitability guardrails

- Do not propose a product outside the client's stated protection focus without saying why.
- Never reduce a sum insured to hit a budget without naming the coverage gap it creates.
- Flag anything that needs a licensed advisor's judgement instead of deciding it.
`,
      message: "Add suitability guardrails to the Policy Renewal Assistant",
      scenario: "skill-file-update",
      workflow: "skill-governance",
    },
  },
  {
    nodeType: "drive",
    nodeId: INSURANCE_DRIVE_NODE_ID,
    slug: "insurance-materials",
    name: "Client Materials",
    description: "Client-facing templates, disclosure language, and claim instructions.",
    position: 1,
    files: [
      {
        path: "README.md",
        content:
          "# Client Materials\n\nEverything an advisor sends a client, kept in one reviewable place so nobody mails an outdated disclosure.\n\n## Contents\n\n- `templates/proposal-outline.md` — the structure every proposal follows\n- `compliance/disclosure-language.md` — the wording that must appear verbatim\n- `claims/first-notice-checklist.md` — what to collect when a client calls after a loss\n",
      },
      {
        path: "templates/proposal-outline.md",
        content:
          "# Proposal outline\n\n1. **The gap** — what happens financially if the insured event occurs today. One paragraph, their numbers, no product names.\n2. **The recommendation** — product, carrier, sum insured, premium, and why this structure.\n3. **The cheaper option** — the same gap covered for less, and exactly what it gives up.\n4. **What happens next** — underwriting steps, expected timeline, what they need to provide.\n5. **Disclosures** — verbatim from `compliance/disclosure-language.md`.\n\nNever send a proposal that skips step 1. A recommendation without a named gap gets compared on price alone.\n",
      },
      {
        path: "compliance/disclosure-language.md",
        content:
          "# Disclosure language\n\nThe following must appear verbatim in every written proposal:\n\n> This proposal is a summary for comparison only. Cover, exclusions, and waiting periods are governed entirely by the policy wording issued by the insurer. Premiums quoted are indicative and subject to underwriting.\n\nCommission disclosure, where the client asks or where required:\n\n> This agency is remunerated by commission paid by the insurer, calculated as a percentage of the premium. The commission does not increase the premium you pay.\n\nDo not paraphrase either block. Changes go through a change request so the wording stays auditable.\n",
      },
      {
        path: "claims/first-notice-checklist.md",
        content:
          "# First notice of loss — checklist\n\nCollect these before contacting the insurer:\n\n- Policy number and the insured's contact details\n- Date, time, and location of the loss\n- What happened, in the client's own words\n- Photos or documents the client already has\n- Whether any third party or authority was involved, and any reference number\n\nThen: log the claim against the policy record, tell the client the expected first response time, and set a follow-up task. A claim with no follow-up task is how a client ends up chasing us.\n",
      },
    ],
  },
  {
    nodeType: "airapp",
    nodeId: INSURANCE_AIRAPP_NODE_ID,
    slug: "insurance-renewal-board",
    name: "Renewal Board",
    description:
      'A live board over this workspace\'s own "insurance-policies" Base, read through the public REST API. Zero npm dependencies.',
    position: 6,
    files: [
      { path: "package.json", content: RENEWAL_BOARD_PACKAGE_JSON },
      { path: "server.js", content: RENEWAL_BOARD_SERVER_JS },
      { path: "index.html", content: RENEWAL_BOARD_INDEX_HTML },
      { path: "style.css", content: RENEWAL_BOARD_STYLE_CSS },
      { path: "client.js", content: RENEWAL_BOARD_CLIENT_JS },
    ],
  },
  {
    nodeType: "airapp",
    nodeId: INSURANCE_AGENT_DESK_NODE_ID,
    slug: "insurance-agent-desk",
    name: "Agent Desk",
    description:
      "The advisor's own view: a book leaderboard across every advisor, plus today's follow-up and renewal queue. Reads the Clients and Renewal Tasks Bases live.",
    position: 7,
    files: [
      { path: "package.json", content: RENEWAL_BOARD_PACKAGE_JSON },
      { path: "server.js", content: RENEWAL_BOARD_SERVER_JS },
      { path: "index.html", content: AGENT_DESK_INDEX_HTML },
      { path: "style.css", content: RENEWAL_BOARD_STYLE_CSS },
      { path: "client.js", content: AGENT_DESK_CLIENT_JS },
    ],
  },
  {
    nodeType: "airapp",
    nodeId: INSURANCE_AGENCY_SCOREBOARD_NODE_ID,
    slug: "insurance-agency-scoreboard",
    name: "Agency Scoreboard",
    description:
      "The owner's view: total premium in force, commission earned, and where the book is concentrated by product line and carrier. Reads the Clients and Policies Bases live.",
    position: 8,
    files: [
      { path: "package.json", content: RENEWAL_BOARD_PACKAGE_JSON },
      { path: "server.js", content: RENEWAL_BOARD_SERVER_JS },
      { path: "index.html", content: AGENCY_SCOREBOARD_INDEX_HTML },
      { path: "style.css", content: RENEWAL_BOARD_STYLE_CSS },
      { path: "client.js", content: AGENCY_SCOREBOARD_CLIENT_JS },
    ],
  },
  {
    nodeType: "airapp",
    nodeId: INSURANCE_ISSUANCE_DESK_NODE_ID,
    slug: "insurance-issuance-desk",
    name: "Issuance Desk",
    description:
      "The back office's view: every policy still between a quote and an in-force contract, sorted by effective date, with a missing-policy-file flag. Reads the Policies Base live.",
    position: 9,
    files: [
      { path: "package.json", content: RENEWAL_BOARD_PACKAGE_JSON },
      { path: "server.js", content: RENEWAL_BOARD_SERVER_JS },
      { path: "index.html", content: ISSUANCE_DESK_INDEX_HTML },
      { path: "style.css", content: RENEWAL_BOARD_STYLE_CSS },
      { path: "client.js", content: ISSUANCE_DESK_CLIENT_JS },
    ],
  },
];

// ── Whiteboard / Workflow / HTML (metadata-backed rich nodes) ────────────────

export const whiteboardCard = (
  id: string,
  x: number,
  y: number,
  text: string,
  color: string,
  seed: number,
  index: number,
) => [
  {
    id: `${id}-box`,
    type: "rectangle",
    x,
    y,
    width: 250,
    height: 125,
    angle: 0,
    strokeColor: "#475569",
    backgroundColor: color,
    fillStyle: "solid",
    strokeWidth: 2,
    strokeStyle: "solid",
    roughness: 1,
    opacity: 100,
    groupIds: [],
    frameId: null,
    index: `a${index * 2 + 1}`,
    roundness: { type: 3 },
    seed,
    version: 1,
    versionNonce: seed,
    isDeleted: false,
    boundElements: null,
    updated: 1,
    link: null,
    locked: false,
  },
  {
    id: `${id}-text`,
    type: "text",
    x: x + 15,
    y: y + 24,
    width: 220,
    height: 60,
    angle: 0,
    strokeColor: "#0f172a",
    backgroundColor: "transparent",
    fillStyle: "solid",
    strokeWidth: 1,
    strokeStyle: "solid",
    roughness: 1,
    opacity: 100,
    groupIds: [],
    frameId: null,
    index: `a${index * 2 + 2}`,
    roundness: null,
    seed: seed + 10,
    version: 1,
    versionNonce: seed + 10,
    isDeleted: false,
    boundElements: null,
    updated: 1,
    link: null,
    locked: false,
    text,
    fontSize: 16,
    fontFamily: 5,
    textAlign: "left",
    verticalAlign: "top",
    containerId: null,
    originalText: text,
    autoResize: true,
    lineHeight: 1.35,
  },
];

const BOOK_OF_BUSINESS_CARDS: Array<[string, number, number, string, string, number]> = [
  ["households", 80, 130, "Households\n7 clients · 8 policies", "#dcfce7", 301],
  ["book-value", 400, 130, "Book value\n$295.7K premium · $21.0K commission", "#e0e7ff", 305],
  ["renewals", 720, 130, "Next 90 days\nFleet · Senior health · Group benefits", "#fef3c7", 302],
  ["gaps", 80, 330, "Open gaps\nIncome protection · Group health", "#dbeafe", 303],
  ["referrals", 400, 330, "Referral sources\nExisting clients · Community", "#fce7f3", 304],
];

const INSURANCE_RICH_NODES: SeedRichNodeDef[] = [
  {
    nodeType: "whiteboard",
    nodeId: INSURANCE_WHITEBOARD_NODE_ID,
    folderNodeId: DEMO_INSURANCE_FOLDER_NODE_ID,
    slug: "book-of-business",
    name: "Book of Business Map",
    description:
      "The advisor's own map — who is insured, what renews next, and where the gaps are.",
    position: 3,
    metadata: {
      whiteboardDocument: {
        version: 1,
        appState: { viewBackgroundColor: "#f8fafc" },
        elements: [
          {
            id: "book-title",
            type: "text",
            x: 80,
            y: 50,
            width: 330,
            height: 38,
            angle: 0,
            strokeColor: "#0f172a",
            backgroundColor: "transparent",
            fillStyle: "solid",
            strokeWidth: 1,
            strokeStyle: "solid",
            roughness: 1,
            opacity: 100,
            groupIds: [],
            frameId: null,
            index: "a0",
            roundness: null,
            seed: 300,
            version: 1,
            versionNonce: 300,
            isDeleted: false,
            boundElements: null,
            updated: 1,
            link: null,
            locked: false,
            text: "Book of business",
            fontSize: 28,
            fontFamily: 5,
            textAlign: "left",
            verticalAlign: "top",
            containerId: null,
            originalText: "Book of business",
            autoResize: true,
            lineHeight: 1.25,
          },
          ...BOOK_OF_BUSINESS_CARDS.flatMap(([id, x, y, text, color, seed], index) =>
            whiteboardCard(id, x, y, text, color, seed, index),
          ),
        ],
      },
    },
  },
  {
    nodeType: "workflow",
    nodeId: INSURANCE_WORKFLOW_NODE_ID,
    folderNodeId: DEMO_INSURANCE_FOLDER_NODE_ID,
    slug: "renewal-outreach-workflow",
    name: "Renewal Outreach Workflow",
    description:
      "The 90-day renewal flow: pull the policy, re-quote if needed, propose for review.",
    position: 4,
    metadata: {
      workflowDocument: {
        version: 2,
        nodes: [
          {
            id: "renewal-due",
            kind: "trigger",
            position: { x: 0, y: 80 },
            label: "90 days to renewal",
            description: "Start when a policy enters its renewal window.",
            eventName: "policy.renewal_window",
          },
          {
            id: "pull-loss-runs",
            kind: "webhook",
            position: { x: 280, y: 80 },
            label: "Pull loss runs",
            description: "Request the claims history from the carrier portal.",
            method: "POST",
            url: "https://example.com/webhooks/carrier-loss-runs",
          },
          {
            id: "price-change",
            kind: "condition",
            position: { x: 560, y: 80 },
            label: "Increase over 10%?",
            description: "Branch on the carrier's indicated renewal premium.",
            expression: "input.increasePct > 10",
          },
          {
            id: "requote",
            kind: "action",
            position: { x: 560, y: 260 },
            label: "Re-quote the market",
            description: "Collect indications from at least two other carriers.",
            actionName: "requestQuotes",
          },
          {
            id: "propose",
            kind: "action",
            position: { x: 280, y: 260 },
            label: "Propose the renewal",
            description: "Open a change request with the new premium and the reason.",
            actionName: "createChangeRequest",
          },
          {
            id: "advisor-approval",
            kind: "approval",
            position: { x: 0, y: 260 },
            label: "Advisor approves",
            description: "A licensed advisor signs off before anything reaches the client.",
            approver: "space-admin",
          },
          {
            id: "renewed",
            kind: "end",
            position: { x: 0, y: 440 },
            label: "Renewal proposed",
            description: "The client conversation is booked with an approved recommendation.",
            outcome: "approved",
          },
        ],
        edges: [
          {
            id: "due-loss-runs",
            source: "renewal-due",
            target: "pull-loss-runs",
            label: "",
            outcome: "default",
          },
          {
            id: "loss-runs-condition",
            source: "pull-loss-runs",
            target: "price-change",
            label: "claims history",
            outcome: "success",
          },
          {
            id: "condition-requote",
            source: "price-change",
            target: "requote",
            label: "over 10%",
            outcome: "true",
          },
          {
            id: "condition-propose",
            source: "price-change",
            target: "propose",
            label: "within 10%",
            outcome: "false",
          },
          {
            id: "requote-propose",
            source: "requote",
            target: "propose",
            label: "quotes collected",
            outcome: "success",
          },
          {
            id: "propose-approval",
            source: "propose",
            target: "advisor-approval",
            label: "submitted",
            outcome: "success",
          },
          {
            id: "approval-renewed",
            source: "advisor-approval",
            target: "renewed",
            label: "approved",
            outcome: "approved",
          },
        ],
        settings: {
          executionMode: "event",
          concurrency: 2,
          timeoutMs: 60000,
          errorPolicy: "stop",
        },
      },
    },
  },
  {
    nodeType: "html",
    nodeId: INSURANCE_HTML_NODE_ID,
    folderNodeId: DEMO_INSURANCE_FOLDER_NODE_ID,
    slug: "proposal-one-pager",
    name: "Proposal One-Pager",
    description: "An editable HTML prototype of the one-page proposal clients actually read.",
    position: 5,
    metadata: {
      htmlDocument: {
        version: 1,
        source: `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Protection proposal</title>
  <style>
    * { box-sizing: border-box; }
    body { margin: 0; padding: 32px; background: #f1f5f9; color: #0f172a; font: 16px/1.6 system-ui, sans-serif; }
    main { max-width: 720px; margin: 0 auto; background: white; border: 1px solid #cbd5e1; border-radius: 12px; padding: 36px; box-shadow: 0 18px 45px rgba(15, 23, 42, .08); }
    .tag { display: inline-block; font-size: 12px; font-weight: 700; letter-spacing: .06em; text-transform: uppercase; color: #047857; background: #ecfdf5; padding: 4px 10px; border-radius: 999px; }
    h1 { font-size: 24px; margin: 14px 0 4px; }
    .sub { color: #64748b; margin: 0 0 28px; }
    h2 { font-size: 15px; text-transform: uppercase; letter-spacing: .04em; color: #475569; margin: 28px 0 8px; }
    .gap { background: #fff7ed; border-left: 3px solid #ea580c; padding: 14px 16px; border-radius: 0 8px 8px 0; }
    table { width: 100%; border-collapse: collapse; margin-top: 8px; font-size: 15px; }
    th, td { text-align: left; padding: 10px 8px; border-bottom: 1px solid #e2e8f0; }
    th { color: #64748b; font-weight: 600; font-size: 13px; text-transform: uppercase; letter-spacing: .03em; }
    .rec td { background: #f0fdf4; font-weight: 600; }
    .fine { margin-top: 28px; font-size: 13px; color: #64748b; border-top: 1px solid #e2e8f0; padding-top: 16px; }
  </style>
</head>
<body>
  <main>
    <span class="tag">Protection proposal</span>
    <h1>Maya &amp; Theo Brandt</h1>
    <p class="sub">Prepared by Dana Reyes · Reviewed before sending</p>

    <h2>The gap</h2>
    <div class="gap">
      On a single income with 22 years left on the mortgage, losing that income today
      leaves roughly <strong>$640,000</strong> uncovered — the outstanding balance plus
      five years of household costs.
    </div>

    <h2>Options</h2>
    <table>
      <thead>
        <tr><th>Option</th><th>Cover</th><th>Annual premium</th><th>Gives up</th></tr>
      </thead>
      <tbody>
        <tr class="rec">
          <td>Recommended</td>
          <td>$750,000 term life + critical illness</td>
          <td>$2,120</td>
          <td>—</td>
        </tr>
        <tr>
          <td>Lower cost</td>
          <td>$500,000 term life only</td>
          <td>$820</td>
          <td>No illness cover; mortgage only partly covered</td>
        </tr>
      </tbody>
    </table>

    <h2>What happens next</h2>
    <p>Simplified issue — no medical exam under $1M. Underwriting typically returns in 5-7 business days.</p>

    <p class="fine">
      This proposal is a summary for comparison only. Cover, exclusions, and waiting periods
      are governed entirely by the policy wording issued by the insurer. Premiums quoted are
      indicative and subject to underwriting.
    </p>
  </main>
</body>
</html>`,
      },
    },
  },
];

// ── Form ─────────────────────────────────────────────────────────────────────

const INSURANCE_FORMS: SeedFormDef[] = [
  {
    nodeId: INSURANCE_FORM_NODE_ID,
    folderNodeId: DEMO_INSURANCE_FOLDER_NODE_ID,
    slug: "insurance-consult-form",
    name: "Request a Consultation",
    description:
      "The agency's public intake form. A submission is written into the Clients Base through the same ChangeRequest path as every other write, so whether a lead lands straight away or waits in the review queue is the workspace's permission decision, not the form's.",
    position: 6,
    formId: INSURANCE_FORM_ID,
    targetBaseId: DEMO_INSURANCE_CLIENTS_BASE_ID,
    bindings: [
      { inputName: "client_name", fieldSlug: "client_name", required: true, label: "Your name" },
      { inputName: "phone", fieldSlug: "phone", required: true, label: "Phone" },
      {
        inputName: "notes",
        fieldSlug: "notes",
        required: true,
        label: "What do you want covered?",
        help: "A sentence is enough — an advisor will follow up.",
      },
    ],
    page: {
      theme: { brandColor: "#047857" },
      code: `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<style>
  :root { --brand: #047857; }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: ui-sans-serif, system-ui, -apple-system, sans-serif; background: #f6faf8; color: #1c1917; }
  .wrap { max-width: 560px; margin: 0 auto; padding: 40px 24px 64px; }
  .badge { display: inline-block; font-size: 12px; font-weight: 600; letter-spacing: .04em; text-transform: uppercase; color: var(--brand); background: #ecfdf5; padding: 5px 10px; border-radius: 999px; }
  h1 { font-size: 26px; line-height: 1.2; margin: 16px 0 8px; }
  p.lede { color: #57534e; margin: 0 0 28px; }
  label { display: block; font-weight: 600; font-size: 14px; margin: 18px 0 6px; }
  input, textarea { width: 100%; padding: 11px 13px; border: 1px solid #e7e5e4; border-radius: 10px; font: inherit; background: #fff; }
  textarea { min-height: 130px; resize: vertical; }
  input:focus, textarea:focus { outline: none; border-color: var(--brand); box-shadow: 0 0 0 3px #d1fae5; }
  button { margin-top: 24px; width: 100%; padding: 13px; border: 0; border-radius: 10px; background: var(--brand); color: #fff; font-weight: 600; font-size: 15px; cursor: pointer; }
  .note { margin-top: 14px; font-size: 13px; color: #78716c; text-align: center; }
  .ok { margin-top: 20px; padding: 14px; border-radius: 10px; background: #f0fdf4; border: 1px solid #bbf7d0; color: #166534; font-size: 14px; display: none; }
</style>
</head>
<body>
  <div class="wrap">
    <span class="badge">Free consultation</span>
    <h1>Find out what you're actually covered for</h1>
    <p class="lede">Tell us what you want protected. A licensed advisor reviews every request personally — no automated quote, no obligation.</p>
    <div id="f">
      <label for="client_name">Your name</label>
      <input id="client_name" name="client_name" required placeholder="e.g. Owen Castellanos" />
      <label for="phone">Phone</label>
      <input id="phone" name="phone" required placeholder="e.g. +1-503-555-0129" />
      <label for="notes">What do you want covered?</label>
      <textarea id="notes" name="notes" required placeholder="e.g. Just went self-employed and lost my group health plan…"></textarea>
      <button type="button" id="btn">Request a consultation</button>
      <p class="note">Reviewed by an advisor, not an algorithm.</p>
    </div>
    <div class="ok" id="ok">Thanks! An advisor has your request and will be in touch.</div>
  </div>
  <script>
    // Uses the Busabase bridge (window.busa.submit) directly rather than a native
    // <form> submit, so the submission fires exactly once. A type="button" click
    // avoids the bridge's auto-form-collect listener double-submitting.
    document.getElementById('btn').addEventListener('click', function () {
      var name = document.getElementById('client_name').value.trim();
      var phone = document.getElementById('phone').value.trim();
      var notes = document.getElementById('notes').value.trim();
      if (!name || !phone || !notes) { alert('Please fill in all three fields.'); return; }
      window.busa.submit({ client_name: name, phone: phone, notes: notes });
      document.getElementById('f').style.display = 'none';
      document.getElementById('ok').style.display = 'block';
    });
  </script>
</body>
</html>`,
    },
  },
];

// ── Review discussion ────────────────────────────────────────────────────────

const INSURANCE_COMMENTS: SeedCommentDef[] = [
  {
    id: "com_seed_ins_requote_1",
    subjectType: "change_request",
    subjectId: INSURANCE_REQUOTE_CR_ID,
    authorId: "renewal-assistant-agent",
    body: "Loss runs are attached to the policy record. Three carriers quoted; Northwind at +9% with a higher deductible on the two claim vehicles is the best net outcome. Commission drops a point because I moved them to the fleet tier.",
    minutesAgo: 7,
  },
  {
    id: "com_seed_ins_requote_2",
    subjectType: "change_request",
    subjectId: INSURANCE_REQUOTE_CR_ID,
    authorId: "local-editor",
    body: "Good. Before I approve — does the higher deductible change anything in their contract with the shipper? I'd rather find out now than on the renewal call.",
    minutesAgo: 5,
  },
  {
    id: "com_seed_ins_intake_1",
    subjectType: "change_request",
    subjectId: INSURANCE_INTAKE_CR_ID,
    authorId: "local-editor",
    body: "Newly self-employed with no group health is a real gap, not a price shopper. Assigning to Dana — health plan first, income protection in the same conversation.",
    minutesAgo: 19,
  },
  {
    id: "com_seed_ins_policy_record_1",
    subjectType: "record",
    subjectId: INSURANCE_POLICY_SENIOR_HEALTH_ID,
    authorId: "local-viewer",
    body: "Underwriting still wants the cardiology follow-up before they'll firm this quote. Worth telling Gerald now so the timeline doesn't surprise him.",
    minutesAgo: 60,
  },
];

// ── Scenario ─────────────────────────────────────────────────────────────────

export const insuranceAgencyScenario: SeedScenario = {
  folders: INSURANCE_FOLDERS,
  bases: INSURANCE_BASES,
  records: INSURANCE_RECORDS,
  views: INSURANCE_VIEWS,
  changeRequests: INSURANCE_CHANGE_REQUESTS,
  docs: INSURANCE_DOCS,
  files: INSURANCE_FILES,
  fileTreeNodes: INSURANCE_FILE_TREE_NODES,
  richNodes: INSURANCE_RICH_NODES,
  forms: INSURANCE_FORMS,
  comments: INSURANCE_COMMENTS,
};
