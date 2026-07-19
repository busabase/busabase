import type {
  SeedBaseDef,
  SeedFieldDef,
  SeedRecordDef,
  SeedScenario,
  SeedViewDef,
} from "../seed-types";

// A visual, image-first showcase base — its default view is a Gallery, so the
// demo ships with a working "photo album / card wall" out of the box. Lives
// under the existing Lab folder (DEMO_LAB_FOLDER_NODE_ID in dataset.ts),
// hardcoded here to avoid a circular import back into dataset.ts.
const LAB_FOLDER_NODE_ID = "nod_lab";

export const DEMO_AGENT_GALLERY_BASE_ID = "bse_local_agent_gallery";
export const DEMO_AGENT_GALLERY_BASE_NODE_ID = "nod_base_agent_gallery";

// Shared field shape (same slugs/ids/choice-ids as the zh-cn twin — only labels differ).
const agentGalleryFields: SeedFieldDef[] = [
  { id: "bsf_gal_name", slug: "name", name: "Agent", type: "text", required: true, options: {} },
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
    name: "Tagline",
    type: "text",
    required: false,
    options: {},
  },
  {
    id: "bsf_gal_category",
    slug: "category",
    name: "Category",
    type: "select",
    required: false,
    options: {
      choices: [
        { id: "coding", name: "Coding agent", color: "violet" },
        { id: "assistant", name: "Assistant", color: "cyan" },
        { id: "automation", name: "Automation", color: "emerald" },
      ],
    },
  },
  {
    id: "bsf_gal_status",
    slug: "status",
    name: "Status",
    type: "select",
    required: false,
    options: {
      choices: [
        { id: "connected", name: "Connected", color: "emerald" },
        { id: "available", name: "Available", color: "slate" },
        { id: "beta", name: "Beta", color: "amber" },
      ],
    },
  },
  {
    id: "bsf_gal_website",
    slug: "website",
    name: "Website",
    type: "url",
    required: false,
    options: {},
  },
];

export const AGENT_GALLERY_BASES: SeedBaseDef[] = [
  {
    id: DEMO_AGENT_GALLERY_BASE_ID,
    nodeId: DEMO_AGENT_GALLERY_BASE_NODE_ID,
    slug: "agent-gallery",
    name: "Agent Gallery",
    description:
      "A visual catalog of the coding agents and assistants that connect to Busabase — browsed as a Gallery view, each card fronted by the agent's logo.",
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
      tagline: "Anthropic's agentic coding tool in the terminal.",
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
      tagline: "The AI code editor built for pair-programming with agents.",
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
      tagline: "OpenAI's software-engineering agent.",
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
      name: "Buda Agent",
      tagline: "Runs long-horizon tasks against your bases and drive.",
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
      tagline: "Open-source agent runtime for approval-first workflows.",
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
      tagline: "Message-driven automation agent for outgoing hooks.",
      category: "automation",
      status: "available",
      website: "https://busabase.com",
    },
  },
];

export const AGENT_GALLERY_RECORDS: SeedRecordDef[] = rows.map((r) => ({
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
  message: `Seed agent gallery — ${r.fields.name}`,
  author: "seed-gallery",
  // Older than the core seed records so they don't displace them in the recent page.
  minutesAgo: r.minutesAgo + 5200,
  useCases: ["gallery"],
}));

export const AGENT_GALLERY_VIEWS: SeedViewDef[] = [
  {
    id: "viw_seed_gallery_all",
    baseId: DEMO_AGENT_GALLERY_BASE_ID,
    slug: "gallery",
    name: "Gallery",
    description: "Every connected agent as a card, fronted by its logo.",
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
    name: "Connected",
    description: "Only the agents currently wired up — still a gallery.",
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
    name: "Grid",
    description: "The same agents in a classic table — one dataset, two lenses.",
    type: "table",
    config: { filters: [], sorts: [{ fieldSlug: "category", direction: "asc" }] },
    minutesAgo: 28,
    useCases: ["gallery"],
  },
];

export const agentGalleryScenario: SeedScenario = {
  bases: AGENT_GALLERY_BASES,
  records: AGENT_GALLERY_RECORDS,
  views: AGENT_GALLERY_VIEWS,
};
