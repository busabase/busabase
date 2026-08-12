# Busabase Formula Engine — Specification (parity with bika)

Status: DONE (function catalog + dependency graph + precision math + demo
lab + real-server verification all shipped; see Progress log). This is the durable
spec for bringing busabase's `formula` field to capability parity with
bika's Formula engine (`~/Documents/bika/projects/bika/packages/bika-types` +
`domains/database/{shared,server}/formula*`). Work against this file
checklist-by-checklist; check items off as they land (with the commit/PR
that landed them) so progress survives context resets.

Prerequisite (already shipped): the MVP engine (lexer/parser/AST/interpreter,
~20 functions, `{slug}` references, no chaining, plain floats).

## Architecture decisions (locked — implemented as written below)

- `FormulaValue` widened to `number | string | boolean | Date | FormulaValue[] | null`
  (`functions/value.ts`). Dates are native JS `Date` internally; a formula
  field whose result is a Date is serialized to an ISO string by
  `field-types.ts`'s `computeFormula` before storage (same convention as the
  `date` field type).
- Precision-safe `plus/minus/times/divide` (`functions/value.ts`) replace raw
  `+ - * /` in `interpreter.ts`'s `evaluateBinary`. Comparisons stay on raw
  numbers (no precision concern there). Dependency-free (scaled-integer
  technique, no decimal.js/big.js).
