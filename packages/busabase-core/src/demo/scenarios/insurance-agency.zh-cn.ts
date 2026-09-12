// 简体中文的保险代理／经纪展业场景。与英文版 (`insurance-agency.ts`) 共用同一套
// 结构性 id（folder/base/record/commit/change request/node id），内容是中文、金额
// 用人民币，数据可以与英文版不一致 —— 这与 finance-invoice.ts / finance-invoice.zh-cn.ts
// 的分工完全一致。
//
// 无用户可见文案的部分（AirApp 的静态服务器、样式表、package.json，以及白板卡片
// 生成器）直接复用英文文件的导出，避免两份大段字符串各自漂移。
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
import {
  DEMO_INSURANCE_CLIENTS_BASE_ID,
  DEMO_INSURANCE_CLIENTS_BASE_NODE_ID,
  DEMO_INSURANCE_FOLDER_NODE_ID,
  DEMO_INSURANCE_POLICIES_BASE_ID,
  DEMO_INSURANCE_POLICIES_BASE_NODE_ID,
  DEMO_INSURANCE_RENEWALS_BASE_ID,
  DEMO_INSURANCE_RENEWALS_BASE_NODE_ID,
  INSURANCE_AIRAPP_NODE_ID,
  INSURANCE_CLIENT_BUSINESS_OWNER_COMMIT_ID,
  INSURANCE_CLIENT_BUSINESS_OWNER_ID,
  INSURANCE_CLIENT_EXPAT_COMMIT_ID,
  INSURANCE_CLIENT_EXPAT_ID,
  INSURANCE_CLIENT_FLEET_MANAGER_COMMIT_ID,
  INSURANCE_CLIENT_FLEET_MANAGER_ID,
  INSURANCE_CLIENT_NEW_PARENTS_COMMIT_ID,
  INSURANCE_CLIENT_NEW_PARENTS_ID,
  INSURANCE_CLIENT_PRE_RETIREE_COMMIT_ID,
  INSURANCE_CLIENT_PRE_RETIREE_ID,
  INSURANCE_COMMISSION_EXPRESSION,
  INSURANCE_COMMISSION_FILE_NODE_ID,
  INSURANCE_DRIVE_NODE_ID,
  INSURANCE_FORM_ID,
  INSURANCE_FORM_NODE_ID,
  INSURANCE_HTML_NODE_ID,
  INSURANCE_INTAKE_CR_ID,
  INSURANCE_PLAYBOOK_CR_ID,
  INSURANCE_PLAYBOOK_DOC_NODE_ID,
  INSURANCE_POLICY_CRITICAL_ILLNESS_COMMIT_ID,
  INSURANCE_POLICY_CRITICAL_ILLNESS_ID,
  INSURANCE_POLICY_FLEET_AUTO_COMMIT_ID,
  INSURANCE_POLICY_FLEET_AUTO_ID,
  INSURANCE_POLICY_KEYMAN_COMMIT_ID,
  INSURANCE_POLICY_KEYMAN_ID,
  INSURANCE_POLICY_SENIOR_HEALTH_COMMIT_ID,
  INSURANCE_POLICY_SENIOR_HEALTH_ID,
  INSURANCE_POLICY_TERM_LIFE_COMMIT_ID,
  INSURANCE_POLICY_TERM_LIFE_ID,
  INSURANCE_POLICY_TRAVEL_COMMIT_ID,
  INSURANCE_POLICY_TRAVEL_ID,
  INSURANCE_PRODUCT_MATRIX_DOC_NODE_ID,
  INSURANCE_RENEWAL_FLEET_COMMIT_ID,
  INSURANCE_RENEWAL_FLEET_ID,
  INSURANCE_RENEWAL_KEYMAN_COMMIT_ID,
  INSURANCE_RENEWAL_KEYMAN_ID,
  INSURANCE_RENEWAL_SENIOR_HEALTH_COMMIT_ID,
  INSURANCE_RENEWAL_SENIOR_HEALTH_ID,
  INSURANCE_RENEWAL_TRAVEL_COMMIT_ID,
  INSURANCE_RENEWAL_TRAVEL_ID,
  INSURANCE_REQUOTE_CR_ID,
  INSURANCE_SKILL_CR_ID,
  INSURANCE_SKILL_NODE_ID,
  INSURANCE_UNDERWRITING_FILE_NODE_ID,
  INSURANCE_WHITEBOARD_NODE_ID,
  INSURANCE_WORKFLOW_NODE_ID,
  RENEWAL_BOARD_PACKAGE_JSON,
  RENEWAL_BOARD_SERVER_JS,
  RENEWAL_BOARD_STYLE_CSS,
  whiteboardCard,
  withComputedCommission,
} from "./insurance-agency";

// ── 目录 ─────────────────────────────────────────────────────────────────────

const INSURANCE_FOLDERS: SeedFolderDef[] = [
  {
    nodeId: DEMO_INSURANCE_FOLDER_NODE_ID,
    slug: "insurance",
    name: "保险展业",
    description: "代理人的客户名册、在保保单，以及让保单留下来的续保动作。",
    position: 7,
  },
];

// ── 字段 ─────────────────────────────────────────────────────────────────────

