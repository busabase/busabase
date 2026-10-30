# @acp-ui/web

Tailwind hosts must include this package's source in class discovery. For example,
the Busabase app stylesheet includes `@source "../../../../packages/@acp-ui/web/src";`.
Scanning only the host's components omits binding-specific utility classes, which
can clip long ACP messages and tool/permission titles in compact panels.

The web binding layer for [`@acp-ui/core`](../core). The core decides *what* an ACP conversation
contains; this package decides what it looks like, using `kui` and `kui/ai-elements`.

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
  onAnswerInput={(block, response) => answerInput(block, response)}
  resolveResource={(resource) => resolveAuthorizedResource(resource)}
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
| `plan` | Full checklist snapshot | Shows actual pending/in-progress/completed entries. |
| `turn` / `step` | Process summary and step rows | Running processes expand; completed processes collapse while all final answer blocks stay visible. |
| `resource` | Named preview/download card | A host resolves remote URIs into authorized URLs; remote `file://` paths never become browser links. |
| `job` | Background job status card | Updates one card by stable identity. |
| `input_request` | Primitive structured form | Supports single/multiple choices and free text; confirmed answers and cancelled requests are read-only. |

## Tool-run grouping

`@acp-ui/core/group`'s `groupConsecutiveToolCalls` collapses runs of 2+ consecutive `tool_call`
blocks before this package ever renders them; a lone tool call still renders solo. The group
opens by default while any call in it is still `pending`/`in_progress` (matching buda's
`defaultOpen={isRunning}` — once opened by the user, or by having been live, it stays open
until toggled, it does not auto-collapse the instant the last call settles) and shows a check
once every call has. The summary title ("Explored 2 files, ran 1 command") is built from
`AcpToolRunView`'s `labels` prop, English by default and overridable — same "core owns
arithmetic, app owns string" split as `@kaiui/core`.

## Fidelity and host callbacks

Tool details render ACP text/media, file diffs, affected locations and terminal references.
Known parent tool metadata produces expandable subtask groups. Raw values remain available
in an explicit disclosure alongside structured output.

`resolveResource` receives the original stable resource descriptor and returns a refreshed
URI/preview URI with the same identity. Images, audio, video, PDFs and bounded text previews
stay in the panel; opening or downloading uses only allowed URLs. A failed resolution is
retryable without exposing the agent credential to the browser.

The isolated citation adapter accepts only matching versioned source bindings and code-point
ranges. It projects links into Markdown prose, preserves code/HTML/existing links and keeps
canonical text unchanged. Bound source excerpts remain available when a span crosses
formatting or content boundaries. Unsupported metadata falls back to the original content.

`onAnswerInput` handles elicitation responses (`accept`, `decline`, `cancel`) separately from
`onAnswerPermission`. During delivery, fields and options are disabled. If acknowledgement
is uncertain, retry uses the recorded answer/option rather than offering a different decision.
Process, resource, input, permission and citation labels are configurable by the host.

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

Message, tool, tool-group, permission and note renderers, plus the Markdown engine, are optional slots. Rich resource access uses the host resolver callback:

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

Wired into `acprouter` and `busabase` — both drive their transcript, composer, tool-run
grouping, attachments, cancel/stop and session-level usage/title through this package.
Package tests cover reduction parity, rich content, forms, resource resolution, process
collapse, citations and interaction receipt races. Host applications own transport and
browser acceptance against their real ACP services.

## Optional text context drafts

Hosts may pass `draft: { id, text, resourceContext?: AcpResourceContext[] }` or
`decodePaste(clipboardData: DataTransfer)` to stage complete text snapshots. The host
owns schema, size, origin and plain-text consistency validation. Returning `undefined`
or an empty array (or throwing) preserves ordinary text/file paste. The composer never
reads the clipboard proactively. Each explicit insertion should have a fresh context
id; each draft id is applied at most once per mounted composer and acknowledged with
`onDraftApplied`, so the host must retire acknowledged drafts to prevent remount replay.

`AcpResourceContext` is exported by `@acp-ui/core/reduce` and `@acp-ui/core/prompt`:
`{ id, name, uri, mimeType, text, metadata? }`. The URI identifies the snapshot; neither
staging nor inspection fetches it. Context chips share the attachment strip, wrap and
truncate long names, support keyboard inspection/removal, and display the escaped full
text in a read-only region. `labels.inspectContext`, `labels.removeContext` and
`labels.contextContent` customize their controls. `AcpResourceContextChip` is also
exported for host transcript renderers; omitting `onRemove` makes it read-only.

`onResourceContextChange(contexts)` reports staged snapshots (including initial empty
state, removal and accepted sends). A context-only draft can be submitted. With contexts,
`onSend(text, attachments, resourceContext)` receives a third argument; ordinary callers
still receive exactly the original two arguments. Returning a rejected Promise retains
text, files and contexts for retry. Acceptance removes only the submitted contexts,
preserving any later host handoff. Staging never sends automatically.

For compact live/history messages, keep each snapshot as a standard ACP embedded text
resource and add `_meta["acp-ui.resourceContext"]: { id, name }` to its content block.
The existing reducer preserves the entire resource and metadata. The default message
renderer shows the inspectable context chip, without duplicating the text in Markdown;
`renderAttachment` overrides still take precedence. `resourceLabels.preview` localizes
inspection in transcripts. Unmarked or malformed markers keep ordinary resource display.

`validateResourceContext(contexts: readonly AcpResourceContext[])` optionally checks the
combined staged list before either paste or draft insertion. Hosts own cumulative count
and byte limits. A false result (or exception) leaves paste native; a rejected host draft
merges every incoming snapshot's complete text into the ordinary field while preserving
existing chips/files/text. Its one-shot id is still acknowledged, so no content is hidden,
truncated or repeatedly inserted when a handoff exceeds the context budget.
