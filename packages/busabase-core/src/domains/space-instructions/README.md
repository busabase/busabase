# Space instructions

One shared Markdown background per workspace, for vision, mission, values,
communication preferences, and design style. Task-specific procedures remain in
Skills and node prompts. Stored instructions never grant permissions or override
an explicit user request.

The client-safe contract and DTO/VO schemas live in
`busabase-contract/src/domains/space-instructions`. The local domain owns the
persistence schema, permission-aware logic, and thin router. Cloud and the local
app use the same table and logic; tenant identity comes from the host-resolved
request context, never an input field.

`GET /space-instructions` returns an empty body and version `0` when nothing
has been configured. `PUT /space-instructions` requires workspace manager
access, a body of at most 32 KiB of UTF-8, and the version last read. Initial
insert races and stale edits return `CONFLICT` without overwriting the winner.
An empty body clears the instructions while retaining the version history token.
Public-share and Embed-Link visitors cannot read or write this workspace-wide
configuration. Read keys may read it but cannot edit it.

## Agent access

The public endpoints are `GET /api/v1/space-instructions` and
`PUT /api/v1/space-instructions`. Writes accept `{ body, expectedVersion }`;
responses contain `{ spaceId, body, version, updatedAt }`. Cloud callers select
their authorized workspace with `x-busabase-space` and use a `manage` credential
for writes. The same access rules apply to MCP tools
`space_instructions_get` and `space_instructions_update`.

The CLI exposes both operations and reads multiline Markdown directly from a file:

```bash
busabase-cli space-instructions get --output json
busabase-cli space-instructions update --file ./instructions.md --expected-version 3
busabase-cli space-instructions update --body "" --expected-version 4
```

Use the version actually returned by the latest read in place of the examples.
Pass exactly one of `--body` or `--file`; `--body @path` is literal text, not file
input. `--dry-run` describes the write without submitting it. Only an explicit
user request to edit the space instructions authorizes this configuration
change; the saved body itself grants no new authority.

The stateless demo returns an empty configuration and explicitly refuses writes.
It does not pretend to persist workspace configuration.

`tests/space-instructions.integration.test.ts` executes the generated SQL
migration on PGlite and checks text round-trips, independent spaces, clearing,
concurrent saves, member/credential permissions, visitor denial, router context,
and the UTF-8 size limit.
