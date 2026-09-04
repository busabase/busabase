/**
 * What a spawned agent is told about where it is, and how it reaches real data.
 *
 * Pure string/URL building — no db, no process, no ACP. Kept out of
 * `agent-session-manager.ts` so the wording is reviewable on its own and can be
 * unit-tested without spawning anything.
 */

/**
 * The Busabase MCP endpoint this same process serves (`/api/mcp`, Streamable
 * HTTP — see `apps/busabase/src/app/api/mcp/handler.ts`).
 *
 * Deliberately the *same* endpoint external agents have always been told to
 * connect to by hand (the "copy setup prompt" button). Spec §3: this feature
 * changes who dials, not what is dialled — so an agent Busabase spawns and an
 * agent the user wired up themselves get identical tools and identical
 * write-hygiene rules, and there is no second surface to keep in sync.
 *
 * Mirrors the base-URL convention `handler.ts` already uses for its own
 * loopback client, rather than inventing a second one.
 */
export function resolveBusabaseMcpUrl(): string {
  const configured = process.env.NEXT_PUBLIC_APP_URL?.trim().replace(/\/+$/, "");
  const base = configured || `http://localhost:${process.env.PORT?.trim() || "15419"}`;
  return `${base}/api/mcp`;
}

/**
 * `CLAUDE.md` seeded into the scratch workspace.
 *
 * Deliberately short, and deliberately *not* a copy of the MCP server's own
 * `instructions`/`busabase://skill` (see `mcp-skill.ts`) — the agent already
 * receives those over MCP, and duplicating them here would double the token
 * cost and create two places to keep the write-hygiene rules correct.
 *
 * What it covers instead is the one thing MCP cannot tell the agent, because it
 * is a fact about the filesystem rather than about Busabase: **this directory is
 * empty on purpose.** ACP's designers rejected filesystem abstraction precisely
 * because stubbing the filesystem breaks an agent's built-in tools (spec §6.5),
 * and that is exactly the situation here — `Read`/`Glob`/`Grep` land on nothing.
 * Without this note an agent asked about "my data" reasonably starts by looking
 * for files, finds none, and concludes the workspace is empty instead of
 * reaching for the MCP tools that actually hold the user's content.
 */
export function buildAgentWorkspaceGuide(spaceId: string): string {
  return `# Busabase agent workspace

## This directory is empty on purpose — the data is not in files

You are running inside a scratch directory that Busabase created for you. It is
not a project checkout. \`Read\`, \`Glob\`, \`Grep\`, and \`ls\` will find nothing
useful here, and that is expected — **an empty result from those tools is not
evidence that the user has no data.**

The user's actual content — their Bases, records, documents, files, and folders —
lives in Busabase and is reachable through the **\`busabase\` MCP server**, which
is already connected to this session. Use those tools for anything about the
user's workspace: listing nodes, reading records, searching, and proposing
changes. That server also sends its own instructions and a full reference guide
(the \`busabase://skill\` resource) — read them before your first write.

## Some folders here are apps, and they came with a manual

A folder in this workspace may be an **app** installed from a template: its
tables, its interface, and a Skill node holding the manual its author wrote for
you — which names the tables, what each field means, and what the app must never
do.

Ask the \`busabase\` MCP server's guide tool for topic \`apps\` to see which apps
this workspace has, then \`skill:<slug>\` to read one. Do that **before** acting
on an app's data: guessing a schema the app already documents is how records end
up in the wrong table.

## Writes go through Change Requests

A write does not mutate a table invisibly; it creates a **Change Request** that
carries a message, a diff, and an undo. Whether it merges straight away or waits
for a human is decided server-side by your credential's permission level — don't
reason about it, make the write and read the response's status, then report what
actually happened: "I've updated X" when it merged, "I've proposed X for your
review" when it did not. Do not review or merge a proposal the user has not asked
you to decide on.

## Files you create here

Anything you write to this directory is scratch — it is local to this machine,
not part of the user's workspace, and not visible in Busabase. To put something
into the workspace, use the MCP tools.

<!-- workspace: ${spaceId} -->
`;
}
