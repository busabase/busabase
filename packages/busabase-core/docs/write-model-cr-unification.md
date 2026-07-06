# Spec: Unify the busabase write model on ChangeRequests (auto-merge for structural ops)

Status: **Draft / awaiting approval** · Date: 2026-07-06 · Scope: `packages/busabase-core` (consumed by busabase, busabase-cloud, busabase-desktop, busabase-cli, busabase-mobile)

## 1. User value — why this exists

Busabase's promise to its users is **"nothing becomes true without a trace, and dangerous changes are reviewable."** Two gaps break that promise today:

1. **Silent structural writes.** Creating a base, a doc, a skill, adding a field, deleting an asset, or purging a node happens as a **direct DB write**. It leaves an `audit_events` row but **no `change_request`** — so it is *not* part of the version/diff/rollback story and *not* visible in the review/history surfaces the product is built around. An agent (or a bug) can reshape a workspace and the only trace is a thin audit line.
2. **Split, surprising rules.** Creating a *base* is a direct write, but creating a *folder* — literally a sibling node — goes through a ChangeRequest. Agents must hold two mental models of "how do I write," and pick wrong. This is the #1 source of the field feedback that triggered this work.

**The value we deliver:** every mutation leaves a first-class `change_request` (so everything is auditable *and* reviewable *and* reversible through one surface), while the everyday structural actions still *feel* instant — the agent calls `createBase` and gets a `BaseVO` back, exactly as today.

**Non-goal:** we are **not** making AI-authored *content* auto-merge. Records — the reviewable content — keep the human approval loop untouched. This spec only changes how *structural* writes are recorded.

## 2. Who does what (user operations)

| Actor | Operation | Today | After |
| --- | --- | --- | --- |
| Owner / agent w/ write role | create base / doc / skill / folder | direct write, no CR | **auto-merged CR** → returns the VO, leaves a merged `change_request` |
| Owner | add / edit a base field via the convenience endpoint | direct write | **auto-merged CR** → returns updated `BaseVO` |
| Owner / admin | delete asset, purge node | direct write | **auto-merged CR** (recorded; purge is still a hard delete) |
| Agent | propose a **record** (content) | CR → human review → merge | **unchanged** — still human-reviewed |
| Agent | governed field/schema change (explicit CR endpoint) | CR → review → merge | **unchanged** |

**The dividing line:** *structural / administrative* mutations auto-merge (recorded); *content* mutations (records) keep human review. All seven of today's direct writes are structural — none is a content record — so this line maps exactly onto them.

## 3. User-perceived failure modes (what must NOT regress)

- **F1 — "I called `createBase` and didn't get my base back."** The 5 VO-returning functions (`createBase`, `createBaseField`, `createDoc`, `updateDocBody`, `createSkill`) MUST keep returning the same VO synchronously. Callers: `domains/*/router.ts`, `apps/busabase-cloud/src/db/seed/seed-workbench.ts`, `apps/busabase/tests/busabase-pglite.test.ts`, `apps/busabase/scripts/verify-busabase-domains.ts`.
- **F2 — "My content got merged without me."** No record/content path may become auto-merge. Auto-merge is gated to structural op kinds only.
- **F3 — "Creating a folder then moving into it still needs two round-trips."** The original complaint. Must be fixable in one CR (temp-id).
- **F4 — "The base created via a CR looks different from before."** The CR/materializer path must produce byte-identical node + base + field rows to today's direct `createBase`.
- **F5 — double audit / broken history.** Each structural op must yield exactly one coherent CR (status `merged`) + its normal merge audit event — not a duplicate `base.created` *and* a `change_request.merged` that disagree.

## 4. Acceptance criteria / test cases (derive from behavior, not internals)

1. `createBase({slug,name,fields})` returns a `BaseVO` **and** `GET /change-requests` now lists a `merged` CR whose `primaryOperation` is `node_create`(base). (F1, F5)
2. Same for `createDoc`, `createSkill`, `createBaseField`, `updateDocBody`, `deleteAsset`, `purgeNode`. (F1)
3. A **record** create still returns an `in_review` CR and is **not** merged until a human `review approved` + `merge`. (F2)
4. One node CR with `[{kind:create,tempId:"f1",nodeType:folder,...}, {kind:move,nodeId:X,parentTempId:"f1"}]` auto-merges and, on read-back, node X is a child of the newly-created folder. (F3)
5. Rows produced by `createBase` (CR path) are diff-identical to a pre-change snapshot of direct `createBase` for the same input. (F4) — golden test.
6. `pnpm db:generate` produces **zero** schema diff (we reuse existing `change_requests` / `operations` / `commits` tables). (migration safety)
7. All existing busabase-core tests + `apps/busabase` e2e pass unchanged (consumer contracts preserved).

## 5. Technical design

### 5.1 One write model, one seam

Reimplement each of the 7 direct-write functions as a thin wrapper over the existing CR machinery + a new **auto-merge** step, keeping the outer signature/return identical:

