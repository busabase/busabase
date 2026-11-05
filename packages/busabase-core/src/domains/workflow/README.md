# Workflow runtime

Busabase stores a workflow as `graph.json` and also **runs** that graph — by hand from the canvas's Runs tab, or automatically from record events.

## Layout

| Path | Role |
| --- | --- |
| `schema/workflow-runs.ts` | `busabase_workflow_runs`: one row per run (cursor, step outputs, pause, lease) |
| `schema/workflow-triggers.ts` | `busabase_workflow_triggers`: event subscriptions projected from saved event-mode graphs |
| `logic/runs.ts` | The walker. Pure: every dependency (store, record reads, access checks, sandbox, HTTP) is injected |
| `logic/run-store.ts` / `run-store-db.ts` | The store interface; memory (demo, unit tests) and Postgres (real server) |
| `logic/run-service.ts` | Real dependencies + the cross-space scheduler tick `processDueWorkflowRuns` |
| `logic/triggers.ts` | Trigger sync on graph merge, and run queueing on record events |
| `logic/webhook-step.ts` | A webhook step's single guarded HTTP request |
| `logic/expression.ts` | The condition language |
| `components/` | The canvas Runs panel |

## Step order

Every stored step carries `sequence`, its 0-based execution order. Two steps can finish in the same millisecond, and Postgres jsonb sorts the keys of `outputs`, so neither timestamps nor key order say what ran first.

## Freshness

Mixed, on purpose.

Each step keeps the values it captured when it ran, including a function's return value and a webhook's response. A later step sees that snapshot, even if someone edits the record while a Wait or approval is paused.

The action name `read_record` is the reload. It reads the run's record at the moment that step runs. Put it **after** the Wait when the next branch must see current data. A `read_record` that already ran before the Wait stays frozen.

Resume re-reads the graph for steps that have not run yet. Stored outputs are not recomputed.

## Steps

| Step | Behavior |
| --- | --- |
| Trigger | Snapshots `payload` and, when the run has a record, the record head |
| Condition | Boolean expression over `input` (previous step) and `steps.<id>`; `&&`/`\|\|` short-circuit; `a["key"]`, `a[0]` |
| Wait | Pauses until `resumeAt`; the scheduler resumes it, or `resume` with `force` |
| Approval | Pauses until `decide` with `approved` or `rejected` |
| Action `read_record` | Reads the current record head |
| Other actions | Recorded and skipped |
| Function | Runs the saved `run_function` webhook rule in the webhook sandbox |
| Webhook | One HTTP request, SSRF-guarded on every redirect hop; keeps `status` and `body` |
| End | Completes the run |

Function and webhook steps receive the same `input` (see `WorkflowStepInput`): `event: "workflow.step"`, `runId`, `workflowNodeId`, `stepId`, `payload`, `record`, `recordId`, `baseId`, `fields`, `steps`, `previous`. The `recordId`/`baseId`/`fields` names match a record webhook rule's payload so one function body serves both.

Error policy `stop` fails the run on a failed function or webhook step. `continue` stores `executed: false` and `error`, then follows the success branch.

## Who acts, and with what access

- `list` / `get` need **read** on the workflow node; `list` also answers `canRun` (write) so the Runs tab hides actions a viewer cannot take. `start`, `resume`, `decide`, `resumeElapsed` need **write**: a run reaches outside Busabase. Both the API-key level table (`api-key-level.ts`) and the handler (`authorizeWorkflow`) enforce this, so a signed-in viewer is refused the same as a read-level key.
- A step acts with the access of whoever drives it. In a request that is the caller. When the scheduler drives it, the host binds the run's `startedBy` (`WorkflowRunAs`): the cloud rebuilds that member's ACL context and fails the run if they left the space.
- An event run's `startedBy` is whoever submitted the event-mode version of the graph (`armedBy` on the trigger row).

## Approvers

`parseWorkflowApprovers` reads the member emails out of an approval step's `approver` text; anything else stays a label (graphs written before enforcement used names like "Sales lead"). With emails, `decide` needs read on the workflow plus being one of them or a space manager (`isNamedApprover`); without, it needs write. `list` answers `decidableRunIds` so the panel shows Approve/Reject only where they will work. A named approver who cannot edit the workflow gets a hand-off: the decision is recorded, the run goes back to `queued` at the next step, and the scheduler continues it as `startedBy` — the steps after the decision never run with the approver's narrower access.

## Concurrency

`settings.concurrency` caps runs of one workflow in status `running` (executing steps; Waits and approvals hold no slot). A manual start over the cap is stored `queued`; `startQueuedRun` leaves a queued run queued while the cap is reached. Best effort across replicas: two that count at the same instant can each start one.

## Durability and leases

