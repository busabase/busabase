import type {
  SeedBaseDef,
  SeedFieldDef,
  SeedRecordDef,
  SeedScenario,
  SeedViewDef,
} from "../seed-types";

// Lives under the CMS folder (DEMO_CMS_FOLDER_NODE_ID in dataset.ts —
// "Website content — blog articles and reviewed landing pages"). Hardcoded here
// to avoid a circular import back into dataset.ts.
const CMS_FOLDER_NODE_ID = "nod_cms";

export const DEMO_AGENT_INTEGRATIONS_BASE_ID = "bse_local_agent_integrations";
export const DEMO_AGENT_INTEGRATIONS_BASE_NODE_ID = "nod_base_agent_integrations";

// Shared field shape (same slugs/ids/choice-ids as the zh-cn twin — only labels
// + record content differ).
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
    name: "Category",
    type: "select",
    required: false,
    options: {
      choices: [
        { id: "coding-agent", name: "Coding Agent", color: "violet" },
        { id: "ai-ide", name: "AI IDE", color: "cyan" },
        { id: "autonomous", name: "Autonomous Agent", color: "amber" },
        { id: "web-agent", name: "Web Agent", color: "emerald" },
        { id: "business-agent", name: "Business Agent", color: "rose" },
      ],
    },
  },
  {
    id: "bsf_ai_connect_via",
    slug: "connect_via",
    name: "Connect via",
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
    name: "Status",
    type: "select",
    required: false,
    options: {
      choices: [
        { id: "published", name: "Published", color: "emerald" },
        { id: "draft", name: "Draft", color: "slate" },
      ],
    },
  },
  {
    id: "bsf_ai_tagline",
    slug: "tagline",
    name: "Tagline",
    type: "text",
    required: false,
    options: {},
  },
  {
    id: "bsf_ai_body",
    slug: "body",
    name: "Landing page",
    type: "markdown",
    required: true,
    options: {},
  },
  {
    id: "bsf_ai_docs",
    slug: "docs_url",
    name: "Docs URL",
    type: "url",
    required: false,
    options: {},
  },
  {
    id: "bsf_ai_published",
    slug: "published",
    name: "Published",
    type: "date",
    required: false,
    options: {},
  },
];

