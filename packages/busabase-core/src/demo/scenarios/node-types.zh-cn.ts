import type { SeedScenario } from "../seed-types";

// 简体中文的各 node type 示例内容：Docs + Files + 评审 Comments。与英文
// (`node-types.en.ts`) 共用同一套结构与结构性 id，但数据是中文、可以不一致。
// 复用的 change request / record id（crq_seed 等）在中英文 scenario 中都存在。

const DOC_GUIDE_CR_ID = "crq_seed_doc_operating_guide";
const RICH_NODES_FOLDER_ID = "nod_visual_tools";

export const zhCnNodeTypesScenario: SeedScenario = {
  folders: [
    {
      nodeId: RICH_NODES_FOLDER_ID,
      slug: "visual-tools",
      name: "可视化工具",
      description: "自由画布、标准化流程、思维导图与 HTML 原型。",
      position: 6,
    },
  ],
  richNodes: [
    {
      nodeType: "whiteboard",
      nodeId: "nod_whiteboard_product_launch",
      folderNodeId: RICH_NODES_FOLDER_ID,
      slug: "product-launch-whiteboard",
      name: "产品发布白板",
      description: "用自由布局汇总发布目标、负责人和待确认问题。",
      position: 0,
      metadata: {
        whiteboardDocument: {
          version: 1,
          appState: { viewBackgroundColor: "#f8fafc" },
          elements: [
            {
              id: "launch-title",
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
              seed: 201,
              version: 1,
              versionNonce: 201,
              isDeleted: false,
              boundElements: null,
              updated: 1,
              link: null,
              locked: false,
              text: "产品发布白板",
              fontSize: 28,
              fontFamily: 5,
              textAlign: "left",
              verticalAlign: "top",
              containerId: null,
              originalText: "产品发布白板",
              autoResize: true,
              lineHeight: 1.25,
            },
            ...[
              ["goal", 80, 130, "目标\n上线审批优先的协作流程", "#dcfce7", 202],
              ["owners", 400, 130, "负责人\n产品 · 增长 · 客服", "#dbeafe", 203],
              ["risks", 80, 330, "待确认\n定价 · 引导 · 数据迁移", "#fef3c7", 204],
              ["success", 400, 330, "成功指标\n激活 · 审批数 · 留存", "#fce7f3", 205],
            ].flatMap(([id, x, y, text, color, seed], index) => [
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
                x: Number(x) + 15,
                y: Number(y) + 24,
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
                seed: Number(seed) + 10,
                version: 1,
                versionNonce: Number(seed) + 10,
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
            ]),
          ],
        },
      },
    },
    {
      nodeType: "workflow",
      nodeId: "nod_workflow_lead_intake",
      folderNodeId: RICH_NODES_FOLDER_ID,
      slug: "lead-intake-workflow",
      name: "销售线索接入流程",
      description: "把新线索从 Webhook 接入、补全、评分到人工审核的标准流程。",
      position: 1,
      metadata: {
        workflowDocument: {
          version: 2,
          nodes: [
            {
              id: "new-lead",
              kind: "trigger",
              position: { x: 0, y: 80 },
              label: "收到新线索",
              description: "用户提交线索表单时启动。",
              eventName: "lead.submitted",
            },
            {
              id: "enrich",
              kind: "webhook",
              position: { x: 280, y: 80 },
              label: "补全公司信息",
              description: "将线索发送到企业信息补全 Webhook。",
              method: "POST",
              url: "https://example.com/webhooks/enrich-company",
            },
            {
              id: "score",
              kind: "function",
              position: { x: 560, y: 80 },
              label: "计算匹配度",
              description: "根据补全后的画像计算 ICP 匹配度。",
              webhookRuleId: "",
              functionName: "scoreLeadFit",
            },
            {
              id: "review",
              kind: "condition",
              position: { x: 840, y: 80 },
              label: "线索是否合格？",
              description: "根据函数返回的评分进行分支。",
              expression: "input.score >= 80",
            },
            {
              id: "approval",
              kind: "approval",
              position: { x: 840, y: 260 },
              label: "审批触达",
              description: "合格线索触达前需要空间管理员审批。",
              approver: "space-admin",
            },
            {
              id: "wait",
              kind: "wait",
              position: { x: 560, y: 260 },
              label: "等待 CRM 同步",
              description: "等待补全信息和 CRM 投影完成。",
              duration: 30,
              unit: "minutes",
            },
            {
              id: "create-review",
              kind: "action",
              position: { x: 280, y: 260 },
              label: "创建审核任务",
              description: "为客户负责人创建审核 ChangeRequest。",
              actionName: "createChangeRequest",
            },
            {
              id: "completed",
              kind: "end",
              position: { x: 0, y: 260 },
              label: "可以触达",
              description: "合格线索已完成标准流程。",
              outcome: "approved",
            },
            {
              id: "not-qualified",
              kind: "end",
              position: { x: 840, y: -180 },
              label: "归档线索",
              description: "线索未达到当前合格阈值。",
              outcome: "not-qualified",
            },
          ],
          edges: [
            {
              id: "lead-enrich",
              source: "new-lead",
              target: "enrich",
              label: "",
              outcome: "default",
            },
            {
              id: "enrich-score",
              source: "enrich",
              target: "score",
              label: "已补全",
              outcome: "success",
            },
            {
              id: "score-review",
              source: "score",
              target: "review",
              label: "已评分",
              outcome: "success",
            },
            {
              id: "review-approval",
              source: "review",
              target: "approval",
              label: "合格",
              outcome: "true",
            },
            {
              id: "review-archive",
              source: "review",
              target: "not-qualified",
              label: "不合格",
              outcome: "false",
            },
            {
              id: "approval-wait",
              source: "approval",
              target: "wait",
              label: "已审批",
              outcome: "approved",
            },
            {
              id: "wait-action",
              source: "wait",
              target: "create-review",
              label: "等待完成",
              outcome: "elapsed",
            },
            {
              id: "action-complete",
              source: "create-review",
              target: "completed",
              label: "已创建",
              outcome: "success",
            },
          ],
          settings: {
            executionMode: "event",
            concurrency: 4,
            timeoutMs: 60000,
            errorPolicy: "stop",
          },
        },
      },
    },
    {
      nodeType: "html",
      nodeId: "nod_html_waitlist_form",
      folderNodeId: RICH_NODES_FOLDER_ID,
      slug: "waitlist-form-prototype",
      name: "候补名单表单原型",
      description: "一个可直接编辑和预览的紧凑型 HTML 候补名单表单。",
      position: 2,
      metadata: {
        htmlDocument: {
          version: 1,
          source: `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>加入 Busabase 候补名单</title>
  <style>
    * { box-sizing: border-box; }
    body { margin: 0; min-height: 100vh; display: grid; place-items: center; padding: 32px; background: #f1f5f9; color: #0f172a; font: 16px/1.5 system-ui, sans-serif; }
    main { width: min(100%, 520px); border: 1px solid #cbd5e1; border-radius: 12px; background: white; padding: 32px; box-shadow: 0 18px 45px rgba(15, 23, 42, .08); }
    p { color: #475569; }
    label { display: grid; gap: 6px; margin-top: 18px; font-weight: 600; }
    input, select, button { width: 100%; min-height: 44px; border-radius: 7px; font: inherit; }
    input, select { border: 1px solid #94a3b8; padding: 0 12px; }
    button { margin-top: 24px; border: 0; background: #166534; color: white; font-weight: 700; cursor: pointer; }
  </style>
</head>
<body>
  <main>
    <h1>构建可信的 Agent 工作流</h1>
    <p>告诉我们：Agent 的输出成为正式数据之前，你最想审核什么？</p>
    <form onsubmit="event.preventDefault(); this.querySelector('button').textContent='已加入候补名单';">
      <label>工作邮箱 <input type="email" placeholder="you@company.com" required></label>
      <label>主要场景 <select><option>Agent 知识库</option><option>内容运营</option><option>数据审核</option></select></label>
      <button type="submit">申请抢先体验</button>
    </form>
  </main>
</body>
</html>`,
        },
      },
    },
  ],
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
