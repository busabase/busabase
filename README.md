<div align="center">

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="./apps/busabase/public/icon-dark.svg" />
  <img src="./apps/busabase/public/icon.svg" alt="Busabase" width="96" height="96" />
</picture>

<h1>Busabase</h1>

<h3>The System of Record for AI Agents</h3>

<p>Different agents. One shared base.<br/>
The open-source database &amp; workspace where Claude Code, Codex, Cursor, and your own agents keep the records, docs, skills, and apps the next task builds on.</p>

<p>
<a href="./apps/busabase/docs/README_zh-CN.md">中文</a> &nbsp;·&nbsp;
<a href="./apps/busabase/docs/README_ja.md">日本語</a> &nbsp;·&nbsp;
<a href="./apps/busabase/docs/README_ko.md">한국어</a>
</p>

<p align="center">
<a href="https://www.producthunt.com/products/busabase?embed=true&amp;utm_source=badge-featured&amp;utm_medium=badge&amp;utm_campaign=badge-busabase" target="_blank" rel="noopener noreferrer"><img alt="Busabase - The General System of Record for AI Agents | Product Hunt" width="250" height="54" src="https://api.producthunt.com/widgets/embed-image/v1/featured.svg?post_id=1189118&amp;theme=light&amp;t=1791453316155"></a>
</p>

<p>
<a href="https://www.npmjs.com/package/busabase"><img src="https://img.shields.io/npm/v/busabase?logo=npm&label=busabase&color=3fb950" alt="npm busabase" /></a>
<a href="https://www.npmjs.com/package/busabase-cli"><img src="https://img.shields.io/npm/v/busabase-cli?logo=npm&label=busabase-cli&color=3fb950" alt="npm busabase-cli" /></a>
<a href="https://hub.docker.com/r/busabase/busabase"><img src="https://img.shields.io/docker/image-size/busabase/busabase/latest?logo=docker&label=docker" alt="Docker image" /></a>
<a href="https://github.com/busabase/busabase/tree/main/packages/busabase-core/tests"><img src="./apps/busabase/public/assets/readme/coverage.svg" alt="Test coverage (busabase-core engine)" /></a>
<a href="https://busabase.com/download"><img src="https://img.shields.io/badge/Desktop-Download-1f6feb?logo=tauri&logoColor=white" alt="Download Busabase Desktop" /></a>
<a href="https://glama.ai/mcp/connectors/com.busabase/busabase"><img src="https://glama.ai/mcp/connectors/com.busabase/busabase/badges/score.svg" alt="Glama MCP connector score" /></a>
<a href="https://opensource.org/licenses/MIT"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="License MIT" /></a>
<a href="https://github.com/busabase/busabase/stargazers"><img src="https://img.shields.io/github/stars/busabase/busabase?style=social" alt="GitHub stars" /></a>
</p>

<p>
<a href="#quick-start"><b>Quick Start</b></a> &nbsp;·&nbsp;
<a href="#features">Features</a> &nbsp;·&nbsp;
<a href="#connect-your-agent">Connect an Agent</a> &nbsp;·&nbsp;
<a href="#use-cases">Use Cases</a> &nbsp;·&nbsp;
<a href="https://busabase.com/docs">Docs</a> &nbsp;·&nbsp;
<a href="https://community.busabase.com/community">Community</a>
</p>

<br/>

<a href="#features"><img src="./apps/busabase/public/assets/readme/busabase-hero.webp" alt="Claude Code writes this week's content posts into a shared Busabase board, which stays current for the next week's work" width="100%" /></a>

</div>

<br/>

> Busabase is an open-source database and workspace for AI agents — agents and people share the same structured data, docs, skills, and apps, and writes that matter become reviewed, trusted records.

Every agent session starts from zero. Your `CLAUDE.md` lives in one repo, the best output dies in a chat, and switching tools means explaining the project all over again.

Busabase keeps the agents stateless and the work durable: connect any agent, and it reads the same records, docs, skills, and apps your team and other agents already left behind — then writes its own work back, with a diff and a history.

## Quick Start

```bash
npx busabase server
```

Open **http://localhost:15419/dashboard/local** — no database, account, or config. It starts with embedded PGlite, local file storage, and a demo workspace.

Then point your agent at it. Paste into Claude Code, Codex, Cursor, Gemini CLI, or any agent that can read a URL:

```text
Read and follow the Busabase Agent Skill — it is the single source of truth:
http://localhost:15419/SETUP_SKILL.md

Follow its onboarding to connect to this workspace. Don't choose a merge policy yourself unless I ask for one — submit the change and let Busabase apply my permissions to decide whether it merges now or waits for review. Reply to me in English.
```

**Try this:** have one agent record a project's updates and conventions, then open a different agent and ask *"What changed on this project this week?"* It answers from the workspace, not from your clipboard.

