/**
 * Demo playbooks — custom agent prompts on the seeded bases, so the demo's
 * Playbooks page, its "Try it" box, the Ask Agent dialog, and the MCP playbook
 * tools all show what the product does: the team writes down how a job is done
 * once, and every agent looks it up before acting instead of improvising.
 *
 * One prompt per homepage scenario where a seeded base exists (CRM, marketing,
 * content, team memory, operations, research, compliance). Skill playbooks come
 * from the seeded Skill nodes themselves. Labels and bodies are en + zh-CN,
 * like the rest of the demo seed; other locales fall back to English.
 *
 * `DEMO_PLAYBOOK_USAGE` is sample data too: how many change requests cited each
 * playbook in the last 30 days. Read-only prompts write nothing, so they have
 * none — the same rule the real usage count follows.
 */
import type { CustomAgentPrompts } from "busabase-contract/contract/node-agent-prompt-schemas";
import {
  DEMO_BLOG_BASE_NODE_ID,
  DEMO_CRM_COMPANIES_BASE_NODE_ID,
  DEMO_CRM_DEALS_BASE_NODE_ID,
  DEMO_NEWSLETTER_BASE_NODE_ID,
  DEMO_SOCIAL_BASE_NODE_ID,
} from "./dataset";
import { README_SCENARIO_IDS } from "./scenarios/readme-scenarios";

export const DEMO_NODE_AGENT_PROMPTS: Readonly<Record<string, CustomAgentPrompts>> = {
  // CRM — the homepage's "log my visit and update the account" story.
  [DEMO_CRM_COMPANIES_BASE_NODE_ID]: [
    {
      key: "log-visit",
      intent: "change",
      label: { en: "Log a customer visit", "zh-CN": "记一次客户拜访" },
      body: {
        en: '{target}\n\nAdd today\'s visit to the right company: who we met, what they need, the next step and who owns it. If the company\'s status changed, update it too. Never create a second record for a company that already exists.\n\nPeople ask for this as: "log today\'s customer visit", "record a client meeting", "we just met Acme".',
        "zh-CN":
          "{target}\n\n把今天的拜访记到对应的客户上：见了谁、对方要什么、下一步和负责人。客户状态有变化的话一并更新。已经存在的客户不要再新建一条。\n\n常见说法：「记一下今天拜访了客户」「帮我记一次客户拜访」「刚见完客户」。",
      },
    },
  ],
  [DEMO_CRM_DEALS_BASE_NODE_ID]: [
    {
      key: "update-deal-after-call",
      intent: "change",
      label: { en: "Update a deal after a call", "zh-CN": "通话后更新商机" },
      body: {
        en: "{target}\n\nUpdate the deal we just discussed: stage, amount if it moved, the blocker, and the next step with a date. Keep the old amount in the note when it changes.",
        "zh-CN":
          "{target}\n\n更新刚聊过的商机：阶段、金额有变化就改、卡在哪里、下一步和日期。金额改动时，在备注里保留原来的数字。",
      },
    },
  ],
  // Marketing — the homepage hero's coffee-launch story.
  [DEMO_SOCIAL_BASE_NODE_ID]: [
    {
      key: "draft-weekly-posts",
      intent: "change",
      label: { en: "Draft this week's social posts", "zh-CN": "起草本周社媒帖子" },
      body: {
        en: '{target}\n\nDraft one post per platform per day for this week. Take prices and product names from the product catalog, never guess them. Keep our tone: warm, short, no walls of hashtags.\n\nPeople ask for this as: "write this week\'s posts", "plan the social calendar".',
        "zh-CN":
          "{target}\n\n为本周每个平台每天起草一条帖子。价格和产品名一律从商品资料里取，不要自己猜。保持我们的语气：亲切、简短，不堆话题标签。\n\n常见说法：「写一下这周的帖子」「排一下社媒日历」。",
      },
    },
  ],
  [DEMO_BLOG_BASE_NODE_ID]: [
    {
      key: "notes-to-draft",
      intent: "change",
      label: { en: "Turn notes into a blog draft", "zh-CN": "把笔记整理成博客草稿" },
      body: {
        en: "{target}\n\nTurn the notes I give you into a draft post: a clear title, a one-paragraph summary, and sections with sources linked. Save it as a draft, not published.",
        "zh-CN":
          "{target}\n\n把我给你的笔记整理成一篇草稿：清楚的标题、一段摘要、分小节并附上来源链接。存成草稿，不要直接发布。",
      },
    },
  ],
  [DEMO_NEWSLETTER_BASE_NODE_ID]: [
    {
      key: "weekly-newsletter",
      intent: "change",
      label: { en: "Draft the weekly newsletter", "zh-CN": "起草每周简报" },
      body: {
        en: "{target}\n\nPull this week's published posts and the three biggest customer wins into one newsletter issue. Link every item back to its record.",
        "zh-CN":
          "{target}\n\n把本周已发布的内容和三个最重要的客户进展，汇总成一期简报。每一条都链接回对应的记录。",
      },
    },
  ],
  // Team memory.
  [README_SCENARIO_IDS.knowledgeBaseNode]: [
    {
      key: "save-decision",
      intent: "change",
      label: { en: "Save a decision", "zh-CN": "记下一项决策" },
      body: {
        en: "{target}\n\nRecord the decision we just made: what we decided, why, who decided, and the date. Link the discussion or document it came from so the next agent can check the source.",
        "zh-CN":
          "{target}\n\n把刚才定下的事记下来：决定了什么、为什么、谁拍板、日期。附上讨论或文档的链接，让下一个 Agent 能查到出处。",
      },
    },
  ],
  // Operations.
  [README_SCENARIO_IDS.operationsBaseNode]: [
    {
      key: "log-supplier-change",
      intent: "change",
      label: { en: "Log a supplier change", "zh-CN": "记录供应商变更" },
      body: {
        en: "{target}\n\nLog the supplier change: which vendor, what changed (price, lead time, contact), who told us, and which open tasks it affects.",
        "zh-CN":
          "{target}\n\n记录这次供应商变更：哪家供应商、改了什么（价格、交期、联系人）、谁通知的，以及影响了哪些进行中的任务。",
      },
    },
  ],
  // Research — read-only: it answers, it does not write.
  [README_SCENARIO_IDS.researchBaseNode]: [
    {
      key: "weekly-signals",
      intent: "read-only",
      label: { en: "Summarize this week's market signals", "zh-CN": "汇总本周市场信号" },
      body: {
        en: "{target}\n\nSummarize this week's signals in five bullets, strongest first. Quote the source for each and say how confident we are.",
        "zh-CN":
          "{target}\n\n用五条要点汇总本周的市场信号，最重要的放前面。每条注明来源，并说明把握有多大。",
      },
    },
  ],
  // Compliance — read-only.
  [README_SCENARIO_IDS.complianceBaseNode]: [
    {
      key: "overdue-items",
      intent: "read-only",
      label: { en: "Check what's overdue", "zh-CN": "查一下哪些合规项逾期了" },
      body: {
        en: "{target}\n\nList every item past its due date or missing evidence, with its owner. Do not change anything.",
        "zh-CN": "{target}\n\n列出所有已过截止日期或缺少证据的项目，以及负责人。不要修改任何内容。",
      },
    },
  ],
};

