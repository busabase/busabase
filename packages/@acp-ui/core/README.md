# @acp-ui/core

Headless interaction core for **ACP** (Agent Client Protocol) agent chat. Renders nothing.

## What it is

A reducer over ACP session events:

```ts
import { reduceAcpEvent, reduceAcpEvents } from "@acp-ui/core/reduce";

// live streaming — call per event as it arrives
setBlocks((prev) => reduceAcpEvent(prev, event));

// replay — fold a persisted array; produces identical output
const blocks = reduceAcpEvents([], await listSessionEvents(sessionId));
```

Both ACP Router and Busabase need **both** paths: each already streams live and
each already persists its events. One function serves both, and a test pins that they agree —
if they diverged, replaying a stored session would look different from having watched it.

## Scope: ACP only, and deliberately not the AI SDK

This package exists *because* routing ACP through the Vercel AI SDK's `UIMessage` is lossy:

- ACP's `session/request_permission` carries a **list** of options ("allow once", "always
  allow", "reject", …). The AI SDK's approval state is `approved: boolean` — the option
  semantics don't survive the trip.
- **8 of ACP's 13 `sessionUpdate` kinds** have no native `UIMessage` part (`plan`,
  `plan_update`, `plan_removed`, `available_commands_update`, `current_mode_update`,
  `config_option_update`, `session_info_update`, `usage_update`).

So `src/` may not import `ai`, `@ai-sdk/*`, or `@kaiui/core`, and — as with `@kaiui/core` —
may not import `react-dom` / `react-native` / `@tarojs/taro` / `kui`, nor contain a `.tsx`, nor
touch a DOM global. Plain `react` **is** allowed: `session/` is a headless hook, which is what
lets a web, React Native or Taro binding share one interaction sequence.
`src/__tests__/purity.test.ts` enforces all of it by scanning the source and `package.json`.

The Buda-family surfaces are `UIMessage`-native and are served by
`@kaiui/core` instead. The two stacks share `kui/ai-elements` as their
component primitives and nothing else.

## Design notes worth knowing

**Tool calls are keyed by `toolCallId`.** ACP emits one `tool_call` plus a `tool_call_update`
per status change, all carrying the same title. The implementation this replaces used a flat
text model, so one call rendered as up to six identical `Tool: X` rows — "unreadable now that
injected MCP tools mean a dozen per turn", per its own comment. Keying on the id removes the
problem structurally instead of needing a text-dedupe workaround.

**`messageId` is authoritative when the agent sends it.** ACP says chunks sharing a
`messageId` belong to one message and a change starts a new one. Agents that omit it fall
back to (role, variant) adjacency, which is what both prior implementations used.

**Permission timeouts are optional on purpose.** acprouter counts down 5 minutes; busabase
waits indefinitely and *deliberately never auto-approves* — that's a security property, not
an oversight. The model expresses both rather than hard-coding either.

**ACP facts keep their own shapes.** Tool calls retain structured content, diffs,
locations, raw values and metadata. Message content stays ordered, including embedded
resources and resource links; `text` and `attachments` remain available for existing hosts.
V1 `plan` updates replace the current full plan for the turn. Experimental plan variants
are not enabled implicitly. Session title, context-window usage and commands are folded
separately as session state. A turn's token usage remains distinct from context occupancy.

**Lifecycle transport belongs to the host.** A host translates its negotiated extension
into `{ type: "lifecycle", event }` with version 1, a stable `turnId`, source timestamps
and real step identifiers. The reducer tracks started/finished turns and steps, resource
updates and background job snapshots without inferring missing execution steps.

**Questions are separate from permissions.** `input_request` carries a flat primitive
form schema; `input_answering`, `input_resolved` and `input_failed` retain delivery state.
The optional `AcpSessionPort.answerInput` submits answers separately from permission
options. Pending requests close on turn completion. An in-flight decision stays disabled
until its receipt arrives, since execution may finish before delivery acknowledgement.
Explicit cancellation is terminal. An ambiguous failure records the original decision so
retry cannot silently change it.

Unknown updates remain available in the host's durable event journal and do not become
unreadable transcript JSON. Live and serialized-replay reduction use the same functions.

## `group/` — tool-run grouping

`groupConsecutiveToolCalls` collapses 2+ consecutive `tool_call` blocks into one summarizable
run — buda's "Explored 3 files, ran 2 commands" pattern. Unlike `@kaiui/core`'s equivalent, this
is a **port**, not an import (the purity rules forbid depending on `@kaiui/core` — see above):
ACP's `AcpToolCallBlock` already carries a protocol-native `toolKind` enum, so classification
here is an exhaustive mapping rather than `@kaiui/core`'s name-sniffing heuristic
(`read_file`/`readFile`/"Read File" all having to land in the same bucket, because the AI SDK's
tool parts carry no category of their own). `summarizeToolRun` returns counts, not a string —
wording and pluralization are `@acp-ui/web`'s job, same split as `@kaiui/core`.

## Status

`reduce/`, `session/`, and `group/` are implemented, and so is [`@acp-ui/web`](../web) — the
`kui`-based binding layer that renders this view model, including a composer and tool-run
grouping. Both `acprouter` and `busabase` are wired to this package now.

### Host-validated text context

`AcpResourceContext` (exported from `./reduce` and `./prompt`) is the generic snapshot
`{ id, name, uri, mimeType, text, metadata?: Record<string, unknown> }`. Hosts validate
it and negotiate transport; it does not add a top-level ACP wire property or authorize
resource fetching. Replay can use ordinary `user_message_chunk` embedded text resources
with `_meta["acp-ui.resourceContext"]: { id, name }`. Canonical content and the attachment
projection retain the full text and metadata, allowing compact inspectable web chips
without changing old events or dropping renderer overrides.