export const AGENT_INTEGRATIONS_BASES: SeedBaseDef[] = [
  {
    id: DEMO_AGENT_INTEGRATIONS_BASE_ID,
    nodeId: DEMO_AGENT_INTEGRATIONS_BASE_NODE_ID,
    slug: "agent-integrations",
    name: "Agent Integrations",
    description:
      "Landing-page articles for every AI agent that plugs into Busabase — Codex, Cursor, Claude Code, Hermes Agent, OpenClaw, Buda AI Agent. Each row is one '<Agent> × Busabase' page describing what it can do.",
    folderNodeId: CMS_FOLDER_NODE_ID,
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
  docsUrl: string;
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
    tagline: "Give Codex a real data backend",
    docsUrl: "https://busabase.com/docs",
    published: "2026-06-20",
    body: `# Codex × Busabase

Connect Codex to Busabase so generated code reads and writes against a live, typed datastore instead of throwaway fixtures — turning prototypes into shippable apps.

## What you can do
- **Typed data from a prompt** — Codex calls the Busabase API to fetch records with their field types, so generated code compiles against your real schema.
- **Persist what it builds** — Scaffolded CRUD flows write straight into Busabase tables; no separate database to provision.
- **Versioned & auditable** — Every record change Codex makes is tracked, so you can review and roll back agent edits.

## How it connects
1. **Create a Busabase base** with the tables Codex will read from and write to.
2. **Issue a scoped API key** and point Codex at the REST API (\`/api/v1\`).
3. **Let the agent run** — every change is versioned and auditable in Busabase.

## Example use cases
- Generate a back-office admin from an existing Busabase base.
- Seed and migrate demo data while scaffolding a feature.
- Wire API routes to typed records without hand-writing the data layer.`,
  },
  {
    key: "cursor",
    minutesAgo: 120,
    agent: "Cursor",
    slug: "cursor",
    category: "ai-ide",
    connectVia: "rest-api",
    tagline: "Query your data without leaving the editor",
    docsUrl: "https://busabase.com/docs",
    published: "2026-06-21",
    body: `# Cursor × Busabase

Add Busabase as a tool source in Cursor so its agent can inspect tables, run queries and mutate records inline while you build.

## What you can do
- **Schema-aware completions** — Cursor reads your Busabase field definitions, so suggestions match the actual columns and types.
- **Inline data queries** — Ask Cursor for a slice of records and it calls the Busabase API and pastes the result back in context.
- **Safe writes** — Mutations go through scoped API keys and are logged in Busabase, so editor-driven edits stay reviewable.

## How it connects
1. **Create a Busabase base** for the data Cursor should reach.
2. **Issue a scoped API key** and point Cursor at the REST API (\`/api/v1\`).
3. **Let the agent run** — reads and writes stay scoped and auditable.

## Example use cases
- Explore an unfamiliar dataset while refactoring.
- Generate and validate fixtures against the real schema.
- Batch-update records from a natural-language instruction.`,
  },
  {
    key: "claude-code",
    minutesAgo: 180,
    agent: "Claude Code",
    slug: "claude-code",
    category: "coding-agent",
    connectVia: "mcp",
    tagline: "Your terminal agent, backed by structured data",
    docsUrl: "https://busabase.com/docs",
    published: "2026-06-22",
    body: `# Claude Code × Busabase

Expose Busabase to Claude Code over MCP so it can plan against real records, store its work, and keep long-running tasks grounded in your data.

## What you can do
- **MCP-native access** — Busabase ships an MCP surface, so Claude Code discovers tables and fields as first-class tools.
- **Durable task memory** — Write intermediate results into a base so multi-step jobs survive across sessions.
- **Auditable automation** — Every read and write is scoped and logged, so unattended runs stay accountable.

## How it connects
1. **Create a Busabase base** for the task's records.
2. **Issue a scoped API key** and add the Busabase MCP endpoint to Claude Code.
3. **Let the agent run** — progress is persisted and every change is tracked.

## Example use cases
- Triage and label a backlog of records overnight.
- Keep a knowledge base in sync from the command line.
- Run repeatable data migrations as an agent task.`,
  },
  {
    key: "hermes-agent",
    minutesAgo: 240,
    agent: "Hermes Agent",
    slug: "hermes-agent",
    category: "autonomous",
    connectVia: "rest-api",
    tagline: "Long-running automations on top of your data",
    docsUrl: "https://busabase.com/docs",
    published: "2026-06-23",
    body: `# Hermes Agent × Busabase

Point Hermes Agent at Busabase to drive scheduled, event-driven workflows — it reacts to record changes and writes results back as a single source of truth.

## What you can do
- **Event-driven triggers** — Hermes watches Busabase for new or changed records and kicks off workflows automatically.
- **Stateful pipelines** — Each step persists progress to a base, so failures resume instead of restarting.
- **One source of truth** — Outputs land in Busabase tables your team and other tools already read.

## How it connects
1. **Create a Busabase base** that holds the workflow's records.
2. **Issue a scoped API key** and point Hermes Agent at the REST API (\`/api/v1\`).
3. **Let the agent run** — reactions and results are versioned and auditable.

## Example use cases
- Enrich inbound leads the moment they are created.
- Run nightly reconciliation across linked tables.
- Fan out notifications when a record hits a threshold.`,
  },
  {
    key: "openclaw",
    minutesAgo: 300,
    agent: "OpenClaw",
    slug: "openclaw",
    category: "web-agent",
    connectVia: "rest-api",
    tagline: "Turn scraped pages into structured records",
    docsUrl: "https://busabase.com/docs",
    published: "2026-06-24",
    body: `# OpenClaw × Busabase

Send OpenClaw's browsing and extraction output straight into Busabase, so messy web data becomes typed, deduplicated records you can query.

## What you can do
- **Extraction to schema** — Map OpenClaw's extracted fields onto Busabase columns so output is consistent every run.
- **Built-in dedup** — Use a key field to upsert, so re-crawls update existing rows instead of duplicating them.
- **Query the harvest** — Filtered views and the API let downstream tools consume the crawl results instantly.

## How it connects
1. **Create a Busabase base** whose columns match your extraction schema.
2. **Issue a scoped API key** and point OpenClaw at the REST API (\`/api/v1\`).
3. **Let the agent run** — crawl results upsert into typed, auditable records.

## Example use cases
- Build a competitor price table that refreshes itself.
- Collect a research corpus into one queryable base.
- Monitor listings and flag changes over time.`,
  },
  {
    key: "buda-ai-agent",
    minutesAgo: 360,
    agent: "Buda AI Agent",
    slug: "buda-ai-agent",
    category: "business-agent",
    connectVia: "rest-api",
    tagline: "Run your business workflows on Busabase data",
    docsUrl: "https://busabase.com/docs",
    published: "2026-06-25",
    body: `# Buda AI Agent × Busabase

Buda's business agents use Busabase as their operational datastore — CRM, projects and marketplace records live in bases the agent reads, reasons over and updates.

## What you can do
- **Operational datastore** — Buda agents treat Busabase bases as the system of record for customers, deals and tasks.
- **Cross-domain joins** — Linked tables let the agent reason across CRM, projects and marketplace in one place.
- **Closed-loop actions** — Decisions write back to Busabase, so the next run sees the updated state.

## How it connects
1. **Create a Busabase base** for the business domain (CRM, projects, marketplace).
2. **Issue a scoped API key** and connect the Buda AI Agent over the REST API (\`/api/v1\`).
3. **Let the agent run** — decisions are written back and fully auditable.

## Example use cases
- Automate lead-to-deal handoffs from a CRM base.
- Keep a marketplace catalog accurate and in stock.
- Generate weekly status from live project records.`,
  },
];