```
createBase(input): BaseVO
  └─ createNodeChangeRequest({ operations:[{kind:create,nodeType:"base",...}], autoMerge:true })
        ├─ (existing) insert change_request(in_review) + operation(pending) + commit
        └─ autoMergeIfEligible(cr, actor)      // NEW
              ├─ resolveReviewPolicy(op, target, actor) → { requiresHumanReview }
              ├─ if requiresHumanReview → return cr (in_review)   // governed path
              └─ else → approve(cr, system) → _mergeChangeRequest(cr) → return materialized VO
```

The merge already materializes a base node via `mergeNodeCreate` + the base materializer, so `createBase` becomes: build the CR, auto-merge, then `getBase(materializedNodeId)` → the same `BaseVO`. (Verify F4 with a golden test.)

### 5.2 Auto-merge eligibility — `resolveReviewPolicy(op, target, actor)`

The single decision function. Rules (MVP):

- **Structural op kinds** (`node_create`/`node_rename`/`node_move`/`node_delete`/`node_restore`, base-field convenience, `asset_delete`, `node_purge`): **auto-merge** when the actor has a write role in the space (owner/admin/member-with-write). No human review.
- **Content op kinds** (`record_*`): **always** `requiresHumanReview = true` (unless the caller is explicitly self-approving per today's rules). Never auto-merge by policy.
- A space MAY later opt structural ops into governance via a space-level policy; out of scope for MVP (default = structural auto-merges).

Auto-merge records a review row with reviewer = a **system actor** (e.g. `submittedBy` + `verdict:"approved", reason:"auto-merge: structural op"`) so the ledger is honest about *why* it merged without a human. This keeps "never approve your own *content* work" intact — it's scoped to structural ops and attributed.

### 5.3 Temp-id references (one-CR folder + move)

- Extend the node operation input union: `create` gains optional `tempId: string`; `move` (and any op needing a not-yet-real parent) gains optional `parentTempId: string` (mutually exclusive with `parentNodeId`).
- Add `tempIdToNodeId: Map<string,string>` to `MergeCtx`. In `mergeNodeCreate`, after `id("nod")`, record `ctx.tempIdToNodeId.set(op.tempId, nodeId)`. In `mergeNodeMove` (and create-with-`parentTempId`), resolve `parentNodeId = op.parentNodeId ?? ctx.tempIdToNodeId.get(op.parentTempId)`; error if unresolved.
- The merge loop is already sequential-in-transaction, so ordering holds. Validate at CR-create time that every `parentTempId` refers to a `create.tempId` earlier in the array.

### 5.4 Collapse the doc dual path

`updateDocBody` (direct) and the doc-edit CR both exist. Make `updateDocBody` an auto-merge structural CR (same as the rest) and delete the direct storage-write path, so there is one doc-write code path.

### 5.5 Audit reconciliation (F5)

Structural ops currently emit their own action (`base.created`, `doc.created`, …). After the change they flow through CR merge, which emits `change_request.created` + `change_request.merged`. Decision: **drop the bespoke `base.created`/`doc.created`/… emissions** from the (now CR-backed) functions and rely on the CR lifecycle events, so there's one coherent trail. Keep the action enum values for back-compat of historical rows. (`node.purged` stays as-is inside the purge op's merge.)

## 6. Rollout / sequencing (safe, incremental)

Each slice is independently shippable and preserves all consumer signatures:

1. **S1 — infra:** add `autoMerge` support: `resolveReviewPolicy`, `autoMergeIfEligible`, a system-actor review row. No behavior change yet (nothing calls it).
2. **S2 — nodes:** route `createNodeChangeRequest` structural ops through auto-merge; add temp-id. Fixes F3. Node create/move/rename now leave merged CRs.
3. **S3 — base/doc/skill creates:** reimplement `createBase`, `createDoc`, `createSkill` over S2. Golden test for F4.
4. **S4 — field + destructive:** `createBaseField`, `deleteAsset`, `purgeNode`; collapse `updateDocBody` (S4 = §5.4).
5. **S5 — cleanup:** remove now-dead direct-insert code + reconcile audit emissions (§5.5).

Ship S1–S3 first (covers the headline complaints), review, then S4–S5.

## 7. Risks / open questions

- **R1 — materializer parity (F4).** The base/doc/skill CR materializers must equal the direct-create inserts (fields, slugs, positions, storage prefixes). *Mitigation:* golden snapshot tests before/after per type.
- **R2 — self-approval optics.** Auto-merge writes a system-actor approval. Confirm the review UI renders "auto-merged (structural)" distinctly from a human approval so trust isn't muddied.
- **R3 — performance.** Structural creates now do CR+commit+merge in one tx instead of a single insert. Low volume (setup-time ops), acceptable; measure `createBase` latency in a seed run.
- **Q1 — governance toggle.** Do we want a space-level "structural ops also require review" policy now, or defer? (Spec defers.)
- **Q2 — `updateDocBody` removal.** Any external caller depends on the *direct* (non-CR) doc update semantics? Audit before deleting (§5.4).

## 8. What does NOT change

- Record (content) review flow, contracts, and VO/DTO shapes.
- DB schema (reuses `change_requests`/`operations`/`commits`).
- Consumer call sites — every public function keeps its signature and return type.
- org/auth/member/api-key/settings writes stay **audit-only** (not content, no review need) — per the locked scope decision.
