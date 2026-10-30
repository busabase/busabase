/**
 * "A Busabase URL is a locator" — worded once for every agent-facing surface.
 *
 * People point their agent at something by pasting its dashboard URL. An agent that treats that
 * URL as a web page opens it in a browser, meets a sign-in wall (or a client-rendered shell), and
 * burns turns on markup, when the same object is one API call away. The URL already names the
 * deployment, the space, and the object; the agent only has to parse it.
 *
 * The shapes below are the real routes, not a guess:
 *
 * - `packages/busabase-core/src/domains/dashboard/routes.tsx` — the workbench route table
 *   (`/base/:slug/:viewId|:recordId`, `/{type}/:slug` for every `hasDetail` node type,
 *   `/inbox/:changeRequestId[/:operationId]`, `/assets/:assetId`, the space-level pages).
 *   `/base/:slug/:childId` is a view when the id is one of the Base's views, else a record
 *   (`domains/dashboard/index.tsx`); ids are `viw…` / `rec…` / `crq…` (`logic/kernel.ts` `id()`).
 * - The Busabase Cloud app's workspace routes and proxy — Cloud root host
 *   `/dashboard/<space>/…`, where `<space>` is the space slug or its id
 *   (`rootWorkspaceToken`), and workspace subdomains `<slug>.<BUSABASE_SUBDOMAIN_BASE_DOMAIN>`
 *   whose short paths (`/base/…`, `/inbox`, …) the proxy rewrites to `/dashboard/…`.
 * - `apps/busabase/src/app/dashboard/[spaceId]` — Desktop/OSS serves only `/dashboard/local/…`.
 * - `packages/busabase-core/src/domains/embed-links/` — `/embed/emb_<16>?token=<secret>`; the
 *   token is a bearer capability exchanged for a cookie, not something `/api/v1` accepts.
 *
 * Surfaces, as with `playbook-rule.ts`: `skill-doc.ts` (`/SETUP_SKILL.md`, `busabase-cli skill`),
 * `mcp-skill.ts` (session instructions + `busabase://skill`), the hand-written
 * `.agents/skills/busabase/SKILL.md` (+ `references/read-a-url.md`, which carries the table), and
 * `scripts/busabase-skills-plugin/SKILL.md.tmpl`. Every surface carries
 * {@link URL_LOCATOR_RULE_MARKDOWN} verbatim; the long-form ones also carry
 * {@link URL_LOCATOR_TABLE_MARKDOWN}. `tests/url-locator-rule-parity.test.ts` enforces both.
 */

/** The sentence every surface opens the rule with. */
export const URL_LOCATOR_RULE_HEADING = "**A Busabase URL is a locator, not a page to open.**";

/** Section title the generated surfaces put above the rule. */
export const URL_LOCATOR_SECTION_TITLE = "When the user gives you a Busabase URL";

/**
 * The canonical rule. Hard-wrapped the way the hand-written `SKILL.md` wraps it, so the parity
 * test can demand the whole block verbatim. Short on purpose: MCP sessions pay for it on every
 * `initialize`.
 */
export const URL_LOCATOR_RULE_MARKDOWN = `${URL_LOCATOR_RULE_HEADING}

When the user's message contains a Busabase URL (\`https://busabase.com/dashboard/<space>/…\`,
\`https://<workspace>.busabase.com/…\`, a self-hosted origin, or Desktop's
\`http://localhost:15419/dashboard/local/…\`), read what it points at through Busabase, never by
opening or fetching the page: the page needs a signed-in browser and returns markup, not data.
Parse it as origin → space → target. The space is the segment after \`/dashboard/\` (slug or id),
or the subdomain label on \`<workspace>.busabase.com\`, the same Cloud as \`busabase.com\`, whose
paths skip \`/dashboard/<space>\`. The rest names the target: \`/<type>/<slug>\` is a node (MCP
\`nodes_get\`, CLI \`busabase-cli nodes get --node-id <slug> --type <type>\`, HTTP
\`GET /api/v1/nodes/<slug>?type=<type>\`), \`/base/<slug>/<recordId>\` a record,
\`/inbox/<changeRequestId>\` a change request. Target the URL's space by id, never your default;
if its origin is another deployment, point your calls at that origin (CLI \`--base-url <origin>\`)
instead of reading the same path from yours. An \`/embed/emb_…?token=…\` link is a read-only capability: never repeat its token.`;

/**
 * Path → target, transport-neutral. Each surface follows it with the calls it actually has
 * (CLI + HTTP, or MCP tools).
 */
export const URL_LOCATOR_TABLE_MARKDOWN = `| Path after the space | Target | What to pass on |
| --- | --- | --- |
| \`/base/<slug>\` (also \`/design\`, \`/new\`, \`/activity\`) | the Base | its slug |
| \`/base/<slug>/<viewId>\` (\`viw…\`) | one view of the Base | the Base, then the view id |
| \`/base/<slug>/<recordId>\` (\`rec…\`; also \`/edit\`, \`/activity\`) | one record | the record id |
| \`/<type>/<slug>\` (also \`/activity\`) for \`doc\`, \`folder\`, \`skill\`, \`drive\`, \`file\`, \`airapp\`, \`form\`, \`whiteboard\`, \`workflow\`, \`html\` | that node | type + slug |
| \`/inbox/<changeRequestId>\` (\`crq…\`), \`/inbox/<changeRequestId>/<operationId>\` | a change request (one of its operations) | the change request id |
| \`/assets/<assetId>\` | one uploaded asset | the asset id |
| \`/home\`, \`/inbox\`, \`/search\`, \`/playbooks\`, \`/activity\`, \`/archived\`, \`/graph\`, \`/apps\`, \`/agents/…\`, \`/templates/…\`, \`/shared\`, \`/embed-links\` | a space-level page, not one object | the space only — work from what the user asks |
| \`/embed/emb_…?token=…\` (no space in the path) | a read-only embed of one node, record, or change request | the \`emb_…\` id only, never the token |

A \`/base/<slug>/<id>\` child is a view when it is one of that Base's view ids, otherwise a record.
A \`?demo=…\` query (or the \`org_demo_1\` space) is the in-browser demo: there is no data behind it
to read. Other query strings (\`?view=\`, \`?recordPage=\`, \`?share-preview=1\`) change only how the
page renders, not what it points at.`;
