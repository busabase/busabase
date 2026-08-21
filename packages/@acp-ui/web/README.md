# @acp-ui/web

The web binding layer for [`@acp-ui/core`](../core). The core decides *what* an ACP conversation
contains; this package decides what it looks like, using `kui` and `kui/ai-elements`.
Full rationale: [`docs/acp-ui-convergence-roadmap.md`](../../../docs/acp-ui-convergence-roadmap.md).

## Usage

```tsx
import { reduceAcpEvent, reduceAcpEvents } from "@acp-ui/core/reduce";
import { AcpComposer } from "@acp-ui/web/composer";
import { AcpConversation } from "@acp-ui/web/transcript";

const [blocks, setBlocks] = useState(() => reduceAcpEvents([], persistedEvents));
// …then per live event: setBlocks((prev) => reduceAcpEvent(prev, event))

<AcpConversation
  blocks={blocks}
  streaming={sending}
  onAnswerPermission={(block, optionId) => answerPermission(block, optionId)}
/>;
<AcpComposer disabled={!sessionId || sending} onSend={sendPrompt} sending={sending} />;
```

Two subpaths, each with two entry points, so a migration can be split into independently
verifiable steps:

| | |
| --- | --- |
| `./transcript`'s `AcpTranscript` | Just the block list. Drops into an existing scroll container. |
| `./transcript`'s `AcpConversation` | `AcpTranscript` inside kui's stick-to-bottom `Conversation`, with the scroll-to-latest button and an empty state. Needs a height-bounded parent. |
| `./composer`'s `AcpComposer` | The prompt box: `onSend`/`disabled`/`sending`/`placeholder` only — a host computes `disabled`/`placeholder` from its own richer session state. |

## What each block becomes

| Block | Rendered as | Notably |
| --- | --- | --- |
| `message` | `Message` + `MessageContent` + `Response` | **Markdown.** Both implementations this replaces rendered raw text. |
| `message` (`variant: "thought"`) | `Reasoning` / `ReasoningTrigger` / `ReasoningContent` | Collapsible "Thought for N seconds", not an italic paragraph. |
| `tool_call` (solo) | `Tool` + `ToolHeader` | One row per call, status updating in place. |
| `tool_call` (2+ consecutive) | `AcpToolRunView` — a `Collapsible` wrapping the same per-call rows | buda's "Explored 3 files, ran 2 commands" pattern — see below. |
| `permission` | `Alert` + `Button` per option | The one block that does **not** reuse an `ai-elements` component — see below. |
| `note` | `Alert` (`destructive` when `ended`) | Session-level messages. |

## Tool-run grouping

`@acp-ui/core/group`'s `groupConsecutiveToolCalls` collapses runs of 2+ consecutive `tool_call`
blocks before this package ever renders them; a lone tool call still renders solo. The group
opens by default while any call in it is still `pending`/`in_progress` (matching buda's
`defaultOpen={isRunning}` — once opened by the user, or by having been live, it stays open
until toggled, it does not auto-collapse the instant the last call settles) and shows a check
once every call has. The summary title ("Explored 2 files, ran 1 command") is built from
`AcpToolRunView`'s `labels` prop, English by default and overridable — same "core owns
arithmetic, app owns string" split as `@kaiui/core`.

## Why permission is hand-built

`kui` ships `<Confirmation>`, but it renders the AI SDK's approval state, which is
`approved: boolean`. ACP's `session/request_permission` carries a *list* of options — "allow
once", "always allow", "reject" — and a boolean cannot express which one the user picked. This
is the same mismatch that is the reason `@acp-ui/*` exists apart from `@kaiui/*`, showing up at
the component layer.

Nothing in this package ever answers on the user's behalf: busabase blocks indefinitely and
deliberately never auto-approves, which is a security property, so the timeout hint renders only
when the host supplied a deadline (acprouter's 5 minutes). A test pins both halves.

## Swapping renderers

Every block renderer, plus the markdown engine, is an optional slot:

```tsx
<AcpConversation
  blocks={blocks}
  onAnswerPermission={answer}
  slots={{
    Markdown: BudaMarkdownRenderer, // buda's customised Streamdown
    Permission: MyPermissionCard,
  }}
/>
```

This is the headless half of the design: a host that needs a different look replaces one
renderer instead of reimplementing the reduction or forking the package.

## On the AI SDK

`kui` depends on `ai` for its own types, so the AI SDK is unavoidably in this package's
*transitive* type graph — unlike `@acp-ui/core`, which forbids it outright. What this package
must not do is reach past `kui` and model anything on `UIMessage`; the moment it does, the
reason `@acp-ui/*` is separate from `@kaiui/*` has quietly evaporated.
`src/__tests__/boundary.test.ts` enforces that no `ai` / `@ai-sdk/*` / `@kaiui/core` import or
dependency appears here.

`src/transcript/tool-status.ts` is the sanctioned seam: ACP's four tool statuses map onto four
kui states whose labels already read correctly, declared as a structural subset rather than an
`ai` import. Assignability is still checked for real by the compiler at the `<ToolHeader>` call
site, so a rename in `kui` breaks the build rather than silently mislabelling a status.

## Status

Wired into `apps/acprouter` and `apps/busabase` — both drive their transcript, composer, and
tool-run grouping through this package, verified against real ACP agents on both. Not yet
covered: attachments (ACP's `ContentBlock` supports images/resources; `@acp-ui/core`'s view
model is currently text-only) and a cancel/stop affordance mid-stream.