<details>
<summary><b>Docker · Desktop · global install · from source</b></summary>

```bash
# Docker (Docker Hub: busabase/busabase · GHCR: ghcr.io/busabase/busabase)
docker run --rm -p 15419:15419 -v ~/.busabase/data:/data busabase/busabase

# Global install
npm i -g busabase       # then: busabase server
npx busabase-cli --help # API client for any Busabase server

# From source
pnpm install
cp apps/busabase/.env.example apps/busabase/.env
pnpm --filter busabase dev
```

**Desktop** for macOS, Windows, and Linux: **[busabase.com/download](https://busabase.com/download)** — runs locally and works offline.

Local data lives in `~/.busabase/data/` (`pgdata/` for the embedded PGlite database, `storage/` for files). Set `BUSABASE_DATA_DIR`, `PG_DATABASE_URL`, or `STORAGE_URL` to use another location, external Postgres, or S3-compatible storage. Only one process can hold the same PGlite database at a time.

</details>

## Features

- **One workspace for every kind of agent output** — Bases (typed records, relations, views, forms), Docs, Files, Drives, Skills, AirApps, Whiteboards, and Workflows as first-class nodes in one tree. [Node types →](./apps/busabase/docs/node-types.md)
- **Shared skills across agents** — keep `SKILL.md` playbooks and custom prompts in the workspace. **Playbooks** collects them into one catalog every connected agent can look up before it acts.
- **Every write accounted for** — agent writes travel as Change Requests with a message, a field-level diff, an author, and history. Permissions decide whether a change merges on the spot or waits for review.
- **Apps on live data** — ask an agent to turn a Base into a dashboard, CRM, or content desk. AirApps run inside Busabase on workspace data, with a `SKILL.md` the next agent can read.
- **Bring any agent** — no built-in model, no lock-in. Agent Skill, MCP, OpenAPI, CLI, or an ACP chat session.
- **Templates** — install a whole working setup (Bases, views, docs, sample data, apps, and its agent manual) in one command.
- **Local-first and open source** — MIT, embedded database, works offline. The same engine powers [Busabase Cloud](https://busabase.com).

<img src="./apps/busabase/public/assets/readme/busabase-workspace-home.webp" alt="Busabase workspace home with review queue, recently visited knowledge, and agent activity" width="100%" />

|  |  |
| :---: | :---: |
| ![Structured Base for agent data](./apps/busabase/public/assets/readme/busabase-base-table.webp) | ![Durable agent knowledge in a Doc](./apps/busabase/public/assets/readme/busabase-doc-detail.webp) |
| **Database** — typed, related, queryable records | **Knowledge base** — durable docs with version history |
| ![Reusable agent Skill](./apps/busabase/public/assets/readme/busabase-skill-detail.webp) | ![Workspace-native AirApps](./apps/busabase/public/assets/readme/busabase-apps-gallery.webp) |
| **Skills** — reusable instructions and supporting files | **Apps** — focused interfaces built on workspace data |
| ![Agent-proposed field diff](./apps/busabase/public/assets/readme/busabase-agent-output-preview.webp) | ![Record history and audit trail](./apps/busabase/public/assets/readme/busabase-record-detail-audit.webp) |
| **Change Requests** — see exactly what an agent changed | **History** — source, reviewer, commit, and timeline |
| ![Product launch Whiteboard](./apps/busabase/public/assets/readme/busabase-whiteboard.webp) | ![Lead intake Workflow](./apps/busabase/public/assets/readme/busabase-workflow.webp) |
| **Whiteboards** — visual context shared with agents | **Workflows** — processes kept beside their data |

<details>
<summary><b>On mobile</b></summary>

Review agent Change Requests and open records from the [Busabase mobile app](https://github.com/busabase/busabase/tree/main/apps/busabase-mobile).

<p align="center">
  <img src="./apps/busabase/public/assets/readme/mobile-inbox-framed.webp" alt="Mobile Inbox" width="30%" />
  &nbsp;&nbsp;
  <img src="./apps/busabase/public/assets/readme/mobile-change-request-framed.webp" alt="Mobile Change Request review" width="30%" />
  &nbsp;&nbsp;
  <img src="./apps/busabase/public/assets/readme/mobile-record-framed.webp" alt="Mobile canonical record" width="30%" />
</p>

</details>

## Connect Your Agent

Works with **Claude Code · Codex · Cursor · Gemini CLI · OpenCode · OpenClaw · Hermes · Buda AI · n8n** — or your own process.

| Connection | Best for |
| --- | --- |
| **Agent Skill** | Coding agents and local CLIs that can follow workspace instructions |
| **MCP** | Tool-aware agents and IDEs that need typed workspace operations |
| **OpenAPI / CLI** | Apps, scripts, automations, and custom agents |
| **Agents view (ACP)** | Conversational sessions with inline tool activity and permission requests |

Guides: [Claude Code](./apps/busabase/docs/claude-code.md) · [DeepSeek Harness](./apps/busabase/docs/deepseek-harness.md) · [Bring Your Own Agent](./apps/busabase/docs/bring-your-agent.md). Open **Agent Skills** in the sidebar for the MCP endpoint and OpenAPI spec of your running instance (`/api/v1/doc`). Also on [Glama's MCP directory](https://glama.ai/mcp/connectors/com.busabase/busabase).

<details>
<summary><b>How writes work</b></summary>

```text
Agent reads workspace context
        ↓
Agent writes data, docs, skills, or app changes — always as a Change Request
        ↓
Your permissions decide: it merges on the spot, or it waits in the Inbox
        ↓
Either way the change stays inspectable, attributable, and reversible
```

A credential capped at `changeRequest` level can only propose; a single call can opt in with `autoMerge: false`; `busabase-cli install … --require-review` holds a package's content back for approval. Anything else that is allowed to write, writes — and still leaves a diff and a history behind.

</details>

## Use Cases

| Workspace | What agents do | What stays in Busabase |
| --- | --- | --- |
| **Software delivery** | Turn feedback into tasks, write and test code, ship, start the next cycle | Feedback, tasks, specs, conventions, release notes |
| **SEO & content** | Track search trends, plan, draft the next article in a shared CMS | Keyword research, briefs, drafts, published pages |
| **CRM** | Research prospects, follow up, log every visit | Companies, contacts, visit notes, follow-ups |
| **Team memory** | Capture decisions, sources, and operating context | A knowledge base the next agent starts from |
| **Datasets** | Label examples, attach evidence, score quality | Reviewed training and evaluation data |

Start from a template — the whole app, its data, and the manual that tells an agent how to use it:

```bash
busabase-cli install https://github.com/busabase/templates/tree/main/templates/busa-crm
```

Browse [busabase.com/templates](https://busabase.com/templates) and [all use cases](./apps/busabase/docs/use-cases.md).

## How It Compares

| | Designed for | Missing when agents do the work |
| --- | --- | --- |
| Airtable, Notion, Baserow, NocoDB | People editing directly | Agent-native access, shared skills and apps, a proposal boundary |
| Postgres | Applications reading and writing storage | A workspace UI, knowledge model, review loop, and provenance |
| Agent memory, vector DBs | One agent recalling context | Structured facts people can open, cite, and correct |
| **Busabase** | **People and agents building one workspace** | — |

Busabase runs on Postgres (or embedded PGlite) itself; it is the workspace on top, not a replacement for your app's database.

## Editions

| Open source / Personal Desktop | Busabase Cloud |
| --- | --- |
| MIT-licensed and free | Hosted, multi-user workspace |
| Local PGlite and file storage | Managed Postgres and object storage |
| No login, works offline | Spaces, roles, permissions, Team Insights |
| Data stays on your machine | Web and mobile access |

**Cloud Connect** links a local workspace to [Busabase Cloud](https://busabase.com) through an authenticated tunnel — your machine keeps the data and runs local agents. See [pricing](https://busabase.com/pricing).

## Architecture

<div align="center">
  <img src="./apps/busabase/public/architecture-diagram.svg" alt="Busabase architecture diagram" width="100%">
</div>

`apps/busabase` is the local, single-workspace Next.js shell. The workspace engine lives in `packages/busabase-core`: nodes, records, file trees, rich node types, review primitives, search, agents, and API contracts — exposed through MCP, OpenAPI, and `busabase-cli`. Cloud runs the same engine with multi-tenant identity, permissions, and hosted storage.

**Security:** the open-source server is designed for a trusted local machine or private network. Do not expose write endpoints to the public internet without authentication and a reverse proxy; use scoped credentials and Cloud Connect for remote access.

## Contributing

```bash
pnpm install
pnpm --filter busabase dev
pnpm --filter busabase typecheck
pnpm --filter busabase lint:err
```

Bug reports, ideas, docs, and pull requests are welcome in [Issues](https://github.com/busabase/busabase/issues) and [Discussions](https://github.com/busabase/busabase/discussions).

## Community

[Website](https://busabase.com) · [Docs](https://busabase.com/docs) · [Forum](https://community.busabase.com/community) · [YouTube](https://www.youtube.com/@BusabaseAI) · [X](https://x.com/Busabase4agent) · [LinkedIn](https://www.linkedin.com/company/busabase/)

If Busabase is useful to you, a ⭐ helps other agent builders find it.

<a href="https://github.com/busabase/busabase/graphs/contributors"><img src="https://contrib.rocks/image?repo=busabase/busabase" alt="Busabase contributors" /></a>

## License

[MIT](./LICENSE) © Busabase