const clientFields = [
  {
    id: "bsf_ins_client_name",
    slug: "client_name",
    name: "客户",
    type: "text",
    required: true,
    options: {},
  },
  {
    id: "bsf_ins_client_phone",
    slug: "phone",
    name: "手机号",
    type: "phone",
    required: false,
    options: {},
  },
  {
    id: "bsf_ins_client_email",
    slug: "email",
    name: "邮箱",
    type: "email",
    required: false,
    options: {},
  },
  {
    id: "bsf_ins_client_stage",
    slug: "stage",
    name: "阶段",
    type: "select",
    required: false,
    options: {
      choices: [
        { id: "lead", name: "线索", color: "slate" },
        { id: "contacted", name: "已联系", color: "sky" },
        { id: "needs-analysis", name: "需求分析", color: "violet" },
        { id: "proposal", name: "已出计划书", color: "amber" },
        { id: "insured", name: "已承保", color: "emerald" },
        { id: "lost", name: "已流失", color: "rose" },
      ],
    },
  },
  {
    id: "bsf_ins_client_source",
    slug: "source",
    name: "来源",
    type: "select",
    required: false,
    options: {
      choices: [
        { id: "referral", name: "老客户转介绍", color: "emerald" },
        { id: "community", name: "社群活动", color: "sky" },
        { id: "social", name: "内容获客", color: "violet" },
        { id: "orphan-book", name: "孤儿单承接", color: "amber" },
        { id: "walk-in", name: "到店咨询", color: "slate" },
      ],
    },
  },
  {
    id: "bsf_ins_client_focus",
    slug: "protection_focus",
    name: "保障方向",
    type: "multiselect",
    required: false,
    options: {
      choices: [
        { id: "life", name: "寿险", color: "sky" },
        { id: "health", name: "健康险", color: "emerald" },
        { id: "auto", name: "车险", color: "amber" },
        { id: "property", name: "财产险", color: "violet" },
        { id: "travel", name: "旅行险", color: "rose" },
        { id: "retirement", name: "养老", color: "slate" },
      ],
    },
  },
  {
    id: "bsf_ins_client_budget",
    slug: "annual_budget",
    name: "年度预算",
    type: "number",
    required: false,
    options: { number: { format: "currency", currency: "CNY", locale: "zh-CN" } },
  },
  {
    id: "bsf_ins_client_next_follow_up",
    slug: "next_follow_up",
    name: "下次跟进",
    type: "date",
    required: false,
    options: {},
  },
  {
    id: "bsf_ins_client_advisor",
    slug: "advisor",
    name: "顾问",
    type: "text",
    required: false,
    options: {},
  },
  {
    id: "bsf_ins_client_policies",
    slug: "policies",
    name: "保单",
    type: "relation",
    required: false,
    options: { multiple: true, targetBaseId: DEMO_INSURANCE_POLICIES_BASE_ID },
  },
  // 代理人真正被考核的两个数字。都用 lookup 而不是存储列：保费一改，这两个数就
  // 得跟着动，这正是读时汇总该干的事。
  {
    id: "bsf_ins_client_policy_count",
    slug: "policy_count",
    name: "在保保单数",
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
    name: "在保保费",
    type: "lookup",
    required: false,
    options: {
      lookup: {
        relationFieldSlug: "policies",
        targetFieldSlug: "premium",
        rollup: "sum",
      },
      number: { format: "currency", currency: "CNY" },
    },
  },
  {
    id: "bsf_ins_client_notes",
    slug: "notes",
    name: "顾问备注",
    type: "longtext",
    required: false,
    options: {},
  },
  {
    id: "bsf_ins_client_ai_summary",
    slug: "ai_summary",
    name: "AI 摘要",
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
    name: "保单号",
    type: "text",
    required: true,
    options: {},
  },
  {
    id: "bsf_ins_policy_client",
    slug: "client",
    name: "客户",
    type: "relation",
    required: false,
    options: { multiple: false, targetBaseId: DEMO_INSURANCE_CLIENTS_BASE_ID },
  },
  {
    id: "bsf_ins_policy_insurer",
    slug: "insurer",
    name: "承保公司",
    type: "text",
    required: false,
    options: {},
  },
  {
    id: "bsf_ins_policy_product",
    slug: "product",
    name: "产品",
    type: "text",
    required: false,
    options: {},
  },
  {
    id: "bsf_ins_policy_line",
    slug: "product_line",
    name: "险种",
    type: "select",
    required: false,
    options: {
      choices: [
        { id: "life", name: "寿险", color: "sky" },
        { id: "health", name: "健康险", color: "emerald" },
        { id: "auto", name: "车险", color: "amber" },
        { id: "property", name: "财产险", color: "violet" },
        { id: "travel", name: "旅行险", color: "rose" },
      ],
    },
  },
  {
    id: "bsf_ins_policy_premium",
    slug: "premium",
    name: "年保费",
    type: "number",
    required: false,
    options: { number: { format: "currency", currency: "CNY", locale: "zh-CN" } },
  },
  {
    id: "bsf_ins_policy_sum_insured",
    slug: "sum_insured",
    name: "保额",
    type: "number",
    required: false,
    options: { number: { format: "currency", currency: "CNY", locale: "zh-CN" } },
  },
  {
    id: "bsf_ins_policy_commission_rate",
    slug: "commission_rate",
    name: "佣金比例（%）",
    type: "number",
    required: false,
    options: { number: { format: "plain" } },
  },
  // 单位写在字段名里，不写 `options.number`：单元格渲染只对 `number` 和 `lookup`
  // 字段套用货币格式（见 dashboard/helpers/field.ts），写在这里是失效配置。
  {
    id: "bsf_ins_policy_commission_amount",
    slug: "commission_amount",
    name: "佣金（元）",
    type: "formula",
    required: false,
    options: { formula: { expression: INSURANCE_COMMISSION_EXPRESSION } },
  },
  {
    id: "bsf_ins_policy_effective_date",
    slug: "effective_date",
    name: "生效日",
    type: "date",
    required: false,
    options: {},
  },
  {
    id: "bsf_ins_policy_renewal_date",
    slug: "renewal_date",
    name: "续保日",
    type: "date",
    required: false,
    options: {},
  },
  {
    id: "bsf_ins_policy_status",
    slug: "status",
    name: "状态",
    type: "select",
    required: false,
    options: {
      choices: [
        { id: "quoting", name: "报价中", color: "slate" },
        { id: "underwriting", name: "核保中", color: "amber" },
        { id: "active", name: "有效", color: "emerald" },
        { id: "lapsed", name: "已失效", color: "rose" },
        { id: "renewed", name: "已续保", color: "sky" },
      ],
    },
  },
  {
    id: "bsf_ins_policy_file",
    slug: "policy_file",
    name: "保单文件",
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
    name: "核保备注",
    type: "longtext",
    required: false,
    options: {},
  },
] satisfies SeedBaseDef["fields"];

const renewalFields = [
  {
    id: "bsf_ins_renewal_task",
    slug: "task",
    name: "任务",
    type: "text",
    required: true,
    options: {},
  },
  {
    id: "bsf_ins_renewal_policy",
    slug: "policy",
    name: "保单",
    type: "relation",
    required: false,
    options: { multiple: false, targetBaseId: DEMO_INSURANCE_POLICIES_BASE_ID },
  },
  {
    id: "bsf_ins_renewal_due_date",
    slug: "due_date",
    name: "截止日",
    type: "date",
    required: false,
    options: {},
  },
  {
    id: "bsf_ins_renewal_channel",
    slug: "channel",
    name: "触达方式",
    type: "select",
    required: false,
    options: {
      choices: [
        { id: "call", name: "电话", color: "sky" },
        { id: "message", name: "微信", color: "emerald" },
        { id: "email", name: "邮件", color: "violet" },
        { id: "in-person", name: "面谈", color: "amber" },
      ],
    },
  },
  {
    id: "bsf_ins_renewal_status",
    slug: "status",
    name: "状态",
    type: "select",
    required: false,
    options: {
      choices: [
        { id: "todo", name: "待处理", color: "slate" },
        { id: "in-progress", name: "进行中", color: "amber" },
        { id: "done", name: "已完成", color: "emerald" },
        { id: "deferred", name: "已延期", color: "rose" },
      ],
    },
  },
  {
    id: "bsf_ins_renewal_owner",
    slug: "owner",
    name: "负责人",
    type: "text",
    required: false,
    options: {},
  },
  {
    id: "bsf_ins_renewal_outcome",
    slug: "outcome",
    name: "跟进结果",
    type: "longtext",
    required: false,
    options: {},
  },
] satisfies SeedBaseDef["fields"];