- `dependency-graph.ts` (domain-level, not formula-specific) holds the
  generic `DirectedGraph` (Kahn's `topologicalSort`, DFS `findCycle`).
  `formula/dependency.ts` wraps it for fields (`buildFieldGraph`,
  `detectFieldCycle`, `topologicalFieldOrder`), using a minimal duck-typed
  `FormulaFieldLike` to avoid a circular import with `field-types.ts`.
- `FormulaChainedRefError` REMOVED — formula-referencing-formula is allowed.
  Whole-graph cycle detection lives in `field-rules.ts`'s
  `assertValidFormulaField` (moved there from `field-ops.ts` so
  `record-ops.ts`'s `createBase` — a brand-new base's initial field batch —
  can validate too, not just the one-field-at-a-time paths). Throws plain
  `FormulaError`/`FormulaCycleError`; each oRPC-facing caller (`field-ops.ts`,
  `record-ops.ts`) wraps it into `ORPCError BAD_REQUEST`.
- `computeSystemFieldValues` (`field-rules.ts`) computes in
  `topologicalFieldOrder`, feeding each computed value back into `values`
  immediately — required so a formula chained to another formula sees its
  dependency's fresh result in the same write, not just pre-write `values`.
  Falls back to `defs` array order if the graph has a cycle (defensive; a
  cycle should never reach compute — field-ops.ts rejects it at write time).
- `SystemComputeCtx` gained `recordId` + `recordCreatedAtIso`. On CREATE,
  `mergeRecordCreate` now generates the record id BEFORE calling
  `applyComputedRecordFields` (previously after) so `RECORD_ID()` resolves
  on create, not just update. `recordCreatedAtIso` is `timestamp` on create,
  `targetRecord.createdAt` (the real original creation time) on update.
- `coerceForFormula` (`field-types.ts`): `date`/`created_time`/`updated_time`
  → `Date`; `relation`/`multiselect` → raw string array (consumed by
  `ARRAYJOIN` etc.); `attachment` stays `null` (ref objects, no scalar
  representation yet).

## Function catalog checklist

Split into `functions/{numeric,logical,text,date-time,array}.ts`, merged by
`functions/index.ts`. `RECORD_ID`/`CREATED_TIME`/`LAST_MODIFIED_TIME` and
`ISERROR`/`IS_ERROR` are special-cased directly in `interpreter.ts` (need
record context / lazy-evaluated args respectively — not a plain
evaluated-args function).

### Numeric (`functions/numeric.ts`) — DONE
- [x] SUM, AVERAGE, MIN, MAX, ABS, ROUND, ROUNDUP, ROUNDDOWN (MVP)
- [x] COUNT, COUNTA, COUNTALL, COUNTIF
- [x] CEILING, FLOOR, EVEN, ODD
- [x] INT — floors toward -infinity (Excel semantics, NOT truncate-toward-zero): `INT(-1.5) === -2`.
- [x] MOD, POWER, SQRT, EXP, LOG
- Tests: `tests/formula-numeric.test.ts` (12 tests).

### Logical (`functions/logical.ts`) — DONE
- [x] IF, AND, OR, NOT (MVP)
- [x] SWITCH, XOR
- [x] ISERROR / IS_ERROR — special-cased in `interpreter.ts` (catches the ARG's evaluation, not a pre-evaluated value).
- [x] ERROR, BLANK, TRUE, FALSE
- Tests: `tests/formula-logical.test.ts` (8 tests, incl. ISERROR scope isolation).

### Text (`functions/text.ts`) — DONE
- [x] CONCATENATE (MVP, plus `&` operator)
- [x] LEFT, RIGHT, MID, LEN
- [x] FIND (case-sensitive), SEARCH (case-insensitive) — both throw (not -1) when not found, matching spreadsheet #VALUE!-style behavior.
- [x] REPLACE, SUBSTITUTE (all-occurrences by default, or Nth occurrence)
- [x] REPT, TRIM (collapses internal whitespace runs too, not just outer trim)
- [x] UPPER, LOWER, T, VALUE, ENCODE_URL_COMPONENT
- Tests: `tests/formula-text.test.ts` (14 tests).

### Date/time (`functions/date-time.ts`) — DONE, with 2 documented simplifications
- [x] TODAY, NOW, FROMNOW, TONOW, DATEADD
- [x] DATESTR, TIMESTR, DATETIME_FORMAT (minimal token set: YYYY/MM/DD/HH/mm/ss — not a full format-string parser)
- [x] DATETIME_PARSE — **simplified**: always parses via native `Date` constructor (ISO 8601/RFC 2822), ignores an explicit format arg if passed. No custom format parser.
- [x] DATETIME_DIFF, DAY, MONTH, YEAR, HOUR, MINUTE, SECOND, WEEKDAY, WEEKNUM
- [x] WORKDAY, WORKDAY_DIFF — Mon-Fri only, no holiday calendar (matches reference scope)
- [x] IS_BEFORE, IS_AFTER, IS_SAME
- [x] SET_LOCALE, SET_TIMEZONE — **simplified**: validating pass-throughs, NOT scoped mutable modifiers affecting subsequent calls in the same expression (bika's actual semantics). Revisit only if real demand shows up; low value for the complexity of threading mutable eval context through the interpreter.
- All component getters (DAY/MONTH/.../WEEKDAY) use UTC methods — deterministic across server/CI timezones.
- Tests: `tests/formula-date-time.test.ts` (14 tests).

### Record (special-cased in `interpreter.ts`, not `functions/`) — DONE
- [x] RECORD_ID, CREATED_TIME, LAST_MODIFIED_TIME — via `FormulaRecordContext` threaded through `evaluateFormula`/`evaluateAst`; `SystemComputeCtx.recordId`/`recordCreatedAtIso` supply it in `field-types.ts`'s `computeFormula`.
- Tests: `tests/formula-record.test.ts` (5 tests).

### Array (`functions/array.ts`) — DONE
- [x] ARRAYJOIN, ARRAYUNIQUE (preserves first-seen order), ARRAYCOMPACT, ARRAYFLATTEN (recursive)
- Tests: `tests/formula-array.test.ts` (6 tests).

## Dependency graph + chaining checklist — DONE

- [x] `dependency-graph.ts`: generic `DirectedGraph` (`addEdge`, `topologicalSort(): T[] | null`, `findCycle(): T[] | null`).
- [x] `formula/dependency.ts`: `buildFieldGraph`, `detectFieldCycle`, `topologicalFieldOrder`.
- [x] `FormulaChainedRefError` removed; chaining allowed in `validateFormulaExpression`.
- [x] `field-rules.ts`'s `assertValidFormulaField` (moved from `field-ops.ts`) runs whole-graph cycle detection — used by `field-ops.ts` (wrapped as ORPCError) AND `record-ops.ts`'s `createBase` (a new base's whole initial field batch, which the one-field-at-a-time validators never saw).
- [x] `computeSystemFieldValues` computes formula fields in topological order, feeding results back into `values` for dependent formulas in the same write.
- [x] Integration test (real PGLite, `tests/formula-chaining.test.ts`): A (formula) depends on raw fields; B (formula) depends on A — create AND update both recompute correctly in one pass.
- [x] Integration test: editing a field to introduce a 2-field cycle (A↔B) is rejected with a cycle-naming error at the `updateFieldChangeRequest` call itself (before any DB write).
- [x] Integration test: self-reference and unknown-field-reference still rejected (unaffected by allowing chaining).

## Precision-safe arithmetic checklist — DONE

- [x] `plus/minus/times/divide` in `functions/value.ts` (scaled-integer technique).
- [x] Wired into `interpreter.ts`'s `evaluateBinary` for `+ - * /` on numeric operands.
- [x] Regression test: `0.1 + 0.2 === 0.3` end to end through a formula (`tests/formula-precision.test.ts`).
- [x] Regression test: a price×qty÷qty round-trip at decimal scale stays exact.

## Demo seed data: "Formula Functions Lab" — DONE

New scenario (own file, `packages/busabase-core/src/demo/scenarios/formula-functions-lab.ts`,
own use case `"formula-lab"`) — NOT an extension of `stock-picking.ts` (kept
that one focused/realistic; this one is a deliberately exhaustive coverage
fixture, same spirit as the existing `field-types.ts` demo Base "Field Type
Lab"). One Base, one seeded row, one formula COLUMN per function under test
(~65 columns), referencing plain input columns (numbers/strings/dates/
checkboxes/multiselect for the array functions), PLUS one deliberately
CHAINED formula referencing another formula field (`f_sum_doubled`),
demonstrating the dependency graph end to end in real seed data, not just
unit tests. TODAY/NOW/FROMNOW/TONOW/CREATED_TIME/LAST_MODIFIED_TIME are
deliberately excluded from the seeded row (no fixed expected value at
seed-authoring time); covered by unit tests instead. Verified via a real
wipe + `pnpm db:seed:all` + dev server + REST API (`/api/v1/records`) check,
which caught a genuine bug (see below) that unit tests alone could not have
— `evaluateFormula` is called directly in tests, bypassing the DB storage
round-trip.

**Bug found + fixed during this verification**: `f_dateadd`/`f_datetime_parse`/
`f_workday` — whose top-level result is a raw `Date` — serialized to `{}`
through DB storage, because nothing converted `Date` → ISO string before
persisting a formula's computed value. Fixed by adding
`serializeFormulaResult` (`formula/index.ts`), called from both
`field-types.ts`'s `computeFormula` (the real write path) and this demo
scenario's `withComputedFormulas` (the seed path, which calls
`evaluateFormula` directly and bypasses `computeFormula` entirely). Re-verified
clean after the fix.

## Explicit non-goals (do not scope-creep into these)

- Do not revert `Intl.NumberFormat` currency formatting to bika's manual symbol system.
- Do not port `expressionTemplate` (bika's cross-database template-export id/slug indirection).
- Do not build a Rust/native compute engine.
- Do not make the seed/demo path run the live compute registry — keep pre-baking with the same engine at seed-authoring time.
- SET_LOCALE/SET_TIMEZONE's scoped-modifier semantics (see date/time section) — validating pass-throughs are the permanent design here, not a placeholder to finish later, unless real demand appears.
- DATETIME_PARSE's custom-format argument — native Date-constructor parsing only; a real format-string parser is a separate, larger effort if ever needed.

## Progress log

- 2026-07-24: Spec created. MVP engine (PR #5767) is the baseline.
- 2026-07-24: Function catalog (numeric/logical/text/date-time/record/array,
  ~50 functions total across MVP + this pass) + precision-safe arithmetic +
  full dependency graph (chained formulas, cycle detection at field
  create/edit, topological compute order) all implemented and unit/
  integration tested (real PGLite via oRPC router client). `busabase-core`'s
  full test suite passing throughout.
- 2026-07-24: Formula Functions Lab demo scenario shipped (~65 formula
  columns, one per function, plus a chained example). Real-server
  verification (wipe + seed + dev server + REST API) caught and fixed a
  genuine Date-serialization bug (`f_dateadd`/`f_datetime_parse`/`f_workday`
  stored as `{}`) via `serializeFormulaResult`. Full regression pass clean:
  typecheck across busabase-core/busabase-contract/busabase-cms and every
  consumer app (busabase, busabase-cloud, busabase-cli, busabase-sdk,
  busabase-mobile, busabase-desktop), full busabase-core vitest suite
  (130/130 files), `pnpm lint:err`. Spec status: DONE.
