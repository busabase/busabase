import type {
  SeedBaseDef,
  SeedFieldDef,
  SeedRecordDef,
  SeedScenario,
  SeedViewDef,
} from "../seed-types";
import {
  DEMO_AGENT_INTEGRATIONS_BASE_ID,
  DEMO_AGENT_INTEGRATIONS_BASE_NODE_ID,
} from "./agent-integrations";

// 与英文版同一个 Marketing 文件夹(DEMO_CONTENT_FOLDER_NODE_ID),挂在其下。
const MARKETING_FOLDER_NODE_ID = "nod_content";

// 字段 slug / 选项 id 与英文版保持一致,仅展示名称为中文。
const agentIntegrationFields: SeedFieldDef[] = [
  { id: "bsf_ai_agent", slug: "agent", name: "Agent", type: "text", required: true, options: {} },
  { id: "bsf_ai_slug", slug: "slug", name: "Slug", type: "text", required: true, options: {} },
  {
    id: "bsf_ai_logo",
    slug: "logo",
    name: "Logo",
    type: "attachment",
    required: false,
    options: {
      attachment: { maxFiles: 1, allowedMimeTypes: ["image/svg+xml", "image/png"] },
    },
  },
  {
    id: "bsf_ai_category",
    slug: "category",
    name: "类型",
    type: "select",
    required: false,
    options: {
      choices: [
        { id: "coding-agent", name: "编码 Agent", color: "violet" },
        { id: "ai-ide", name: "AI 编辑器", color: "cyan" },
        { id: "autonomous", name: "自主 Agent", color: "amber" },
        { id: "web-agent", name: "网页 Agent", color: "emerald" },
        { id: "business-agent", name: "业务 Agent", color: "rose" },
      ],
    },
  },
  {
    id: "bsf_ai_connect_via",
    slug: "connect_via",
    name: "接入方式",
    type: "select",
    required: false,
    options: {
      choices: [
        { id: "rest-api", name: "REST API", color: "slate" },
        { id: "mcp", name: "MCP", color: "violet" },
        { id: "openapi", name: "OpenAPI", color: "cyan" },
      ],
    },
  },
  {
    id: "bsf_ai_status",
    slug: "status",
    name: "状态",
    type: "select",
    required: false,
    options: {
      choices: [
        { id: "published", name: "已发布", color: "emerald" },
        { id: "draft", name: "草稿", color: "slate" },
      ],
    },
  },
  {
    id: "bsf_ai_tagline",
    slug: "tagline",
    name: "一句话简介",
    type: "text",
    required: false,
    options: {},
  },
  {
    id: "bsf_ai_body",
    slug: "body",
    name: "落地页",
    type: "markdown",
    required: true,
    options: {},
  },
  {
    id: "bsf_ai_docs",
    slug: "docs_url",
    name: "文档链接",
    type: "url",
    required: false,
    options: {},
  },
  {
    id: "bsf_ai_published",
    slug: "published",
    name: "发布日期",
    type: "date",
    required: false,
    options: {},
  },
];

const agentIntegrationBases: SeedBaseDef[] = [
  {
    id: DEMO_AGENT_INTEGRATIONS_BASE_ID,
    nodeId: DEMO_AGENT_INTEGRATIONS_BASE_NODE_ID,
    slug: "agent-integrations",
    name: "Agent 集成",
    description:
      "每个可接入 Busabase 的 AI Agent 的落地页文章——Codex、Cursor、Claude Code、Hermes Agent、OpenClaw、Buda AI Agent。每一行就是一篇「<Agent> × Busabase」落地页,讲清楚它能做什么。",
    folderNodeId: MARKETING_FOLDER_NODE_ID,
    useCases: ["agent-integrations"],
    fields: agentIntegrationFields,
  },
];

type IntegrationRow = {
  key: string;
  minutesAgo: number;
  agent: string;
  slug: string;
  category: string;
  connectVia: string;
  tagline: string;
  published: string;
  body: string;
};

