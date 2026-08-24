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

Both `apps/acprouter` and `apps/busabase` need **both** paths: each already streams live and
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
[`@kaiui/core`](../../@kaiui/core) instead. The two stacks share `kui/ai-elements` as their
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

**Unhandled ACP kinds are ignored, not leaked.** Six of the eight — `plan`, `plan_update`,
`plan_removed`, `available_commands_update`, `current_mode_update`, `config_option_update` —
produce no block, and a test pins that: raw JSON never reaches the user, and adding a renderer
later is a deliberate decision, not a gap discovered by accident. The other two,
`usage_update` and `session_info_update`, ARE handled — as session-level state
(`reduce/session-info.ts`'s `usageOf`/`sessionTitleOf`/`foldUsage`/`foldSessionTitle`), not as
a transcript block, because real agents sent `usage_update` three times in one turn; folding it
into the message list would flood the transcript with a fact that belongs at the session level,
next to `sending`/`ended`.

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