A run is one row. A worker takes it with a conditional lease update (`claim`) before advancing and clears the lease when it stores the result, so two replicas — or a request and the scheduler — cannot advance the same run. A worker that dies leaves `status = running` with an expired lease; the next tick fails that run with "interrupted" rather than repeating a half-run step.

## Changing records

`update_record` calls `deps.updateRecord`, live: `updateRecordForWorkflow` in `run-service.ts`, which is `createUpdateChangeRequest` as the acting person inside `runWithoutWorkflowTriggers`. Merged: the step outputs the record after the change. Not merged (the actor may only propose): the step fails naming the change request, because later steps would otherwise read a record that did not change. The suppression is an `AsyncLocalStorage` flag read by `enqueueWorkflowRunsForRecordEvent`, so only changes merged inside the call are exempt; a reviewer approving that request later is an ordinary edit. Field values: JSON as written, `=formula` via `evaluateValue`, `==` for a literal `=`.

`create_record` and `delete_record` go the same way (`runRecordWriteStep`, `createRecordForWorkflow`, `deleteRecordForWorkflow`). `update_record` and `delete_record` take `targetRecordId` (empty is the run's record; a formula that gives no id fails the step). Delete archives, so it stays restorable. A step that deleted the run's own record leaves `deletedRecordId` in its output, and `recordForStep` then gives later steps `null` instead of failing them.

## Agents

`list`, `get`, `start`, `cancel`, and `decide` are public (`.route()`, so REST, MCP, CLI). `resume`, `resumeElapsed`, and `cancelQueued` stay app-only: hosts drop them from the public router. `getContextAgentCaller` says whether a request is an agent (`sourceProvenance.apiKey` or `.agent` on Cloud, `agentSurface` on the open-source `/api/v1` and MCP). Three rules:

- A decision needs `allowAgents` on the step, a write-level key, and the usual approver rule. `decidedVia` records the key.
- `start` stores `startedVia`. In the request, the key's `credentialPermissionCeiling` already caps every step. The scheduler has no request, so the Cloud `runAs` re-reads the key each time (`readLiveApiKeyLevel`), fails the run if it is gone, disabled, or expired, and binds its current level as the ceiling.
- An agent's owner is not at the keyboard, so `personAtKeyboard` leaves them in the alerts.

The open-source app has no auth on `/api/rpc`, so `agentSurface` guides agents that use the public surface and is not a security boundary there.

## Cancelling

`cancel` stops one run that is `queued`, `waiting`, or `waiting_approval`, and records `cancelledBy`. A run executing a step answers CONFLICT: the claim fails on its live lease, and a step already sent cannot be taken back. `cancelQueued` stops every queued run of a workflow in one conditional UPDATE, for the bulk import that queued too many.

## Alerts

`deps.notify` hands `workflow_run.approval_needed` and `workflow_run.failed` to the host's `onNotificationEvent` once the run is stored. `actorId` is whoever is at the keyboard, or null when the scheduler moved the run (`deps.background`), because then nobody is watching and nobody should be left out. Runs the tick fails outside any member context (interrupted, orphaned) go through `processDueWorkflowRuns({ notify })`. Recipients and coalescing belong to the host: see `node-subscription-notifications.ts` in the cloud app and its delivery policy. The links carry `#approval-<runId>` / `#failed-<runId>`, which `parseWorkflowRunLink` reads to open the Runs tab on that run.

## Paging and retention

`list` pages by keyset on `(started_at, id)` and also answers for a single `runId`, so a link can open a run far beyond the first page and still know whether the caller may decide it. Only the first page is polled. The tick deletes up to 500 finished runs per pass once they are `WORKFLOW_RUN_RETENTION_DAYS` old, by `updated_at`; unfinished runs are never deleted.

## Function steps

A function node stores `webhookRuleId` and `functionName`, never source code. The runtime loads a webhook rule in the same space:

1. A non-empty rule id wins. The name is ignored.
2. Otherwise the function name must match exactly one `run_function` rule. Zero matches, several matches, a disabled rule, a non-function rule, or a rule scoped to a different base than the bound record fail the step.
3. The body is `config.code`, executed by `runFunction` in `domains/webhook/logic/sandbox.ts`. This path does not call `dispatchOneRule`, so it writes no webhook delivery.

The timeout is `min(rule.config.timeoutMs, settings.timeoutMs)`.

## Event triggers

`syncWorkflowTriggers` runs inside the merge of a `workflow_document_update`: it deletes the workflow's rows and, when `settings.executionMode` is `event`, inserts one per trigger whose `eventName` is `record.created` or `record.updated` (with the trigger's optional `baseId`). After a record merge, `enqueueWorkflowRunsForRecordEvent` asks one indexed question; when something listens it inserts `queued` runs, skipping archived or deleted workflows. The scheduler starts them.

## Follow-ups

- Execute actions other than `read_record` (for example creating a Change Request)
- Publish the procedures on the REST / MCP surface for agents
