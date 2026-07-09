import type { SeedScenario } from "../seed-types";

// 简体中文的各 node type 示例内容：Docs + Files + 评审 Comments。与英文
// (`node-types.en.ts`) 共用同一套结构与结构性 id，但数据是中文、可以不一致。
// 复用的 change request / record id（crq_seed 等）在中英文 scenario 中都存在。

const DOC_GUIDE_CR_ID = "crq_seed_doc_operating_guide";

export const zhCnNodeTypesScenario: SeedScenario = {
  docs: [
    {
      nodeId: "nod_doc_agent_operating_guide",
      slug: "agent-operating-guide",
      name: "Agent 操作指南",
      description: "Agent 如何在本工作区提出、评审并合并变更。",
      position: 0,
      body: `# Agent 操作指南

本工作区里的每一次改动——一条记录、一个 Skill 文件、一篇 Doc、一处结构调整——
都以**变更请求（change request）**的形式提出，评审通过后才会合并。Agent 的任何
操作都不会悄悄生效。

## Agent 在这里如何工作

1. 先读懂相关的 Base、Doc 或 Skill。
2. 开一个变更请求，说明**改了什么**以及**为什么改**。
3. 等待审批通过后再合并。
4. 每一条事实性主张都要给出来源或内部记录 id。

## 为什么是审批优先

工作区是一支由 Agent 和人共同编辑的共享记忆，因此一份可评审、可回滚的历史，
比单纯的写入速度更重要。
`,
      changeRequest: {
        id: DOC_GUIDE_CR_ID,
        operationId: "opr_seed_doc_operating_guide",
        commitId: "cmt_seed_doc_operating_guide",
        submittedBy: "docs-maintainer-agent",
        minutesAgo: 4,
        message: "为《Agent 操作指南》补充升级处理章节",
        nextBody: `# Agent 操作指南

本工作区里的每一次改动——一条记录、一个 Skill 文件、一篇 Doc、一处结构调整——
都以**变更请求（change request）**的形式提出，评审通过后才会合并。Agent 的任何
操作都不会悄悄生效。

## Agent 在这里如何工作

1. 先读懂相关的 Base、Doc 或 Skill。
2. 开一个变更请求，说明**改了什么**以及**为什么改**。
3. 等待审批通过后再合并。
4. 每一条事实性主张都要给出来源或内部记录 id。

## 升级处理

如果一个变更请求被卡住超过一天，应当标记人工评审，而不是绕过它强行合并。
`,
      },
    },
    {
      nodeId: "nod_doc_launch_runbook",
      slug: "launch-runbook",
      name: "发布手册",
      description: "Agent 把已批准的变更发布到线上渠道的操作步骤。",
      position: 1,
      body: `# 发布手册

Agent 把一个已批准的变更发布到线上渠道时遵循的步骤。

## 发布前检查

- 确认变更请求已批准并已合并。
- 确认目标 Base 视图没有相互冲突的未决变更请求。

## 发布

1. 导出该渠道已合并的记录。
2. 通过渠道适配器发布。
3. 用一个新的变更请求把外部 id 回写到记录上。

## 回滚

如果已发布的内容有误，开一个回滚变更请求——绝不绕过流程直接改动渠道。
`,
    },
    {
      nodeId: "nod_doc_data_dictionary",
      slug: "data-dictionary",
      name: "数据字典",
      description: "CRM 各 Base 的字段共享定义。",
      position: 2,
      body: `# 数据字典

为 CRM 的各个 Base 提供共享定义，让 Agent 和人对每个字段的理解保持一致。

## Companies（公司）

- **name** —— 法律实体名称。
- **status** —— 取值 \`lead\`、\`active\` 或 \`churned\`。

## Contacts（联系人）

- **status** —— 取值 \`new\`、\`engaged\` 或 \`customer\`。
- **company** —— 指向一条 Companies 记录的关联。

每当 Base 结构变化时，都通过变更请求同步更新本文档。
`,
    },
  ],
  files: [
    {
      nodeId: "nod_file_product_brief",
      slug: "product-brief",
      name: "产品简介",
      description: "由 Asset 支撑的一等 File 节点。",
      fileName: "product-brief.md",
      mimeType: "text/markdown; charset=utf-8",
      attachmentId: "att_seed_product_brief",
      assetId: "ast_seed_product_brief",
      storageKey: "attachments/blobs/seed/product-brief.md",
      position: 0,
      body: `# 产品简介

Busabase 是面向 AI Agent 的审批优先数据库：每一次写入都是一个可评审的变更请求，
让一支由 Agent 和人组成的团队共享同一份可编辑的事实来源，而不会互相踩踏。

- Agent 提出、评审者批准、历史可回滚。
- Base、Doc、Skill、Drive、File 都活在同一棵工作区树里。
- 这个文件本身就是一个由 Asset 库支撑的一等 **File 节点**。
`,
    },
    {
      nodeId: "nod_file_q3_metrics",
      slug: "q3-metrics",
      name: "Q3 指标",
      description: "一个 CSV File 节点——Agent 常会附上这类数据文件供评审。",
      fileName: "q3-metrics.csv",
      mimeType: "text/csv",
      attachmentId: "att_seed_q3_metrics",
      assetId: "ast_seed_q3_metrics",
      storageKey: "attachments/blobs/seed/q3-metrics.csv",
      position: 1,
      body: `指标,Q2,Q3,环比
周活跃 Agent,820,1240,+51%
已合并变更请求,3110,4870,+57%
平均评审分钟数,42,28,-33%
`,
    },
    {
      nodeId: "nod_file_brand_palette",
      slug: "brand-palette",
      name: "品牌色板",
      description: "存放工作区品牌 token 的 JSON File 节点。",
      fileName: "brand-palette.json",
      mimeType: "application/json",
      attachmentId: "att_seed_brand_palette",
      assetId: "ast_seed_brand_palette",
      storageKey: "attachments/blobs/seed/brand-palette.json",
      position: 2,
      body: `{
  "name": "Busabase",
  "colors": {
    "primary": "#2f6f4f",
    "ink": "#0f172a",
    "paper": "#f8fafc"
  },
  "voice": "沉稳、精确、审批优先"
}
`,
    },
  ],
  comments: [
    {
      id: "com_seed_blog_review_1",
      subjectType: "change_request",
      subjectId: "crq_seed",
      authorId: "local-editor",
      body: "论点很扎实。批准之前，能否给“下一个 Agent 操控界面”这个说法补一个带日期的来源？@agent",
      mentionsAi: true,
      minutesAgo: 34,
    },
    {
      id: "com_seed_blog_review_2",
      subjectType: "change_request",
      subjectId: "crq_seed",
      authorId: "ai-research-agent",
      body: "收到——已把措辞放缓为“可能成为”，并在正文里补了两条带日期的发布说明作为来源。",
      minutesAgo: 29,
    },
    {
      id: "com_seed_social_batch_1",
      subjectType: "change_request",
      subjectId: "crq_seed_social_batch",
      authorId: "social-editor-agent",
      body: "把新建 + 更新 + 归档打包成一个可评审的变更，这样本周话题就作为一次改动落地，而不是分三次。",
      minutesAgo: 14,
    },
    {
      id: "com_seed_doc_guide_1",
      subjectType: "change_request",
      subjectId: DOC_GUIDE_CR_ID,
      authorId: "local-editor",
      body: "补得不错——合并前把升级处理的时限写明确（24 小时）。",
      minutesAgo: 3,
    },
    {
      id: "com_seed_skill_1",
      subjectType: "change_request",
      subjectId: "crq_seed_skill_research_editor",
      authorId: "skill-maintainer-agent",
      body: "合并护栏这一节能挡住没有来源的市场类说法。@agent 请再核对一下基准数据那一行。",
      mentionsAi: true,
      minutesAgo: 5,
    },
    {
      id: "com_seed_record_1",
      subjectType: "record",
      subjectId: "rec_seed_blog_approval",
      authorId: "local-viewer",
      body: "把来源放进正文后读起来顺多了。这条合并后就可以进 newsletter 了。",
      minutesAgo: 18,
    },
  ],
};
