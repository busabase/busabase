# Agents: prompt context snapshots

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

The event is persisted before acceptance/ACP dispatch. Live subscribers and late
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