// ── 数据表 ───────────────────────────────────────────────────────────────────

const INSURANCE_BASES: SeedBaseDef[] = [
  {
    id: DEMO_INSURANCE_CLIENTS_BASE_ID,
    nodeId: DEMO_INSURANCE_CLIENTS_BASE_NODE_ID,
    slug: "insurance-clients",
    name: "客户档案",
    description: "潜在客户与已承保家庭，每位客户的在保保单自动汇总。",
    folderNodeId: DEMO_INSURANCE_FOLDER_NODE_ID,
    useCases: ["insurance"],
    fields: clientFields,
  },
  {
    id: DEMO_INSURANCE_POLICIES_BASE_ID,
    nodeId: DEMO_INSURANCE_POLICIES_BASE_NODE_ID,
    slug: "insurance-policies",
    name: "保单台账",
    description: "代理签下的每一张保单：保费、保额、续保日，以及对应的佣金。",
    folderNodeId: DEMO_INSURANCE_FOLDER_NODE_ID,
    useCases: ["insurance"],
    fields: policyFields,
  },
  {
    id: DEMO_INSURANCE_RENEWALS_BASE_ID,
    nodeId: DEMO_INSURANCE_RENEWALS_BASE_NODE_ID,
    slug: "insurance-renewals",
    name: "续保跟进",
    description: "让保单不在续保节点掉队的触达队列。",
    folderNodeId: DEMO_INSURANCE_FOLDER_NODE_ID,
    useCases: ["insurance"],
    fields: renewalFields,
  },
];

// ── 记录 ─────────────────────────────────────────────────────────────────────

const FLEET_AUTO_BASE_FIELDS = withComputedCommission({
  client: [INSURANCE_CLIENT_FLEET_MANAGER_ID],
  commission_rate: 12,
  effective_date: "2025-12-01",
  insurer: "北辰财险",
  notes: "18 台厢式货车，去年两次全责事故。承保方已提示续保涨价，出方案前必须重新询价。",
  policy_number: "POL-AUTO-2025-0914",
  policy_file: [
    {
      id: "att_seed_ins_policy_fleet",
      attachmentId: "att_seed_ins_policy_fleet",
      fileName: "车队保单-2025.pdf",
      mimeType: "application/pdf",
      size: 512_000,
      url: "/assets/readme/scenarios/finance-review-record.png",
    },
  ],
  premium: 296000,
  product: "商用车队车险",
  product_line: "auto",
  renewal_date: "2026-12-01",
  status: "active",
  sum_insured: 6500000,
});

const FLEET_AUTO_REQUOTE_FIELDS = withComputedCommission({
  ...FLEET_AUTO_BASE_FIELDS,
  commission_rate: 11,
  notes:
    "调取出险记录后向三家公司重新询价。北辰把涨幅从最初的 +23% 压到 +9%，条件是两台出险车辆提高免赔额。",
  premium: 322600,
  status: "underwriting",
});

