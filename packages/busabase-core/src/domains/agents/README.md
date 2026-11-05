# Agents: remote sessions and prompt context snapshots

## Supervised remote sessions

Legacy local-process and remote sessions remain supported. New remote sessions
can opt into the supervised journal after the owning application has applied its
generated migrations and the operator has completed the coordinated old-worker
drain:

```sh
BUSABASE_AGENT_SUPERVISOR_ENABLED=true
BUSABASE_AGENT_LEGACY_WRITERS_DRAINED=true
```

These settings require a persistent Node host with the registered supervisor
driver/runner. Known request-only runtimes are rejected. The Node startup hook
starts bounded demand scanning; shutdown begins a safe drain. Do not enable the
mode in a mixed deployment that still has unfenced legacy writers.

Each logical space/actor/session/binding has one journal writer epoch, covering
initialization, idle notifications, active turns and background output. Separate
sessions at the same endpoint remain concurrent. Requests received by another
worker enter a scoped durable command inbox; the existing one-prompt-at-a-time
behavior remains. Stop and interaction decisions use the independent control
lane, including separately negotiated targeted cancellation where available.

Command acceptance means immutable intent and its operation reservation have
committed. The pending presentation is readable on any worker. Only the journal
owner appends its user event, before remote dispatch; the browser replaces the
pending presentation using `commandId`. An identical command retry returns its
existing receipt; changed content under that identity is a conflict. Journal
sequence allocation, identity/content verification and checkpoint updates occur
inside a fenced parent-row transaction. No remote transcript event is published
before durable confirmation.

Connection, execution and history synchronization have separate VOs. An outage
does not prove that a remote run failed. Dispatch whose outcome cannot be proven
becomes `unknown` and is not automatically repeated under a new identity. A
different endpoint or explicit credential replacement invalidates the old session
binding; equivalent OAuth access-token refresh preserves it. Background work
rebuilds current host authorization/vault context. Scope, dispatch context and
diagnostic context remain consistent across independent Node module evaluations.

On a transient background query failure, the Agent Panel keeps previously read
history and unsent intent mounted, shows recovery feedback and blocks new
supervised sends until its authoritative queries recover. It does not replace
cached history with an initial-load error or invent a committed terminal event.
Explicit authorization/deletion errors still hide the formerly authorized view.
Session/connection query keys and component state are scoped by host, actor,
workspace and integration target so cached recovery never crosses those scopes.

### Negotiated recovery profiles

- Plain ACP v1 retains its advertised `session/load` support. Without stable
  source identities, replay is captured in a separate bounded read-only history
  snapshot, never appended as new live deltas. The UI marks a synchronization gap
  instead of inventing deduplication or command-execution guarantees.
- Buda `eventStream`/`replayCursor` features provide source identities and replay
  barriers. Live checkpoints advance only with separately negotiated
  `journalCoverage:1`; older profiles retain the last proven replay barrier.
  Replay from a null checkpoint starts at zero and verifies retained source
  history rather than treating `max(seq)` as a covered prefix.
- Buda durable command receipts, remote writer epochs and targeted cancellation
  are independent opt-in capabilities. The server must enable
  `BUDA_ACP_COMMAND_RECEIPTS_ENABLED=true`; clients never infer these guarantees
  from the endpoint URL or a message ID. A missing or expired receipt is not proof
  of non-execution. Router paths that suppress extensions use the truthful plain
  v1 profile.

### Bounds and retention

- Writer TTL: 45 seconds; renewal: approximately 15 seconds; scanner: 500 ms.
  Connected idle owners use a scoped pending-command read before claiming;
  empty data/control lanes do not open locking transactions. This read is only
  a polling hint: new admission is seen by the next scan, and actual claims,
  maintenance and writes still validate the locked epoch. Unknown/nonterminal
  commands remain visible to maintenance and receipt reconciliation.
  Cross-worker discovery filters out valid writer leases before its capacity
  limit; each worker separately maintains its existing owners. Healthy sessions
  on one worker cannot fill another worker's discovery window and starve later
  demand. The actual claim transaction rechecks availability after locking.
- At most 100 active supervisors per process, four ordinary controls per owner,
  256 events per append and 500 pending events / 16 MiB per journal buffer.
- Immutable command JSON is bounded to 16 MiB. Prompt admission expires after
  30 minutes; ordinary queued controls/configuration expire after 30 seconds.
- `BUSABASE_AGENT_MAX_PENDING_COMMANDS` defaults to 128 and is bounded to
  2–1024 nonterminal commands per session, retaining an admission slot for
  interaction controls alongside the active prompt.
  Views retain the active receipt and all bounded nonterminal receipts, plus a
  bounded recent terminal window. This does not delete deduplication proof.
- Generic history snapshots have at most 500 updates / 4 MiB. Truncation is
  explicit. Transient storage retries retain the same identities and have a
  fixed three-retry budget; integrity/auth/schema/ownership failures do not enter
  that retry loop.
- Finished-session pruning remains `BUSABASE_AGENT_SESSION_RETENTION_DAYS`
  (default 30 days). Active/unknown sessions are not silently pruned. Buda command
  receipt capacity defaults to 10,000 per binding and retains existing proof
  rather than forgetting uncertain work to admit more commands.

The scanner performs real database and authorization work. Validate its overhead
and recovery timings in the intended host before broad activation; bounded local
acceptance is not a production capacity measurement.

## Prompt context snapshots

`agents.sessions.prompt` accepts optional `resourceContext` alongside unchanged user
`text`, attachments and server-resolved node `contextReferences`. A context-only
request is valid. Each prompt context contains `id`, `name`, `uri`, `mimeType:
"text/plain"`, complete `text`, and `metadata["busabase.agentPrompt"]`: the versioned
scenario, descriptive node target, source and ordered prompt segments.

Before acceptance, the server revalidates the shared bounded schema, exact segment
text equality and source origin/edition/workspace against the host request context.
It replaces the submitted URI with `busabase-agent-prompt:///<encoded insertion id>`.
The descriptive target grants no access and no URI or node is fetched for this
snapshot. Existing session ownership, workspace-write, lease and tool/node ACL
checks continue to apply.

The existing durable synthetic event is additive:

```ts
{
  sessionUpdate: "user_message",
  text: "Optional additional instruction",
  attachments: [], // optional, existing shape
  contextResources: [], // optional, existing server-resolved node snapshots
  resourceContext: [/* validated immutable prompt context DTOs */], // optional
}
```

In legacy mode the event is persisted before acceptance/ACP dispatch. Supervised
mode first accepts the durable command as described above and journals this event
before ACP dispatch. Live subscribers and late
replay translate the same stored DTO to ordinary ACP embedded text resources, with
`_meta["acp-ui.resourceContext"] = { id, name }`. The envelope remains in the durable
application event; it is not duplicated into the ACP resource metadata.
This preserves the full text for an inspectable transcript chip without expanding
the user bubble. Old text/file events need no migration.

ACP dispatch sends user text, prompt resources in insertion order, existing node
resources, then attachments. Only affirmative `embeddedContext` capability permits
resource blocks. Otherwise complete prompt context is sent exactly once as text,
with an explanatory note. This changes presentation, not model token cost.

OSS and Cloud real requests supply the trusted host origin. OSS demo also supplies
its request origin; a Cloud demo without a real target workspace cannot create a
Cloud prompt envelope and retains the ordinary full-text handoff.