const rows: IntegrationRow[] = [
  {
    key: "codex",
    minutesAgo: 60,
    agent: "Codex",
    slug: "codex",
    category: "coding-agent",
    connectVia: "rest-api",
    tagline: "为 Codex 接上真正的数据后端",
    published: "2026-06-20",
    body: `# Codex × Busabase

把 Codex 接入 Busabase,让生成的代码直接读写一个在线的、强类型的数据存储,而不是一次性假数据——把原型变成可上线的应用。

## 你可以做什么
- **一句提示,拿到强类型数据** — Codex 调用 Busabase API 拉取带字段类型的记录,生成的代码直接对齐你真实的 schema。
- **把成果落库** — 脚手架生成的增删改查流程直接写入 Busabase 表,无需另外开数据库。
- **可版本化、可审计** — Codex 的每次记录变更都被记录,可随时审查、回滚。

## 如何接入
1. **创建一个 Busabase base**,配置好 Codex 要读写的表。
2. **签发带权限范围的 API 密钥**,把 Codex 接到 REST API(\`/api/v1\`)。
3. **让 Agent 跑起来** — 每次变更都在 Busabase 中留痕、可审计。

## 示例场景
- 基于现有 Busabase base 一键生成后台管理界面。
- 在生成功能的同时灌入并迁移演示数据。
- 无需手写数据层即可把 API 路由接到强类型记录。`,
  },
  {
    key: "cursor",
    minutesAgo: 120,
    agent: "Cursor",
    slug: "cursor",
    category: "ai-ide",
    connectVia: "rest-api",
    tagline: "不离开编辑器即可查询你的数据",
    published: "2026-06-21",
    body: `# Cursor × Busabase

在 Cursor 中把 Busabase 接为工具源,让它的 Agent 在你写代码时直接查看表、执行查询、修改记录。

## 你可以做什么
- **感知 schema 的补全** — Cursor 读取你的 Busabase 字段定义,补全结果与真实列和类型一致。
- **行内数据查询** — 让 Cursor 取一段记录,它会调用 Busabase API 并把结果带回上下文。
- **安全写入** — 写入经由带权限范围的密钥并在 Busabase 留痕,编辑器里的改动依然可审查。

## 如何接入
1. **创建一个 Busabase base**,放好 Cursor 要访问的数据。
2. **签发带权限范围的 API 密钥**,把 Cursor 接到 REST API(\`/api/v1\`)。
3. **让 Agent 跑起来** — 读写都带权限范围且可审计。

## 示例场景
- 重构时顺手摸清陌生的数据集。
- 对照真实 schema 生成并校验测试数据。
- 用自然语言指令批量更新记录。`,
  },
  {
    key: "claude-code",
    minutesAgo: 180,
    agent: "Claude Code",
    slug: "claude-code",
    category: "coding-agent",
    connectVia: "mcp",
    tagline: "你的终端 Agent,背后有结构化数据撑腰",
    published: "2026-06-22",
    body: `# Claude Code × Busabase

通过 MCP 把 Busabase 暴露给 Claude Code,让它基于真实记录做规划、存储成果,把长任务牢牢锚定在你的数据上。

## 你可以做什么
- **原生 MCP 接入** — Busabase 提供 MCP 接口,Claude Code 可把表和字段当作一等工具来发现使用。
- **持久的任务记忆** — 把中间结果写入 base,多步骤任务跨会话也不丢失。
- **可审计的自动化** — 每次读写都有权限范围且留痕,无人值守的运行也可追责。

## 如何接入
1. **创建一个 Busabase base**,存放任务相关的记录。
2. **签发带权限范围的 API 密钥**,把 Busabase MCP 端点加入 Claude Code。
3. **让 Agent 跑起来** — 进度被持久化,每次变更都留痕。

## 示例场景
- 整夜对一批积压记录做分诊和打标。
- 从命令行持续同步一个知识库。
- 把可重复的数据迁移作为 Agent 任务执行。`,
  },
  {
    key: "hermes-agent",
    minutesAgo: 240,
    agent: "Hermes Agent",
    slug: "hermes-agent",
    category: "autonomous",
    connectVia: "rest-api",
    tagline: "在你的数据之上跑长时自动化",
    published: "2026-06-23",
    body: `# Hermes Agent × Busabase

让 Hermes Agent 对接 Busabase,驱动定时与事件驱动的工作流——它响应记录变化,并把结果写回唯一可信源。

## 你可以做什么
- **事件驱动触发** — Hermes 监听 Busabase 的新增或变更记录,自动触发工作流。
- **有状态的流水线** — 每一步把进度持久化到 base,失败可续跑而非从头再来。
- **唯一可信源** — 产出落入团队和其他工具已经在读的 Busabase 表中。

## 如何接入
1. **创建一个 Busabase base**,承载工作流的记录。
2. **签发带权限范围的 API 密钥**,把 Hermes Agent 接到 REST API(\`/api/v1\`)。
3. **让 Agent 跑起来** — 响应与产出均可版本化、可审计。

## 示例场景
- 线索一旦创建即刻自动补全信息。
- 每晚跨关联表做对账核对。
- 记录达到阈值时扇出通知。`,
  },
  {
    key: "openclaw",
    minutesAgo: 300,
    agent: "OpenClaw",
    slug: "openclaw",
    category: "web-agent",
    connectVia: "rest-api",
    tagline: "把抓取的网页变成结构化记录",
    published: "2026-06-24",
    body: `# OpenClaw × Busabase

把 OpenClaw 的浏览与抽取结果直接写进 Busabase,让杂乱的网页数据变成可查询、强类型、已去重的记录。

## 你可以做什么
- **抽取即入模** — 把 OpenClaw 抽取的字段映射到 Busabase 列,每次运行的产出都保持一致。
- **内置去重** — 用键字段做 upsert,重新抓取时更新已有行而不是产生重复。
- **查询你的战利品** — 筛选视图与 API 让下游工具即刻消费抓取结果。

## 如何接入
1. **创建一个 Busabase base**,让列与你的抽取 schema 对齐。
2. **签发带权限范围的 API 密钥**,把 OpenClaw 接到 REST API(\`/api/v1\`)。
3. **让 Agent 跑起来** — 抓取结果 upsert 为强类型、可审计的记录。

## 示例场景
- 搭建一张自动刷新的竞品价格表。
- 把研究语料汇聚到一个可查询的 base。
- 监控列表并标记随时间发生的变化。`,
  },
  {
    key: "buda-ai-agent",
    minutesAgo: 360,
    agent: "Buda AI Agent",
    slug: "buda-ai-agent",
    category: "business-agent",
    connectVia: "rest-api",
    tagline: "让业务工作流跑在 Busabase 数据上",
    published: "2026-06-25",
    body: `# Buda AI Agent × Busabase

Buda 的业务 Agent 以 Busabase 作为运营数据存储——CRM、项目、市场记录都存在 base 中,Agent 直接读取、推理并更新。

## 你可以做什么
- **运营数据存储** — Buda Agent 把 Busabase base 当作客户、商机、任务的记录系统。
- **跨域关联** — 关联表让 Agent 在一处跨 CRM、项目、市场进行推理。
- **闭环动作** — 决策写回 Busabase,下一次运行即可看到更新后的状态。

## 如何接入
1. **创建一个 Busabase base**,承载业务域(CRM、项目、市场)。
2. **签发带权限范围的 API 密钥**,把 Buda AI Agent 接到 REST API(\`/api/v1\`)。
3. **让 Agent 跑起来** — 决策写回且完全可审计。

## 示例场景
- 基于 CRM base 自动完成线索到商机的交接。
- 让市场商品目录保持准确与有货。
- 基于实时项目记录生成每周状态报告。`,
  },
];