const INSURANCE_RECORDS: SeedRecordDef[] = [
  {
    id: INSURANCE_CLIENT_NEW_PARENTS_ID,
    baseId: DEMO_INSURANCE_CLIENTS_BASE_ID,
    commitId: INSURANCE_CLIENT_NEW_PARENTS_COMMIT_ID,
    fields: {
      advisor: "chen.jia@busabase.local",
      ai_summary: "背房贷的新手父母、单收入结构，定期寿险打底加重疾是第一层该配的保障。",
      annual_budget: 24000,
      client_name: "林岚 & 周予安",
      email: "linlan@example.com",
      next_follow_up: "2026-09-15",
      notes:
        "三月刚添了孩子。房贷还有 22 年，目前只有周予安一份收入。希望用最省的结构覆盖房贷加五年生活费。",
      phone: "138-0013-0142",
      policies: [INSURANCE_POLICY_TERM_LIFE_ID, INSURANCE_POLICY_CRITICAL_ILLNESS_ID],
      protection_focus: ["life", "health"],
      source: "referral",
      stage: "insured",
    },
    message: "录入已承保家庭：定期寿险 + 重疾",
    author: "seed-insurance",
    minutesAgo: 210,
    useCases: ["insurance"],
  },
  {
    id: INSURANCE_CLIENT_BUSINESS_OWNER_ID,
    baseId: DEMO_INSURANCE_CLIENTS_BASE_ID,
    commitId: INSURANCE_CLIENT_BUSINESS_OWNER_COMMIT_ID,
    fields: {
      advisor: "chen.jia@busabase.local",
      ai_summary: "银行要求二店扩张贷款放款前落实关键人保障的小微企业主。",
      annual_budget: 80000,
      client_name: "阮清（清和烘焙）",
      email: "ruanqing@qinghe.example.com",
      next_follow_up: "2026-09-17",
      notes:
        "银行要求二店扩张贷款放款前先把关键人保障做掉。另外问过九名员工的团体医疗——那是另一轮沟通，不要塞进这份计划书。",
      phone: "139-0013-0188",
      policies: [INSURANCE_POLICY_KEYMAN_ID],
      protection_focus: ["life", "property"],
      source: "community",
      stage: "insured",
    },
    message: "录入配置关键人保障的小微企业主",
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
      ai_summary: "续保面临涨价的车队客户——这次重新询价结果决定它留不留得住。",
      annual_budget: 340000,
      client_name: "海岚物流",
      email: "ops@hailan.example.com",
      next_follow_up: "2026-09-14",
      notes:
        "保费体量最大的客户。去年两次全责事故，承保方提示涨价。如果我们带回去的涨幅超过 10%，他们会全市场比价。",
      phone: "021-5555-0110",
      policies: [INSURANCE_POLICY_FLEET_AUTO_ID],
      protection_focus: ["auto", "property"],
      source: "referral",
      stage: "insured",
    },
    message: "录入即将续保的车队客户",
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
      ai_summary: "临退休客户在中老年医疗和年金之间比较，计划书已发出、等决定。",
      annual_budget: 52000,
      client_name: "高文远",
      email: "gaowenyuan@example.com",
      next_follow_up: "2026-09-16",
      notes:
        "还有 14 个月退休。正在把我们的中老年医疗计划和银行推的年金作比较。对附加险价格敏感，对主险不敏感。",
      phone: "136-0013-0164",
      policies: [INSURANCE_POLICY_SENIOR_HEALTH_ID],
      protection_focus: ["health", "retirement"],
      source: "orphan-book",
      stage: "proposal",
    },
    message: "录入计划书待决策的临退休客户",
    author: "seed-insurance",
    minutesAgo: 195,
    useCases: ["insurance"],
  },
  {
    id: INSURANCE_CLIENT_EXPAT_ID,
    baseId: DEMO_INSURANCE_CLIENTS_BASE_ID,
    commitId: INSURANCE_CLIENT_EXPAT_COMMIT_ID,
    fields: {
      advisor: "chen.jia@busabase.local",
      ai_summary: "常年出差的年度多次旅行险客户，下一步是国际医疗补充。",
      annual_budget: 16000,
      client_name: "苏霓",
      email: "suni@example.com",
      next_follow_up: "2026-09-28",
      notes:
        "一年有九个月在外出差。年度多次往返旅行险已顺利续保。等新合同签下来后，愿意谈国际医疗补充。",
      phone: "135-0013-0177",
      policies: [INSURANCE_POLICY_TRAVEL_ID],
      protection_focus: ["travel", "health"],
      source: "social",
      stage: "needs-analysis",
    },
    message: "录入高频出行客户",
    author: "seed-insurance",
    minutesAgo: 190,
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
      insurer: "明德人寿",
      notes: "标准体非吸烟费率。走简易核保通道，免体检。",
      policy_number: "POL-LIFE-2026-0415",
      premium: 8400,
      product: "20 年定期寿险",
      product_line: "life",
      renewal_date: "2027-04-15",
      status: "active",
      sum_insured: 5000000,
    }),
    message: "录入生效中的定期寿险",
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
      insurer: "明德人寿",
      notes: "覆盖 32 种疾病，90 天等待期。作为定期寿险的附加险。",
      policy_number: "POL-CI-2026-0415",
      premium: 6800,
      product: "重疾附加险",
      product_line: "health",
      renewal_date: "2027-04-15",
      status: "active",
      sum_insured: 800000,
    }),
    message: "录入重疾附加险",
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
      insurer: "瑞和人寿",
      notes: "扩张贷款结清前，银行为受益权受让方。转让函已存在资料库 Drive 里。",
      policy_number: "POL-KEY-2026-0201",
      premium: 38000,
      product: "关键人寿险",
      product_line: "life",
      renewal_date: "2027-02-01",
      status: "active",
      sum_insured: 7000000,
    }),
    message: "录入关键人保单",
    author: "seed-insurance",
    minutesAgo: 183,
    useCases: ["insurance"],
  },
  {
    id: INSURANCE_POLICY_FLEET_AUTO_ID,
    baseId: DEMO_INSURANCE_POLICIES_BASE_ID,
    commitId: INSURANCE_POLICY_FLEET_AUTO_COMMIT_ID,
    fields: FLEET_AUTO_BASE_FIELDS,
    message: "录入即将续保的车队保单",
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
      insurer: "瑞和人寿",
      notes: "含齿科附加险与不含两套报价都出了。核保要求补充 2024 年那次心内科转诊的说明。",
      policy_number: "POL-HLTH-2026-0620",
      premium: 43000,
      product: "中老年医疗计划",
      product_line: "health",
      renewal_date: "2027-09-20",
      status: "quoting",
      sum_insured: 1800000,
    }),
    message: "录入待决策的中老年医疗报价",
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
      insurer: "北辰财险",
      notes: "年度多次往返，单次行程最长 90 天，含冬季运动附加险。",
      policy_number: "POL-TRV-2026-0505",
      premium: 5600,
      product: "年度多次旅行险",
      product_line: "travel",
      renewal_date: "2027-05-05",
      status: "renewed",
      sum_insured: 1500000,
    }),
    message: "录入已续保的旅行险",
    author: "seed-insurance",
    minutesAgo: 180,
    useCases: ["insurance"],
  },

  {
    id: INSURANCE_RENEWAL_FLEET_ID,
    baseId: DEMO_INSURANCE_RENEWALS_BASE_ID,
    commitId: INSURANCE_RENEWAL_FLEET_COMMIT_ID,
    fields: {
      channel: "call",
      due_date: "2026-10-10",
      outcome: "出险记录已调取并发给三家公司。等北辰给最终报价后再约续保面谈。",
      owner: "marco.silva@busabase.local",
      policy: [INSURANCE_POLICY_FLEET_AUTO_ID],
      status: "in-progress",
      task: "海岚车队续保前重新询价",
    },
    message: "录入进行中的车队续保任务",
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
      task: "当面给高文远讲清医疗计划与年金的差别",
    },
    message: "录入待处理的计划书跟进",
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
      outcome: "按原保费续保。国际医疗补充等她新合同签完再谈。",
      owner: "chen.jia@busabase.local",
      policy: [INSURANCE_POLICY_TRAVEL_ID],
      status: "done",
      task: "确认年度旅行险续保",
    },
    message: "录入已完成的旅行险续保",
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
      outcome: "等银行确认贷款余额后再议——受让金额取决于这个数。",
      owner: "chen.jia@busabase.local",
      policy: [INSURANCE_POLICY_KEYMAN_ID],
      status: "deferred",
      task: "按贷款余额复核关键人保额",
    },
    message: "录入已延期的关键人保额复核",
    author: "seed-insurance",
    minutesAgo: 90,
    useCases: ["insurance"],
  },
];

// ── 视图 ─────────────────────────────────────────────────────────────────────

const INSURANCE_VIEWS: SeedViewDef[] = [
  {
    id: "viw_seed_ins_client_pipeline",
    baseId: DEMO_INSURANCE_CLIENTS_BASE_ID,
    slug: "pipeline",
    name: "客户漏斗",
    description: "所有客户按「从首次接触到已承保」的阶段分栏。",
    type: "kanban",
    config: { filters: [], sorts: [], stackByFieldSlug: "stage" },
    minutesAgo: 175,
    useCases: ["insurance"],
  },
  {
    id: "viw_seed_ins_client_follow_ups",
    baseId: DEMO_INSURANCE_CLIENTS_BASE_ID,
    slug: "follow-ups",
    name: "跟进日历",
    description: "客户按下次该联系的日子落在月历上。",
    type: "calendar",
    config: { filters: [], sorts: [], dateFieldSlug: "next_follow_up" },
    minutesAgo: 174,
    useCases: ["insurance"],
  },
  {
    id: "viw_seed_ins_client_open_proposals",
    baseId: DEMO_INSURANCE_CLIENTS_BASE_ID,
    slug: "open-proposals",
    name: "待决策计划书",
    description: "已出计划书但还没给答复的客户——最容易放凉的一档。",
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
    name: "保单看板",
    description: "保单按状态分栏，从报价一路到已续保。",
    type: "kanban",
    config: { filters: [], sorts: [], stackByFieldSlug: "status" },
    minutesAgo: 172,
    useCases: ["insurance"],
  },
  {
    id: "viw_seed_ins_policy_renewals_due",
    baseId: DEMO_INSURANCE_POLICIES_BASE_ID,
    slug: "renewals-due",
    name: "待续保",
    description: "有效保单按续保日排序——代理人每天要看的那张表。",
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
    name: "保障期间",
    description: "每张保单从生效日画到续保日。",
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
    name: "续保看板",
    description: "触达队列按状态分栏。",
    type: "kanban",
    config: { filters: [], sorts: [], stackByFieldSlug: "status" },
    minutesAgo: 169,
    useCases: ["insurance"],
  },
];