/**
 * Uses in the last 30 days and hours since the last one, keyed like the real
 * usage map (`skill:<nodeId>` / `prompt:<nodeId>:<key>`).
 */
export const DEMO_PLAYBOOK_USAGE: Readonly<
  Record<string, { changeRequests30d: number; lastUsedHoursAgo: number }>
> = {
  [`prompt:${DEMO_CRM_COMPANIES_BASE_NODE_ID}:log-visit`]: {
    changeRequests30d: 14,
    lastUsedHoursAgo: 3,
  },
  [`prompt:${DEMO_SOCIAL_BASE_NODE_ID}:draft-weekly-posts`]: {
    changeRequests30d: 9,
    lastUsedHoursAgo: 26,
  },
  [`prompt:${DEMO_CRM_DEALS_BASE_NODE_ID}:update-deal-after-call`]: {
    changeRequests30d: 7,
    lastUsedHoursAgo: 50,
  },
  [`prompt:${DEMO_BLOG_BASE_NODE_ID}:notes-to-draft`]: {
    changeRequests30d: 6,
    lastUsedHoursAgo: 75,
  },
  [`prompt:${README_SCENARIO_IDS.knowledgeBaseNode}:save-decision`]: {
    changeRequests30d: 5,
    lastUsedHoursAgo: 20,
  },
  [`prompt:${DEMO_NEWSLETTER_BASE_NODE_ID}:weekly-newsletter`]: {
    changeRequests30d: 4,
    lastUsedHoursAgo: 122,
  },
  [`prompt:${README_SCENARIO_IDS.operationsBaseNode}:log-supplier-change`]: {
    changeRequests30d: 2,
    lastUsedHoursAgo: 220,
  },
  "skill:nod_skill_ai_research_editor": { changeRequests30d: 3, lastUsedHoursAgo: 30 },
};
