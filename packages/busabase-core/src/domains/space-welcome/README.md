# Space welcome

One welcome page per workspace, modeled on a Confluence space homepage: a
workspace manager picks an existing **Doc** or **HTML** node and Home shows it
in a card above everything else. It is never auto-created — an agent (or a
person) writes the guide as an ordinary node first, then points the welcome at
it.

The client-safe contract and DTO/VO schemas live in
`busabase-contract/src/domains/space-welcome`. This domain owns the persistence
schema (`busabase_space_welcome`: `spaceId`, nullable `nodeId`, `version`,
`updatedAt`), the permission-aware logic and the thin router. Cloud and the
local app share the table and logic; tenant identity comes from the
host-resolved request context, never an input field.

`GET /space-welcome` returns `{ spaceId, nodeId: null, version: 0, updatedAt:
null }` when nothing has been chosen. `PUT /space-welcome` takes `{ nodeId,
expectedVersion }`, requires workspace manager access, and refuses (as
`BAD_REQUEST`, never `NOT_FOUND`) a node that does not exist in this space, is
archived or in the trash, or is not a Doc/HTML node. `nodeId: null` clears it.
Initial-insert races and stale versions return `CONFLICT` without overwriting
the winner. Members and read keys may read the choice; public-share and
Embed-Link visitors can neither read nor write it.

`NOT_FOUND` is reserved on purpose: the CLI ships separately from servers and
reads a 404 on this route as "this server predates the welcome page".

## What members see

Home (`dashboard/components/home.tsx`) reads the choice, then reads the node
itself through `nodes.get`, so the node's own ACL decides who sees it. A node
that is missing, trashed, archived, of another type, or unreadable to this
viewer is treated exactly as "not configured" — its name and content are never
shown. Each member can close the card; that is remembered per browser, per
space + member + node (a different welcome node shows again), and a "Welcome
page" button reopens it.

With no readable welcome, Home shows the built-in Getting started card (the
host's `EmptyAgentGuide` in Home mode) when the space is empty or the member has
not visited anything yet.

## Agent access

`GET`/`PUT /api/v1/space-welcome`, MCP tools `space_welcome_get` and
`space_welcome_update`, and the CLI:

```bash
busabase-cli space-welcome get --output json
busabase-cli space-welcome set --node nod_123 --expected-version 0
busabase-cli space-welcome set --clear --expected-version 1
```

The stateless demo returns no welcome and explicitly refuses writes.

`tests/space-welcome.integration.test.ts` applies the generated migrations on
PGlite and covers round-trips, space isolation, node validation, concurrent
saves, member/credential permissions, visitor denial, router context, and the
demo router.