// ── 变更请求 ─────────────────────────────────────────────────────────────────

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
        message: "车队续保重新询价：涨幅 +9%，两台出险车提高免赔额",
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
          annual_budget: 14000,
          client_name: "欧阳一鸣",
          email: "ouyang@example.com",
          next_follow_up: "2026-09-22",
          notes:
            "从咨询表单提交：刚转做自由职业，离职后丢了团体医疗，想配一份医疗险再加收入损失保障。",
          phone: "137-0013-0129",
          protection_focus: ["health", "life"],
          source: "social",
          stage: "lead",
        },
        message: "官网咨询表单新提交的咨询请求",
        author: "intake-form",
      },
    ],
  },
];

// ── 文档 ─────────────────────────────────────────────────────────────────────

const ADVISOR_PLAYBOOK_BODY = `# 展业作业手册

这家代理机构怎么把一个客户从首次接触，带到一张能长期留存的保单。

## 1. 先做需求分析，再谈产品

不要一上来就讲产品。先把收入、负债、被抚养人和已有保障问清楚，再把缺口摆出来。
一份说不清自己补的是哪个缺口的计划书，最后只会被拿去比价格。

## 2. 给两个方案，不要给五个

一个方案像推销，五个方案像作业。带上推荐结构和一个更便宜的替代方案，并且明确
说出更便宜的那个放弃了什么。

## 3. 续保从 90 天前开始

拖到最后一周才联系的续保是一场价格谈判；提前 90 天联系的续保才是一次检视——
那是代理人还来得及调整风险、免赔额或承保公司的唯一窗口。

## 4. 所有改动都走评审

保费、保额、换承保公司，都以变更请求的方式提出，不在原地直接改。客户的档案必须
能看出谁在什么时候改了什么、为什么改——一年之后，这是面对「我从没同意过」时
唯一站得住的东西。
`;

const INSURANCE_DOCS: SeedDocDef[] = [
  {
    nodeId: INSURANCE_PLAYBOOK_DOC_NODE_ID,
    slug: "advisor-playbook",
    name: "展业作业手册",
    description: "把客户从首次接触带到一张长期留存保单的标准动作。",
    position: 3,
    body: ADVISOR_PLAYBOOK_BODY,
    changeRequest: {
      id: INSURANCE_PLAYBOOK_CR_ID,
      operationId: "opr_seed_ins_doc_playbook",
      commitId: "cmt_seed_ins_doc_playbook",
      submittedBy: "renewal-assistant-agent",
      minutesAgo: 12,
      message: "为展业作业手册补充「失效挽回」一节",
      nextBody: `${ADVISOR_PLAYBOOK_BODY}
## 5. 失效挽回

保单失效不等于客户流失。30 天内联系上，先讲清失效真正的代价（复效要重新核保、
等待期重算），再提出让保费可持续的最小改动——降保额也好过没保障。
`,
    },
  },
  {
    nodeId: INSURANCE_PRODUCT_MATRIX_DOC_NODE_ID,
    slug: "product-matrix",
    name: "产品对照表",
    description: "每个险种主推哪家承保公司，以及各自的短板在哪。",
    position: 4,
    body: `# 产品对照表

每条产品线主推谁，以及必须如实告知的那条短板。

## 寿险

- **明德人寿** —— 简易核保通道最快，100 万以下免体检。次标准体定价偏弱。
- **瑞和人寿** —— 关键人、受益权转让类案子首选；核保偏慢（10–15 个工作日）。

## 健康险

- **瑞和人寿** —— 网络医院覆盖广，中老年计划强。齿科附加险定价高于市场。
- **明德人寿** —— 与定期寿险同时投保时，重疾附加险价格有优势。

## 车险与财产险

- **北辰财险** —— 这里唯一能承接 25 台以下商用车队的公司。出险后的涨幅很陡，
  续保前务必先调出险记录。

## 旅行险

- **北辰财险** —— 年度多次往返，含冬季运动附加险，单次行程上限 90 天。

这份文档靠变更请求保持更新——过期的对照表，最后就是把客户报到错的承保公司那里。
`,
  },
];

// ── 文件 ─────────────────────────────────────────────────────────────────────

const INSURANCE_FILES: SeedFileDef[] = [
  {
    nodeId: INSURANCE_COMMISSION_FILE_NODE_ID,
    slug: "commission-ledger",
    name: "佣金台账",
    description: "CSV 文件节点——每张成交保单实际结了多少佣金。",
    fileName: "佣金台账.csv",
    mimeType: "text/csv",
    attachmentId: "att_seed_ins_commission_ledger",
    assetId: "ast_seed_ins_commission_ledger",
    storageKey: "attachments/blobs/seed/commission-ledger.csv",
    position: 3,
    body: `保单号,险种,年保费,佣金比例,佣金,结算日
POL-LIFE-2026-0415,寿险,8400,35,2940.00,2026-05-01
POL-CI-2026-0415,健康险,6800,28,1904.00,2026-05-01
POL-KEY-2026-0201,寿险,38000,22,8360.00,2026-03-01
POL-AUTO-2025-0914,车险,296000,12,35520.00,2025-12-15
POL-TRV-2026-0505,旅行险,5600,15,840.00,2026-06-01
`,
  },
  {
    nodeId: INSURANCE_UNDERWRITING_FILE_NODE_ID,
    slug: "underwriting-rules",
    name: "核保速查表",
    description: "JSON 文件节点——什么情况要体检、什么情况要转人工核保的阈值。",
    fileName: "核保速查表.json",
    mimeType: "application/json",
    attachmentId: "att_seed_ins_underwriting_rules",
    assetId: "ast_seed_ins_underwriting_rules",
    storageKey: "attachments/blobs/seed/underwriting-rules.json",
    position: 4,
    body: `{
  "寿险": {
    "免体检保额上限": 1000000,
    "简易核保最高年龄": 50,
    "吸烟加费": "1.6 倍"
  },
  "健康险": {
    "等待期天数": 90,
    "转人工核保的既往史": ["心内科", "肿瘤科", "减重手术"]
  },
  "车险": {
    "车队最少车辆数": 5,
    "必须调取出险记录": true,
    "全责事故几次后转人工": 2
  }
}
`,
  },
];

// ── Skill / Drive / AirApp ───────────────────────────────────────────────────