const agentIntegrationRecords: SeedRecordDef[] = rows.map((r) => ({
  id: `rec_seed_agint_${r.key}`,
  baseId: DEMO_AGENT_INTEGRATIONS_BASE_ID,
  commitId: `cmt_seed_agint_${r.key}`,
  fields: {
    agent: r.agent,
    slug: r.slug,
    logo: [
      {
        id: `att_agint_logo_${r.key}`,
        attachmentId: `att_agint_logo_${r.key}`,
        fileName: `${r.slug}.svg`,
        mimeType: "image/svg+xml",
        size: 2048,
        url: `/assets/agents/${r.slug}.svg`,
      },
    ],
    category: r.category,
    connect_via: r.connectVia,
    status: "published",
    tagline: r.tagline,
    body: r.body,
    docs_url: "https://busabase.com/zh-CN/docs",
    published: r.published,
  },
  message: `Seed agent integration — ${r.agent}`,
  author: "seed-content",
  minutesAgo: r.minutesAgo + 5000,
  useCases: ["agent-integrations"],
}));

const agentIntegrationViews: SeedViewDef[] = [
  {
    id: "viw_seed_agint_published",
    baseId: DEMO_AGENT_INTEGRATIONS_BASE_ID,
    slug: "published",
    name: "已发布",
    description: "所有上线的 Agent 落地页,按时间倒序。",
    config: {
      filters: [{ fieldSlug: "status", operator: "equals", value: "published" }],
      sorts: [{ fieldSlug: "published", direction: "desc" }],
    },
    minutesAgo: 60,
    useCases: ["agent-integrations"],
  },
  {
    id: "viw_seed_agint_by_category",
    baseId: DEMO_AGENT_INTEGRATIONS_BASE_ID,
    slug: "by-category",
    name: "按类型",
    description: "按集成类型分组的 Agent。",
    config: { filters: [], sorts: [{ fieldSlug: "category", direction: "asc" }] },
    minutesAgo: 59,
    useCases: ["agent-integrations"],
  },
  {
    id: "viw_seed_agint_mcp",
    baseId: DEMO_AGENT_INTEGRATIONS_BASE_ID,
    slug: "mcp-native",
    name: "MCP 原生",
    description: "通过 Model Context Protocol 接入的 Agent。",
    config: {
      filters: [{ fieldSlug: "connect_via", operator: "equals", value: "mcp" }],
      sorts: [{ fieldSlug: "agent", direction: "asc" }],
    },
    minutesAgo: 58,
    useCases: ["agent-integrations"],
  },
];

export const agentIntegrationsZhCnScenario: SeedScenario = {
  bases: agentIntegrationBases,
  records: agentIntegrationRecords,
  views: agentIntegrationViews,
};
