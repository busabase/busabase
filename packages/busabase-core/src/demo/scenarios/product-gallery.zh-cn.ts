import type {
  SeedBaseDef,
  SeedFieldDef,
  SeedRecordDef,
  SeedScenario,
  SeedViewDef,
} from "../seed-types";
import { DEMO_AGENT_GALLERY_BASE_ID, DEMO_AGENT_GALLERY_BASE_NODE_ID } from "./product-gallery";

// 与英文版同一个「实验室」文件夹(DEMO_LAB_FOLDER_NODE_ID),挂在其下。
const LAB_FOLDER_NODE_ID = "nod_lab";

// 字段 slug / 选项 id 与英文版保持一致,仅展示名称为中文。
const agentGalleryFields: SeedFieldDef[] = [
  { id: "bsf_gal_name", slug: "name", name: "智能体", type: "text", required: true, options: {} },
  {
    id: "bsf_gal_logo",
    slug: "logo",
    name: "Logo",
    type: "attachment",
    required: false,
    options: {
      attachment: {
        allowedMimeTypes: ["image/svg+xml", "image/png"],
        maxFileSize: 5 * 1024 * 1024,
        maxFiles: 1,
      },
    },
  },
  {
    id: "bsf_gal_tagline",
    slug: "tagline",
    name: "一句话简介",
    type: "text",
    required: false,
    options: {},
  },
  {
    id: "bsf_gal_category",
    slug: "category",
    name: "类别",
    type: "select",
    required: false,
    options: {
      choices: [
        { id: "coding", name: "编程智能体", color: "violet" },
        { id: "assistant", name: "助手", color: "cyan" },
        { id: "automation", name: "自动化", color: "emerald" },
      ],
    },
  },
  {
    id: "bsf_gal_status",
    slug: "status",
    name: "状态",
    type: "select",
    required: false,
    options: {
      choices: [
        { id: "connected", name: "已连接", color: "emerald" },
        { id: "available", name: "可用", color: "slate" },
        { id: "beta", name: "测试版", color: "amber" },
      ],
    },
  },
  {
    id: "bsf_gal_website",
    slug: "website",
    name: "网站",
    type: "url",
    required: false,
    options: {},
  },
];

const AGENT_GALLERY_BASES: SeedBaseDef[] = [
  {
    id: DEMO_AGENT_GALLERY_BASE_ID,
    nodeId: DEMO_AGENT_GALLERY_BASE_NODE_ID,
    slug: "agent-gallery",
    name: "智能体图库",
    description:
      "接入 Busabase 的编程智能体与助手的可视化目录 —— 用相册(Gallery)视图浏览,每张卡片以智能体的 Logo 作封面。",
    folderNodeId: LAB_FOLDER_NODE_ID,
    useCases: ["gallery"],
    fields: agentGalleryFields,
  },
];

type GalleryRow = {
  key: string;
  logo: string;
  minutesAgo: number;
  fields: Record<string, unknown>;
};

const rows: GalleryRow[] = [
  {
    key: "claude_code",
    logo: "/assets/agents/claude-code.svg",
    minutesAgo: 40,
    fields: {
      name: "Claude Code",
      tagline: "Anthropic 的终端智能体编程工具。",
      category: "coding",
      status: "connected",
      website: "https://claude.com/claude-code",
    },
  },
  {
    key: "cursor",
    logo: "/assets/agents/cursor.svg",
    minutesAgo: 80,
    fields: {
      name: "Cursor",
      tagline: "为与智能体结对编程而生的 AI 代码编辑器。",
      category: "coding",
      status: "connected",
      website: "https://cursor.com",
    },
  },
  {
    key: "codex",
    logo: "/assets/agents/codex.svg",
    minutesAgo: 120,
    fields: {
      name: "Codex",
      tagline: "OpenAI 的软件工程智能体。",
      category: "coding",
      status: "available",
      website: "https://openai.com/codex",
    },
  },
  {
    key: "buda",
    logo: "/assets/agents/buda-ai-agent.svg",
    minutesAgo: 160,
    fields: {
      name: "Buda 智能体",
      tagline: "面向你的数据库与云盘执行长链路任务。",
      category: "assistant",
      status: "connected",
      website: "https://buda.ai",
    },
  },
  {
    key: "openclaw",
    logo: "/assets/agents/openclaw.svg",
    minutesAgo: 210,
    fields: {
      name: "OpenClaw",
      tagline: "面向审批优先工作流的开源智能体运行时。",
      category: "automation",
      status: "beta",
      website: "https://github.com/busabase",
    },
  },
  {
    key: "hermes",
    logo: "/assets/agents/hermes-agent.svg",
    minutesAgo: 260,
    fields: {
      name: "Hermes",
      tagline: "面向 Outgoing Hook 的消息驱动自动化智能体。",
      category: "automation",
      status: "available",
      website: "https://busabase.com",
    },
  },
];

const AGENT_GALLERY_RECORDS: SeedRecordDef[] = rows.map((r) => ({
  id: `rec_seed_gallery_${r.key}`,
  baseId: DEMO_AGENT_GALLERY_BASE_ID,
  commitId: `cmt_seed_gallery_${r.key}`,
  fields: {
    ...r.fields,
    logo: [
      {
        id: `att_seed_gallery_${r.key}`,
        attachmentId: `att_seed_gallery_${r.key}`,
        fileName: `${r.key.replace(/_/g, "-")}.svg`,
        mimeType: "image/svg+xml",
        size: 4200,
        url: r.logo,
      },
    ],
  },
  message: `种子·智能体图库 —— ${r.fields.name}`,
  author: "seed-gallery",
  minutesAgo: r.minutesAgo + 5200,
  useCases: ["gallery"],
}));

const AGENT_GALLERY_VIEWS: SeedViewDef[] = [
  {
    id: "viw_seed_gallery_all",
    baseId: DEMO_AGENT_GALLERY_BASE_ID,
    slug: "gallery",
    name: "相册",
    description: "每个已连接的智能体一张卡片,以 Logo 作封面。",
    type: "gallery",
    config: {
      filters: [],
      sorts: [{ fieldSlug: "name", direction: "asc" }],
      coverFieldSlug: "logo",
      coverFit: "fit",
      cardSize: "medium",
      showFieldLabels: false,
    },
    minutesAgo: 30,
    useCases: ["gallery"],
  },
  {
    id: "viw_seed_gallery_connected",
    baseId: DEMO_AGENT_GALLERY_BASE_ID,
    slug: "connected",
    name: "已连接",
    description: "仅显示当前已接入的智能体 —— 同样是相册视图。",
    type: "gallery",
    config: {
      filters: [{ fieldSlug: "status", operator: "equals", value: "connected" }],
      sorts: [],
      coverFieldSlug: "logo",
      coverFit: "fit",
      cardSize: "large",
      showFieldLabels: true,
    },
    minutesAgo: 29,
    useCases: ["gallery"],
  },
  {
    id: "viw_seed_gallery_table",
    baseId: DEMO_AGENT_GALLERY_BASE_ID,
    slug: "grid",
    name: "表格",
    description: "同一批智能体的经典表格 —— 一份数据,两种镜头。",
    type: "table",
    config: { filters: [], sorts: [{ fieldSlug: "category", direction: "asc" }] },
    minutesAgo: 28,
    useCases: ["gallery"],
  },
];

export const agentGalleryZhCnScenario: SeedScenario = {
  bases: AGENT_GALLERY_BASES,
  records: AGENT_GALLERY_RECORDS,
  views: AGENT_GALLERY_VIEWS,
};