const RENEWAL_ASSISTANT_SKILL_MD = `---
name: policy-renewal-assistant
description: 为保单准备续保建议，并提交给代理人评审。
---

# 续保助手

当保单台账里的某张保单进入续保日前 90 天、需要在代理人打电话之前先出一份建议时，
使用这个 Skill。

## 工作流程

1. 读保单记录：保费、保额、状态、核保备注。
2. 读它关联的客户记录：预算、保障方向、顾问备注。
3. 查「产品对照表」文档，确认这条产品线该主推哪家承保公司。
4. 以变更请求的形式提出续保建议：新保费、涨价原因，以及若选更便宜的结构会放弃什么。

## 规则

- 变更请求里没写明理由，就不要改保费或保额。
- 涨幅超过 10% 时，先至少向另外两家公司重新询价。
- 始终给代理人留一句可以直接照着说的开场话术。
`;

const RENEWAL_BOARD_INDEX_HTML = `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>续保看板</title>
    <link rel="stylesheet" href="style.css" />
  </head>
  <body>
    <header>
      <span class="badge">AirApp · 实时工作区数据</span>
      <h1>续保看板</h1>
      <p>通过 Busabase REST API 读取本工作区自己的「insurance-policies」数据表——不是预置数据，也不是假数据。</p>
    </header>
    <div id="board"></div>
    <script src="client.js"></script>
  </body>
</html>
`;

const RENEWAL_BOARD_CLIENT_JS = `const STATUSES = [
  { id: "quoting", label: "报价中" },
  { id: "underwriting", label: "核保中" },
  { id: "active", label: "有效" },
  { id: "renewed", label: "已续保" },
  { id: "lapsed", label: "已失效" },
];

const board = document.getElementById("board");

function money(n) {
  return typeof n === "number" ? "¥" + n.toLocaleString("zh-CN") : "—";
}

function daysUntil(dateString) {
  if (!dateString) return null;
  const target = new Date(dateString);
  if (Number.isNaN(target.getTime())) return null;
  return Math.round((target.getTime() - Date.now()) / 86400000);
}

function showEmpty(message) {
  board.innerHTML = "";
  const div = document.createElement("div");
  div.id = "empty";
  div.textContent = message;
  board.replaceWith(div);
}

async function loadPolicies() {
  const basesRes = await fetch("/api/v1/bases");
  if (!basesRes.ok) throw new Error("GET /api/v1/bases → " + basesRes.status);
  const bases = await basesRes.json();
  const policies = bases.find((b) => b.slug === "insurance-policies");
  if (!policies) {
    showEmpty(
      '本工作区里没有找到「insurance-policies」数据表。这个示例读的是真实数据表——先播种标准演示数据（保险展业目录）再看。',
    );
    return;
  }

  const recordsRes = await fetch("/api/v1/records?baseId=" + policies.id + "&limit=100");
  if (!recordsRes.ok) throw new Error("GET /api/v1/records → " + recordsRes.status);
  const { records } = await recordsRes.json();

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
      item.querySelector(".name").textContent = fields.product || fields.policy_number || "（未命名）";
      item.querySelector(".meta").textContent = [
        money(fields.premium),
        fields.insurer,
        remaining === null ? null : "距续保 " + remaining + " 天",
      ]
        .filter(Boolean)
        .join(" · ");
      column.appendChild(item);
    }
    board.appendChild(column);
  }
}

loadPolicies().catch((err) => showEmpty("读取保单失败：" + err.message));
`;

