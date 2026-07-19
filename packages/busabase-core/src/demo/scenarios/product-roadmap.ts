import type {
  SeedBaseDef,
  SeedFieldDef,
  SeedRecordDef,
  SeedScenario,
  SeedViewDef,
} from "../seed-types";

// A schedule base whose default view is a Timeline (Gantt) — each initiative is a
// bar spanning its start→end dates. Lives under the existing Lab folder
// (DEMO_LAB_FOLDER_NODE_ID in dataset.ts), hardcoded to avoid a circular import.
const LAB_FOLDER_NODE_ID = "nod_lab";

export const DEMO_ROADMAP_BASE_ID = "bse_local_roadmap";
export const DEMO_ROADMAP_BASE_NODE_ID = "nod_base_roadmap";

// Shared field shape (same slugs/ids/choice-ids as the zh-cn twin — only labels differ).
const roadmapFields: SeedFieldDef[] = [
  {
    id: "bsf_road_title",
    slug: "title",
    name: "Initiative",
    type: "text",
    required: true,
    options: {},
  },
  {
    id: "bsf_road_start",
    slug: "start_date",
    name: "Start",
    type: "date",
    required: false,
    options: {},
  },
  { id: "bsf_road_end", slug: "end_date", name: "End", type: "date", required: false, options: {} },
  {
    id: "bsf_road_status",
    slug: "status",
    name: "Status",
    type: "select",
    required: false,
    options: {
      choices: [
        { id: "planned", name: "Planned", color: "slate" },
        { id: "in-progress", name: "In progress", color: "amber" },
        { id: "shipped", name: "Shipped", color: "emerald" },
      ],
    },
  },
  {
    id: "bsf_road_owner",
    slug: "owner",
    name: "Owner",
    type: "text",
    required: false,
    options: {},
  },
];

export const ROADMAP_BASES: SeedBaseDef[] = [
  {
    id: DEMO_ROADMAP_BASE_ID,
    nodeId: DEMO_ROADMAP_BASE_NODE_ID,
    slug: "roadmap",
    name: "Product Roadmap",
    description:
      "Quarterly initiatives on a Timeline (Gantt) — each bar spans its start and end dates; drag a bar to reschedule.",
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
      title: "Approval workflow v2",
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
      title: "Gallery & Kanban views",
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
      title: "Timeline (Gantt) view",
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
      title: "Public forms",
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
      title: "Mobile parity",
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
      title: "SSO & audit export",
      start_date: "2026-09-14",
      end_date: "2026-10-24",
      status: "planned",
      owner: "platform@busabase.local",
    },
  },
];

export const ROADMAP_RECORDS: SeedRecordDef[] = rows.map((r) => ({
  id: `rec_seed_roadmap_${r.key}`,
  baseId: DEMO_ROADMAP_BASE_ID,
  commitId: `cmt_seed_roadmap_${r.key}`,
  fields: r.fields,
  message: `Seed roadmap — ${r.fields.title}`,
  author: "seed-roadmap",
  minutesAgo: r.minutesAgo + 5400,
  useCases: ["roadmap"],
}));

export const ROADMAP_VIEWS: SeedViewDef[] = [
  {
    id: "viw_seed_roadmap_timeline",
    baseId: DEMO_ROADMAP_BASE_ID,
    slug: "timeline",
    name: "Timeline",
    description: "Every initiative as a bar across the quarter — drag to reschedule.",
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
    name: "Grid",
    description: "The same initiatives as a table.",
    type: "table",
    config: { filters: [], sorts: [{ fieldSlug: "start_date", direction: "asc" }] },
    minutesAgo: 29,
    useCases: ["roadmap"],
  },
];

export const roadmapScenario: SeedScenario = {
  bases: ROADMAP_BASES,
  records: ROADMAP_RECORDS,
  views: ROADMAP_VIEWS,
};
