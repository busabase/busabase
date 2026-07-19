import type {
  SeedBaseDef,
  SeedFieldDef,
  SeedRecordDef,
  SeedScenario,
  SeedViewDef,
} from "../seed-types";
import { DEMO_ROADMAP_BASE_ID, DEMO_ROADMAP_BASE_NODE_ID } from "./product-roadmap";

// 与英文版同一个「实验室」文件夹(DEMO_LAB_FOLDER_NODE_ID),挂在其下。
const LAB_FOLDER_NODE_ID = "nod_lab";

// 字段 slug / 选项 id 与英文版保持一致,仅展示名称为中文。
const roadmapFields: SeedFieldDef[] = [
  { id: "bsf_road_title", slug: "title", name: "事项", type: "text", required: true, options: {} },
  {
    id: "bsf_road_start",
    slug: "start_date",
    name: "开始",
    type: "date",
    required: false,
    options: {},
  },
  {
    id: "bsf_road_end",
    slug: "end_date",
    name: "结束",
    type: "date",
    required: false,
    options: {},
  },
  {
    id: "bsf_road_status",
    slug: "status",
    name: "状态",
    type: "select",
    required: false,
    options: {
      choices: [
        { id: "planned", name: "计划中", color: "slate" },
        { id: "in-progress", name: "进行中", color: "amber" },
        { id: "shipped", name: "已发布", color: "emerald" },
      ],
    },
  },
  {
    id: "bsf_road_owner",
    slug: "owner",
    name: "负责人",
    type: "text",
    required: false,
    options: {},
  },
];

const ROADMAP_BASES: SeedBaseDef[] = [
  {
    id: DEMO_ROADMAP_BASE_ID,
    nodeId: DEMO_ROADMAP_BASE_NODE_ID,
    slug: "roadmap",
    name: "产品路线图",
    description: "季度事项排在时间线(Gantt)上 —— 每根条覆盖它的起止日期;拖动条即可改期。",
    folderNodeId: LAB_FOLDER_NODE_ID,
    useCases: ["roadmap"],
    fields: roadmapFields,
  },
];

type RoadmapRow = {
  key: string;
  minutesAgo: number;
  fields: Record<string, unknown>;
};

const rows: RoadmapRow[] = [
  {
    key: "approvals",
    minutesAgo: 40,
    fields: {
      title: "审批流 v2",
      start_date: "2026-05-04",
      end_date: "2026-06-12",
      status: "shipped",
      owner: "platform@busabase.local",
    },
  },
  {
    key: "gallery_views",
    minutesAgo: 80,
    fields: {
      title: "相册与看板视图",
      start_date: "2026-06-01",
      end_date: "2026-07-15",
      status: "in-progress",
      owner: "product@busabase.local",
    },
  },
  {
    key: "timeline",
    minutesAgo: 120,
    fields: {
      title: "时间线(Gantt)视图",
      start_date: "2026-07-07",
      end_date: "2026-08-08",
      status: "in-progress",
      owner: "product@busabase.local",
    },
  },
  {
    key: "public_forms",
    minutesAgo: 160,
    fields: {
      title: "公开表单",
      start_date: "2026-08-11",
      end_date: "2026-09-19",
      status: "planned",
      owner: "product@busabase.local",
    },
  },
  {
    key: "mobile",
    minutesAgo: 200,
    fields: {
      title: "移动端对齐",
      start_date: "2026-08-25",
      end_date: "2026-10-10",
      status: "planned",
      owner: "mobile@busabase.local",
    },
  },
  {
    key: "sso",
    minutesAgo: 240,
    fields: {
      title: "SSO 与审计导出",
      start_date: "2026-09-14",
      end_date: "2026-10-24",
      status: "planned",
      owner: "platform@busabase.local",
    },
  },
];

const ROADMAP_RECORDS: SeedRecordDef[] = rows.map((r) => ({
  id: `rec_seed_roadmap_${r.key}`,
  baseId: DEMO_ROADMAP_BASE_ID,
  commitId: `cmt_seed_roadmap_${r.key}`,
  fields: r.fields,
  message: `种子·路线图 —— ${r.fields.title}`,
  author: "seed-roadmap",
  minutesAgo: r.minutesAgo + 5400,
  useCases: ["roadmap"],
}));

const ROADMAP_VIEWS: SeedViewDef[] = [
  {
    id: "viw_seed_roadmap_timeline",
    baseId: DEMO_ROADMAP_BASE_ID,
    slug: "timeline",
    name: "时间线",
    description: "每个事项一根跨季度的条 —— 拖动即可改期。",
    type: "gantt",
    config: {
      filters: [],
      sorts: [{ fieldSlug: "start_date", direction: "asc" }],
      startFieldSlug: "start_date",
      endFieldSlug: "end_date",
      ganttScale: "month",
    },
    minutesAgo: 30,
    useCases: ["roadmap"],
  },
  {
    id: "viw_seed_roadmap_table",
    baseId: DEMO_ROADMAP_BASE_ID,
    slug: "grid",
    name: "表格",
    description: "同一批事项的表格视图。",
    type: "table",
    config: { filters: [], sorts: [{ fieldSlug: "start_date", direction: "asc" }] },
    minutesAgo: 29,
    useCases: ["roadmap"],
  },
];

export const roadmapZhCnScenario: SeedScenario = {
  bases: ROADMAP_BASES,
  records: ROADMAP_RECORDS,
  views: ROADMAP_VIEWS,
};