const INSURANCE_FILE_TREE_NODES: SeedFileTreeDef[] = [
  {
    nodeType: "skill",
    nodeId: INSURANCE_SKILL_NODE_ID,
    slug: "policy-renewal-assistant",
    name: "续保助手",
    description: "为保单准备续保建议，并提交给代理人评审。",
    position: 1,
    files: [
      { path: "SKILL.md", content: RENEWAL_ASSISTANT_SKILL_MD },
      {
        path: "skill.json",
        content: `${JSON.stringify(
          {
            name: "policy-renewal-assistant",
            description: "为保单准备续保建议，并提交给代理人评审。",
            version: "0.1.0",
          },
          null,
          2,
        )}\n`,
      },
      {
        path: "references/renewal-thresholds.md",
        content:
          "# 续保涨幅阈值\n\n| 涨幅 | 动作 |\n| --- | --- |\n| 5% 以内 | 原条件续保，告知客户即可 |\n| 5%–10% | 续保，但要在电话里讲清涨价原因 |\n| 超过 10% | 先向至少两家其他公司重新询价，再出方案 |\n\n只要车队有两次及以上全责事故，无论提示涨幅多少，都必须先调取出险记录。\n",
      },
      {
        path: "examples/renewal-note.md",
        content:
          "北辰把车队涨幅压在 +9%（最初提示是 +23%），做法是把两台出险车辆调到更高免赔额。最终年保费 322,600 元。开场话术：先讲免赔额的调整，再讲数字。\n",
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
## 适当性底线

- 不要在客户明确的保障方向之外推产品，除非说明理由。
- 不要为了凑预算直接降保额，除非同时写明这样会留下多大的保障缺口。
- 需要持证代理人判断的事项，标出来交给人，不要自己拍板。
`,
      message: "为续保助手补充适当性底线",
      scenario: "skill-file-update",
      workflow: "skill-governance",
    },
  },
  {
    nodeType: "drive",
    nodeId: INSURANCE_DRIVE_NODE_ID,
    slug: "insurance-materials",
    name: "客户资料库",
    description: "发给客户的模板、必须照抄的告知话术，以及出险报案清单。",
    position: 1,
    files: [
      {
        path: "README.md",
        content:
          "# 客户资料库\n\n所有会发给客户的东西都放在这一处、可评审，免得有人把过期的告知话术发出去。\n\n## 目录\n\n- `templates/proposal-outline.md` —— 每份计划书都照这个结构写\n- `compliance/disclosure-language.md` —— 必须逐字出现的告知话术\n- `claims/first-notice-checklist.md` —— 客户出险来电时要收集什么\n",
      },
      {
        path: "templates/proposal-outline.md",
        content:
          "# 计划书结构\n\n1. **缺口** —— 如果风险今天就发生，家庭财务上会缺多少。一段话，用他自己的数字，不出现任何产品名。\n2. **推荐方案** —— 产品、承保公司、保额、保费，以及为什么是这个结构。\n3. **更省的方案** —— 同一个缺口更便宜的补法，以及它具体放弃了什么。\n4. **接下来会发生什么** —— 核保步骤、预计时长、需要客户提供什么。\n5. **告知事项** —— 逐字取自 `compliance/disclosure-language.md`。\n\n永远不要跳过第 1 步。没有点名缺口的推荐，最后只会被拿去比价格。\n",
      },
      {
        path: "compliance/disclosure-language.md",
        content:
          "# 告知话术\n\n以下内容必须逐字出现在每一份书面计划书中：\n\n> 本计划书仅为便于比较的摘要。保障范围、责任免除与等待期，完全以保险公司出具的保单条款为准。所列保费为参考值，最终以核保结果为准。\n\n客户问起、或监管要求时的佣金告知：\n\n> 本机构的报酬由保险公司支付的佣金构成，按保费的一定比例计算。该佣金不会增加您所支付的保费。\n\n这两段都不要改写。要改就走变更请求，让措辞始终可追溯。\n",
      },
      {
        path: "claims/first-notice-checklist.md",
        content:
          "# 出险报案清单\n\n联系保险公司之前先收齐这些：\n\n- 保单号与被保险人联系方式\n- 出险时间、地点\n- 事情经过，用客户自己的话记录\n- 客户手上已有的照片或单据\n- 是否涉及第三方或相关部门，以及对应的编号\n\n然后：把理赔挂到对应保单记录上，告诉客户预计首次回复时间，并建一条跟进任务。没有跟进任务的理赔，最后都是客户在追我们。\n",
      },
    ],
  },
  {
    nodeType: "airapp",
    nodeId: INSURANCE_AIRAPP_NODE_ID,
    slug: "insurance-renewal-board",
    name: "续保看板",
    description:
      "通过公开 REST API 实时读取本工作区「insurance-policies」数据表的看板。零 npm 依赖。",
    position: 6,
    files: [
      { path: "package.json", content: RENEWAL_BOARD_PACKAGE_JSON },
      { path: "server.js", content: RENEWAL_BOARD_SERVER_JS },
      { path: "index.html", content: RENEWAL_BOARD_INDEX_HTML },
      { path: "style.css", content: RENEWAL_BOARD_STYLE_CSS },
      { path: "client.js", content: RENEWAL_BOARD_CLIENT_JS },
    ],
  },
];

// ── 白板 / 流程 / HTML ───────────────────────────────────────────────────────

const BOOK_OF_BUSINESS_CARDS: Array<[string, number, number, string, string, number]> = [
  ["households", 80, 130, "客户\n5 位客户 · 6 张保单", "#dcfce7", 301],
  ["renewals", 400, 130, "未来 90 天\n车队 · 中老年医疗", "#fef3c7", 302],
  ["gaps", 80, 330, "待补缺口\n收入损失 · 团体医疗", "#dbeafe", 303],
  ["referrals", 400, 330, "转介来源\n老客户 · 社群活动", "#fce7f3", 304],
];

const INSURANCE_RICH_NODES: SeedRichNodeDef[] = [
  {
    nodeType: "whiteboard",
    nodeId: INSURANCE_WHITEBOARD_NODE_ID,
    folderNodeId: DEMO_INSURANCE_FOLDER_NODE_ID,
    slug: "book-of-business",
    name: "客户全景白板",
    description: "代理人自己的那张图：谁已承保、下一个续保是谁、缺口还留在哪。",
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
            width: 280,
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
            text: "客户全景",
            fontSize: 28,
            fontFamily: 5,
            textAlign: "left",
            verticalAlign: "top",
            containerId: null,
            originalText: "客户全景",
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
    name: "续保触达流程",
    description: "续保前 90 天的标准流程：取保单、必要时重新询价、提交评审。",
    position: 4,
    metadata: {
      workflowDocument: {
        version: 2,
        nodes: [
          {
            id: "renewal-due",
            kind: "trigger",
            position: { x: 0, y: 80 },
            label: "距续保 90 天",
            description: "保单进入续保窗口时触发。",
            eventName: "policy.renewal_window",
          },
          {
            id: "pull-loss-runs",
            kind: "webhook",
            position: { x: 280, y: 80 },
            label: "调取出险记录",
            description: "向承保公司系统请求理赔历史。",
            method: "POST",
            url: "https://example.com/webhooks/carrier-loss-runs",
          },
          {
            id: "price-change",
            kind: "condition",
            position: { x: 560, y: 80 },
            label: "涨幅超过 10%？",
            description: "按承保公司给出的续保保费分支。",
            expression: "input.increasePct > 10",
          },
          {
            id: "requote",
            kind: "action",
            position: { x: 560, y: 260 },
            label: "全市场重新询价",
            description: "至少再收集两家公司的报价。",
            actionName: "requestQuotes",
          },
          {
            id: "propose",
            kind: "action",
            position: { x: 280, y: 260 },
            label: "提交续保方案",
            description: "以变更请求提出新保费与理由。",
            actionName: "createChangeRequest",
          },
          {
            id: "advisor-approval",
            kind: "approval",
            position: { x: 0, y: 260 },
            label: "代理人审批",
            description: "触达客户前，由持证代理人签字确认。",
            approver: "space-admin",
          },
          {
            id: "renewed",
            kind: "end",
            position: { x: 0, y: 440 },
            label: "方案已就绪",
            description: "带着已批准的建议去约客户面谈。",
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
            label: "理赔历史",
            outcome: "success",
          },
          {
            id: "condition-requote",
            source: "price-change",
            target: "requote",
            label: "超过 10%",
            outcome: "true",
          },
          {
            id: "condition-propose",
            source: "price-change",
            target: "propose",
            label: "10% 以内",
            outcome: "false",
          },
          {
            id: "requote-propose",
            source: "requote",
            target: "propose",
            label: "报价已齐",
            outcome: "success",
          },
          {
            id: "propose-approval",
            source: "propose",
            target: "advisor-approval",
            label: "已提交",
            outcome: "success",
          },
          {
            id: "approval-renewed",
            source: "advisor-approval",
            target: "renewed",
            label: "已批准",
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
    name: "一页纸计划书",
    description: "客户真正会看完的那一页计划书的 HTML 原型，可直接编辑。",
    position: 5,
    metadata: {
      htmlDocument: {
        version: 1,
        source: `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>保障计划书</title>
  <style>
    * { box-sizing: border-box; }
    body { margin: 0; padding: 32px; background: #f1f5f9; color: #0f172a; font: 16px/1.7 system-ui, "PingFang SC", "Microsoft YaHei", sans-serif; }
    main { max-width: 720px; margin: 0 auto; background: white; border: 1px solid #cbd5e1; border-radius: 12px; padding: 36px; box-shadow: 0 18px 45px rgba(15, 23, 42, .08); }
    .tag { display: inline-block; font-size: 12px; font-weight: 700; letter-spacing: .06em; color: #047857; background: #ecfdf5; padding: 4px 10px; border-radius: 999px; }
    h1 { font-size: 24px; margin: 14px 0 4px; }
    .sub { color: #64748b; margin: 0 0 28px; }
    h2 { font-size: 15px; letter-spacing: .04em; color: #475569; margin: 28px 0 8px; }
    .gap { background: #fff7ed; border-left: 3px solid #ea580c; padding: 14px 16px; border-radius: 0 8px 8px 0; }
    table { width: 100%; border-collapse: collapse; margin-top: 8px; font-size: 15px; }
    th, td { text-align: left; padding: 10px 8px; border-bottom: 1px solid #e2e8f0; }
    th { color: #64748b; font-weight: 600; font-size: 13px; }
    .rec td { background: #f0fdf4; font-weight: 600; }
    .fine { margin-top: 28px; font-size: 13px; color: #64748b; border-top: 1px solid #e2e8f0; padding-top: 16px; }
  </style>
</head>
<body>
  <main>
    <span class="tag">保障计划书</span>
    <h1>林岚 &amp; 周予安</h1>
    <p class="sub">顾问：陈嘉 · 发送前已经过评审</p>

    <h2>缺口</h2>
    <div class="gap">
      单收入结构、房贷还剩 22 年。如果这份收入今天中断，家庭大约有
      <strong>460 万元</strong>没有着落——剩余房贷加上五年生活开支。
    </div>

    <h2>两个方案</h2>
    <table>
      <thead>
        <tr><th>方案</th><th>保障</th><th>年保费</th><th>放弃了什么</th></tr>
      </thead>
      <tbody>
        <tr class="rec">
          <td>推荐</td>
          <td>500 万定期寿险 + 重疾</td>
          <td>15,200 元</td>
          <td>—</td>
        </tr>
        <tr>
          <td>更省</td>
          <td>仅 300 万定期寿险</td>
          <td>5,600 元</td>
          <td>没有重疾保障，房贷也只覆盖了一部分</td>
        </tr>
      </tbody>
    </table>

    <h2>接下来会发生什么</h2>
    <p>走简易核保通道，100 万以下免体检。核保通常 5–7 个工作日出结果。</p>

    <p class="fine">
      本计划书仅为便于比较的摘要。保障范围、责任免除与等待期，完全以保险公司出具的
      保单条款为准。所列保费为参考值，最终以核保结果为准。
    </p>
  </main>
</body>
</html>`,
      },
    },
  },
];

// ── 表单 ─────────────────────────────────────────────────────────────────────

const INSURANCE_FORMS: SeedFormDef[] = [
  {
    nodeId: INSURANCE_FORM_NODE_ID,
    folderNodeId: DEMO_INSURANCE_FOLDER_NODE_ID,
    slug: "insurance-consult-form",
    name: "预约咨询",
    description:
      "对外公开的咨询表单。提交和工作区里其他写入走同一条 ChangeRequest 路径落进客户档案——线索是直接进漏斗还是排队等审，由工作区的权限决定，不由表单决定。",
    position: 6,
    formId: INSURANCE_FORM_ID,
    targetBaseId: DEMO_INSURANCE_CLIENTS_BASE_ID,
    bindings: [
      { inputName: "client_name", fieldSlug: "client_name", required: true, label: "您的称呼" },
      { inputName: "phone", fieldSlug: "phone", required: true, label: "手机号" },
      {
        inputName: "notes",
        fieldSlug: "notes",
        required: true,
        label: "想保障什么？",
        help: "一句话就够，代理人会主动联系您。",
      },
    ],
    page: {
      theme: { brandColor: "#047857" },
      code: `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<style>
  :root { --brand: #047857; }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: ui-sans-serif, system-ui, "PingFang SC", "Microsoft YaHei", sans-serif; background: #f6faf8; color: #1c1917; }
  .wrap { max-width: 560px; margin: 0 auto; padding: 40px 24px 64px; }
  .badge { display: inline-block; font-size: 12px; font-weight: 600; letter-spacing: .04em; color: var(--brand); background: #ecfdf5; padding: 5px 10px; border-radius: 999px; }
  h1 { font-size: 26px; line-height: 1.3; margin: 16px 0 8px; }
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
    <span class="badge">免费咨询</span>
    <h1>先弄清楚，你现在到底保了什么</h1>
    <p class="lede">告诉我们你想保障什么。每一条咨询都由持证代理人亲自看过——不是自动报价，也没有任何购买义务。</p>
    <div id="f">
      <label for="client_name">您的称呼</label>
      <input id="client_name" name="client_name" required placeholder="例如：欧阳一鸣" />
      <label for="phone">手机号</label>
      <input id="phone" name="phone" required placeholder="例如：137-0013-0129" />
      <label for="notes">想保障什么？</label>
      <textarea id="notes" name="notes" required placeholder="例如：刚转做自由职业，离职后没有团体医疗了…"></textarea>
      <button type="button" id="btn">预约咨询</button>
      <p class="note">看你资料的是代理人，不是算法。</p>
    </div>
    <div class="ok" id="ok">已收到！代理人会尽快与您联系。</div>
  </div>
  <script>
    // 直接走 Busabase 的桥接（window.busa.submit），而不是原生 <form> 提交，
    // 保证只提交一次；用 type="button" 的点击避免桥接的自动收集监听重复提交。
    document.getElementById('btn').addEventListener('click', function () {
      var name = document.getElementById('client_name').value.trim();
      var phone = document.getElementById('phone').value.trim();
      var notes = document.getElementById('notes').value.trim();
      if (!name || !phone || !notes) { alert('三项都填一下吧。'); return; }
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

// ── 评审讨论 ─────────────────────────────────────────────────────────────────

const INSURANCE_COMMENTS: SeedCommentDef[] = [
  {
    id: "com_seed_ins_requote_1",
    subjectType: "change_request",
    subjectId: INSURANCE_REQUOTE_CR_ID,
    authorId: "renewal-assistant-agent",
    body: "出险记录已挂在保单记录上。三家公司都报了价，北辰 +9%、两台出险车提高免赔额，是净结果最好的一个。佣金比例降了一个点，因为我把它们挪到了车队档。",
    minutesAgo: 7,
  },
  {
    id: "com_seed_ins_requote_2",
    subjectType: "change_request",
    subjectId: INSURANCE_REQUOTE_CR_ID,
    authorId: "local-editor",
    body: "可以。批之前先确认一件事：提高免赔额会不会影响他们跟货主签的合同条款？这事现在问清楚，好过在续保电话里才发现。",
    minutesAgo: 5,
  },
  {
    id: "com_seed_ins_intake_1",
    subjectType: "change_request",
    subjectId: INSURANCE_INTAKE_CR_ID,
    authorId: "local-editor",
    body: "刚转自由职业、又没了团体医疗，这是真缺口，不是来比价的。分给陈嘉——先谈医疗险，收入损失保障放在同一次沟通里。",
    minutesAgo: 19,
  },
  {
    id: "com_seed_ins_policy_record_1",
    subjectType: "record",
    subjectId: INSURANCE_POLICY_SENIOR_HEALTH_ID,
    authorId: "local-viewer",
    body: "核保那边还在等心内科的补充说明才肯定价。现在就跟高文远讲一声，免得他被时间线打个措手不及。",
    minutesAgo: 60,
  },
];

// ── 场景 ─────────────────────────────────────────────────────────────────────

export const insuranceAgencyZhCnScenario: SeedScenario = {
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