export const AGENT_INTEGRATIONS_RECORDS: SeedRecordDef[] = rows.map((r) => ({
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
    docs_url: r.docsUrl,
    published: r.published,
  },
  message: `Seed agent integration — ${r.agent}`,
  author: "seed-content",
  // Older than the core seed records so they don't displace them in the recent page.
  minutesAgo: r.minutesAgo + 5000,
  useCases: ["agent-integrations"],
}));

export const AGENT_INTEGRATIONS_VIEWS: SeedViewDef[] = [
  {
    id: "viw_seed_agint_published",
    baseId: DEMO_AGENT_INTEGRATIONS_BASE_ID,
    slug: "published",
    name: "Published",
    description: "Every live agent landing page, newest first.",
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
    name: "By category",
    description: "Agents grouped by the kind of integration.",
    config: { filters: [], sorts: [{ fieldSlug: "category", direction: "asc" }] },
    minutesAgo: 59,
    useCases: ["agent-integrations"],
  },
  {
    id: "viw_seed_agint_mcp",
    baseId: DEMO_AGENT_INTEGRATIONS_BASE_ID,
    slug: "mcp-native",
    name: "MCP-native",
    description: "Agents that connect over the Model Context Protocol.",
    config: {
      filters: [{ fieldSlug: "connect_via", operator: "equals", value: "mcp" }],
      sorts: [{ fieldSlug: "agent", direction: "asc" }],
    },
    minutesAgo: 58,
    useCases: ["agent-integrations"],
  },
];

export const agentIntegrationsScenario: SeedScenario = {
  bases: AGENT_INTEGRATIONS_BASES,
  records: AGENT_INTEGRATIONS_RECORDS,
  views: AGENT_INTEGRATIONS_VIEWS,
};
