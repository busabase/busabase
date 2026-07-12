import "server-only";

/**
 * Drive Grep Retrieval — `grep` (streaming regex/literal scan across every
 * text-bearing asset in scope) and `readLines` (exact byte-range reads via
 * checkpoints). See apps/busabase/content/spec/drive-grep-retrieval.md.
 *
 * grep never uses an index — it brute-scans the (cached) text objects, same
 * philosophy as ripgrep. Honest coverage: every candidate asset is accounted
 * for as matched / scanned-no-match / `missing` / `stale` / `unsearchable` /
 * `errored` (a scan that was attempted but failed — NOT the same as a clean
 * scanned-no-match) / not-reached (present, in scope, but the deadline or
 * maxMatches budget ran out before the scan got to it).
 *
 * Candidate files are scanned through a concurrency-limited batch pool (see
 * `grepConcurrency`) rather than one at a time, and — for literal (non-regex)
 * patterns only — through the optional `rg` (ripgrep) binary when present on
 * the system, for a large real-world speedup; see the "Optional `rg`
 * acceleration" section below for the exact safety scope.
 */
import { type ExecFileException, execFile } from "node:child_process";
import { ORPCError } from "@orpc/server";
import type {
  GrepInput,
  GrepMatchVO,
  GrepResultVO,
  ReadLinesVO,
  ReadTextLinesInput,
} from "busabase-contract/domains/assets/types";
import { and, eq, inArray, isNull, like } from "drizzle-orm";
import { getContextSpaceId } from "../../../context";
import { getDb } from "../../../db";
import {
  attachments,
  busabaseAssets,
  busabaseAssetUsages,
  busabaseNodes,
} from "../../../db/schema";
import { ensureReady } from "../../../logic/seed";
import {
  compileGrepPattern,
  LONG_LINE_GUARD_CHARS,
  scanLines,
} from "../../../logic/text-scan-core";
import { type AssetTextPO, busabaseAssetTexts } from "../schema/asset-texts";
import { autoRegisterAssetText, loadAssetTextRows } from "./asset-texts-logic";
import { readObjectInChunks } from "./object-stream";
import { openAssetTextSource } from "./text-cache";
import { nearestCheckpointAtOrBefore, TextStreamScanner } from "./text-scan";

type Db = Awaited<ReturnType<typeof getDb>>;

// Re-exported so existing direct importers (this module used to define these
// itself) and the `pnpm exec vitest` suite (`grep-pattern-guard.test.ts`)
// keep working unmodified after the source-neutral scanner core moved to
// `logic/text-scan-core.ts` (Unified Grep P2a) — a mechanical relocation, not
// a behavior change. `logic/grep.ts` (the new top-level unified entry) also
// imports `compileGrepPattern` directly from `text-scan-core.ts`, so both the
// files adapter and the Docs adapter compile through the exact same function.
export { compileGrepPattern };

// ── Guardrails ────────────────────────────────────────────────────────────────

/** Overridable (`BUSABASE_GREP_TIMEOUT_MS`) so tests can exercise the timeout path deterministically. */
export const grepTimeoutMs = (): number => {
  const raw = process.env.BUSABASE_GREP_TIMEOUT_MS;
  const parsed = raw ? Number(raw) : Number.NaN;
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 10_000;
};
const READ_LINES_MAX_LINES = 2000;
const READ_LINES_MAX_RESPONSE_BYTES = 2 * 1024 * 1024;

/**
 * Overridable (`BUSABASE_GREP_CONCURRENCY`) — how many candidate files are
 * scanned in parallel per batch. Mirrors `grepTimeoutMs`'s style: read once
 * per call (cheap), parsed as a number, falling back to the default on a
 * missing/invalid value.
 */
const grepConcurrency = (): number => {
  const raw = process.env.BUSABASE_GREP_CONCURRENCY;
  const parsed = raw ? Number(raw) : Number.NaN;
  return Number.isInteger(parsed) && parsed >= 1 ? parsed : 4;
};

// ── Candidate resolution ────────────────────────────────────────────────────

interface CandidateAsset {
  assetId: string;
  contentKind: string;
  mimeType: string;
  fallbackName: string;
}

interface DisplayInfo {
  fileName: string;
  drivePath: string;
}

const resolveCandidateAssets = async (
  db: Db,
  spaceId: string,
  scope: GrepInput["scope"],
): Promise<CandidateAsset[]> => {
  const conditions = [eq(busabaseAssets.spaceId, spaceId)];
  if (scope?.assetIds?.length) {
    conditions.push(inArray(busabaseAssets.id, scope.assetIds));
  }
  if (scope?.mimeTypes?.length) {
    conditions.push(inArray(attachments.mimeType, scope.mimeTypes));
  }
  const rows = await db
    .select({
      assetId: busabaseAssets.id,
      contentKind: busabaseAssets.contentKind,
      mimeType: attachments.mimeType,
      fallbackName: busabaseAssets.name,
    })
    .from(busabaseAssets)
    .innerJoin(attachments, eq(busabaseAssets.attachmentId, attachments.id))
    .where(and(...conditions));

  if (!scope?.drivePath) {
    return rows;
  }

  // Intersect with assets mounted under the requested Drive/Skill path prefix
  // (excluding archived nodes — mirrors search.ts's convention for file results).
  const usageRows = await db
    .select({ assetId: busabaseAssetUsages.assetId })
    .from(busabaseAssetUsages)
    .innerJoin(busabaseNodes, eq(busabaseAssetUsages.nodeId, busabaseNodes.id))
    .where(
      and(
        eq(busabaseAssetUsages.spaceId, spaceId),
        inArray(busabaseAssetUsages.ownerType, ["drive", "skill"]),
        like(busabaseAssetUsages.path, `${scope.drivePath}%`),
        isNull(busabaseNodes.archivedAt),
      ),
    );
  const mounted = new Set(usageRows.map((row) => row.assetId));
  return rows.filter((row) => mounted.has(row.assetId));
};

/** Best-effort display info (mounted path + display name) per asset — for match/report labeling only. */
const loadDisplayInfo = async (
  db: Db,
  spaceId: string,
  assetIds: string[],
): Promise<Map<string, DisplayInfo>> => {
  const map = new Map<string, DisplayInfo>();
  if (assetIds.length === 0) return map;
  const rows = await db
    .select({
      assetId: busabaseAssetUsages.assetId,
      path: busabaseAssetUsages.path,
      metadata: busabaseAssetUsages.metadata,
    })
    .from(busabaseAssetUsages)
    .where(
      and(eq(busabaseAssetUsages.spaceId, spaceId), inArray(busabaseAssetUsages.assetId, assetIds)),
    );
  for (const row of rows) {
    if (map.has(row.assetId)) continue; // first usage wins — good enough for display purposes
    const displayName =
      typeof row.metadata?.displayName === "string"
        ? row.metadata.displayName
        : (row.path.split("/").at(-1) ?? "");
    map.set(row.assetId, { fileName: displayName, drivePath: row.path });
  }
  return map;
};

/**
 * Fall back to the asset's own name whenever the resolved usage has no
 * displayable file name — not just when there's no usage row at all. A
 * `file_node`-type usage (e.g. a Files-folder upload) has no mounted path
 * (`path: ""`), so the naive `path.split("/").at(-1)` in `loadDisplayInfo`
 * resolves to `""` rather than `undefined` — without this truthiness check,
 * that empty string would win over `candidate.fallbackName` and every grep
 * match on such an asset would report a blank file name.
 */
const displayFor = (
  displayByAsset: Map<string, DisplayInfo>,
  candidate: CandidateAsset,
): DisplayInfo => {
  const info = displayByAsset.get(candidate.assetId);
  if (info?.fileName) return info;
  return { fileName: candidate.fallbackName, drivePath: info?.drivePath ?? "" };
};

// ── Line-by-line matching with context ──────────────────────────────────────
// The actual scan (pattern compile, rolling context window, long-line guard,
// deadline checks, maxMatches) lives in the source-neutral `scanLines` core
// (`logic/text-scan-core.ts`, Unified Grep P2a) — this wrapper is the files
// adapter's ONLY job: attach `assetId`/`fileName`/`drivePath` to each
// source-neutral `LineHit` to rebuild a `GrepMatchVO`, exactly as `grepAssets`
// did inline before the extraction. `logic/grep.ts`'s Docs adapter calls the
// SAME `scanLines` function and wraps its hits with `nodeId`/`slug`/`name`
// instead — one scanner, two addressing schemes.
const scanLinesForMatches = async (
  lines: AsyncIterable<string>,
  opts: {
    assetId: string;
    display: DisplayInfo;
    regex: RegExp;
    contextLines: number;
    maxMatches: number;
    deadline: number;
  },
): Promise<{ matches: GrepMatchVO[]; truncated: boolean }> => {
  const { hits, truncated } = await scanLines(lines, {
    regex: opts.regex,
    contextLines: opts.contextLines,
    maxMatches: opts.maxMatches,
    deadline: opts.deadline,
  });
  return {
    matches: hits.map((hit) => ({
      assetId: opts.assetId,
      fileName: opts.display.fileName,
      drivePath: opts.display.drivePath,
      ...hit,
    })),
    truncated,
  };
};

// ── Optional `rg` (ripgrep) acceleration ────────────────────────────────────
//
// `rg`'s regex engine (Rust's `regex` crate) is NOT identical to JS's —
// notably no backreferences/lookaround by default, plus other edge-case
// differences. Silently routing arbitrary user regex through `rg` risks
// returning DIFFERENT matches than the documented JS-regex-based behavior —
// a correctness regression, not an optimization. So:
//
//   - `rg` is ONLY ever used for a LITERAL (non-regex) `pattern`, detected by
//     `isLiteralPattern` below. `rg -F` (fixed-strings) is then guaranteed
//     byte-identical semantics to `new RegExp(escapedLiteral)`. ANY pattern
//     with a regex metacharacter always falls through to the JS scanner —
//     unconditionally, no exceptions.
//   - Scoped further to `contextLines === 0` — `-A/-B/-C` context-line parity
//     with `scanLinesForMatches`'s pending/rolling-window semantics is real
//     complexity for a P1 perf pass; whenever context lines are requested,
//     grep falls back to the JS scanner regardless of pattern.
//   - `rg` availability is detected once and memoized for the process
//     lifetime; missing/broken `rg` silently and permanently falls back to
//     the JS path.
//   - Invoked via `execFile` with an argument array — never a shell string —
//     since `pattern` is user-supplied (command-injection defense).

const REGEX_METACHARACTERS = /[.^$*+?()[\]{}|\\]/;

/**
 * True when `pattern` contains none of JS regex's metacharacters — safe to
 * treat as a literal string (and therefore eligible for the `rg -F`
 * acceleration path). ANY match here means the pattern is NOT literal and
 * must always use the JS regex scanner.
 */
export const isLiteralPattern = (pattern: string): boolean => !REGEX_METACHARACTERS.test(pattern);

let rgAvailablePromise: Promise<boolean> | null = null;

/**
 * Detect the `rg` binary once per process, memoized for the process
 * lifetime — never re-spawned per grep call. A missing binary (ENOENT) or a
 * non-zero exit from `--version` silently and permanently falls back to the
 * JS scanner for the rest of this process; this is optional acceleration,
 * never a hard dependency.
 */
export const isRgAvailable = (): Promise<boolean> => {
  if (!rgAvailablePromise) {
    rgAvailablePromise = new Promise((resolve) => {
      execFile("rg", ["--version"], (error) => {
        if (error) {
          console.debug(
            "[asset-grep-logic] `rg` binary not found — grep will use the JS scanner for this process.",
          );
        }
        resolve(!error);
      });
    });
  }
  return rgAvailablePromise;
};

/** Generous cap on `rg --json` stdout — match events are small, this bounds a pathological file. */
const RG_MAX_BUFFER_BYTES = 64 * 1024 * 1024;

/**
 * Run `rg` and collect its stdout, treating a timeout-kill as a distinct
 * outcome (never thrown) and rg's "no matches" exit code (1) as success with
 * empty-ish output — only a genuine failure (bad invocation, real exit code
 * >1) rejects.
 */
const execFileRg = (
  args: string[],
  timeoutMs: number,
): Promise<{ stdout: string; killed: boolean }> =>
  new Promise((resolve, reject) => {
    execFile(
      "rg",
      args,
      { timeout: Math.max(1, timeoutMs), maxBuffer: RG_MAX_BUFFER_BYTES },
      (error: ExecFileException | null, stdout) => {
        if (error?.killed) {
          resolve({ stdout: stdout ?? "", killed: true });
          return;
        }
        if (error && error.code !== 1) {
          reject(error);
          return;
        }
        resolve({ stdout: stdout ?? "", killed: false });
      },
    );
  });

interface RgMatchEvent {
  type: "match";
  data: {
    line_number: number;
    lines: { text: string };
    submatches: { start: number; end: number }[];
  };
}

const isRgMatchEvent = (value: unknown): value is RgMatchEvent => {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return record.type === "match" && typeof record.data === "object" && record.data !== null;
};

/**
 * Convert `rg`'s 0-based BYTE offset (`submatches[].start`, since `rg`
 * operates on raw bytes) into the same 1-based CHARACTER column convention
 * `scanLinesForMatches` produces via `execResult.index + 1` — re-decode the
 * UTF-8 byte-prefix up to the offset and count its (UTF-16 code unit) length.
 */
const rgByteOffsetToColumn = (lineText: string, byteOffset: number): number => {
  const bytes = Buffer.from(lineText, "utf8");
  const prefix = bytes.subarray(0, byteOffset).toString("utf8");
  return prefix.length + 1;
};

/**
 * Scan one file via `rg -F --json`. Only ever called for a literal pattern
 * against a real on-disk file, with `contextLines === 0` (see the section
 * banner above for why). Mirrors `scanLinesForMatches`'s guardrails: the
 * long-line guard (`LONG_LINE_GUARD_CHARS`), `maxMatches` capping, and the
 * scan deadline (via `execFile`'s `timeout`, treating a timeout-kill as
 * `truncated: true` for this file, never as an `errored` failure).
 */
const scanFileWithRg = async (
  filePath: string,
  pattern: string,
  opts: {
    assetId: string;
    display: DisplayInfo;
    maxMatches: number;
    deadline: number;
    caseInsensitive: boolean;
  },
): Promise<{ matches: GrepMatchVO[]; truncated: boolean }> => {
  const args = ["-F", "-n", "--json", "-m", String(opts.maxMatches)];
  if (opts.caseInsensitive) args.push("-i");
  args.push("--", pattern, filePath);

  const { stdout, killed } = await execFileRg(args, opts.deadline - Date.now());

  const matches: GrepMatchVO[] = [];
  for (const line of stdout.split("\n")) {
    if (!line) continue;
    let event: unknown;
    try {
      event = JSON.parse(line);
    } catch {
      continue;
    }
    if (!isRgMatchEvent(event)) continue;
    const submatch = event.data.submatches[0];
    if (!submatch) continue;

    const rawText = event.data.lines.text.replace(/\r?\n$/, "");
    const withinGuard = rawText.length > LONG_LINE_GUARD_CHARS;
    const text = withinGuard ? `${rawText.slice(0, LONG_LINE_GUARD_CHARS)}…` : rawText;

    matches.push({
      assetId: opts.assetId,
      fileName: opts.display.fileName,
      drivePath: opts.display.drivePath,
      line: event.data.line_number,
      column: rgByteOffsetToColumn(rawText, submatch.start),
      text,
      before: [],
      after: [],
    });
    if (matches.length >= opts.maxMatches) break;
  }

  const overshoot = matches.length > opts.maxMatches;
  return {
    matches: overshoot ? matches.slice(0, opts.maxMatches) : matches,
    truncated: killed || overshoot,
  };
};

// ── grep ─────────────────────────────────────────────────────────────────────

export const grepAssets = async (input: GrepInput): Promise<GrepResultVO> => {
  await ensureReady();
  const db = await getDb();
  const spaceId = getContextSpaceId();
  const regex = compileGrepPattern(input.pattern, input.flags);

  const candidates = await resolveCandidateAssets(db, spaceId, input.scope);
  const assetIds = candidates.map((candidate) => candidate.assetId);
  const displayByAsset = await loadDisplayInfo(db, spaceId, assetIds);

  // Lazy self-heal: register any text-kind candidate with no row yet. Both
  // facts (`contentKind === "text"`, no existing row) are already known from
  // the filter below, so each registration skips its own content-kind lookup
  // AND existence check (`knownContentKind` / `knownMissing`) — and, since
  // every candidate's registration is independent (distinct assetId,
  // `onConflictDoNothing` insert), they run in parallel rather than serially.
  let textRows = await loadAssetTextRows(db, assetIds);
  const toSelfHeal = candidates.filter(
    (candidate) => candidate.contentKind === "text" && !textRows.has(candidate.assetId),
  );
  if (toSelfHeal.length > 0) {
    await Promise.all(
      toSelfHeal.map((candidate) =>
        autoRegisterAssetText(candidate.assetId, db, {
          knownContentKind: candidate.contentKind,
          knownMissing: true,
        }),
      ),
    );
    textRows = await loadAssetTextRows(db, assetIds);
  }

  const present: { candidate: CandidateAsset; row: AssetTextPO }[] = [];
  const missing: string[] = [];
  const stale: string[] = [];
  let unsearchable = 0;
  for (const candidate of candidates) {
    const row = textRows.get(candidate.assetId);
    if (!row) {
      missing.push(candidate.assetId);
    } else if (row.status === "present") {
      present.push({ candidate, row });
    } else if (row.status === "stale") {
      stale.push(candidate.assetId);
    } else {
      unsearchable++;
    }
  }

  const deadline = Date.now() + grepTimeoutMs();
  let matches: GrepMatchVO[] = [];
  let filesScanned = 0;
  let truncated = false;
  // Honest coverage: a candidate whose scan itself fails (storage error,
  // corrupt cache file, object deleted mid-flight) was NOT actually searched
  // — it must never silently count as a clean "scanned, no match". Reported
  // explicitly rather than folded into `filesScanned`.
  const errored: string[] = [];
  // Present-and-in-scope candidates the scan never even reached because the
  // deadline/maxMatches budget ran out first — itemized (as a count) rather
  // than only implied by the global `truncated` flag.
  let notReached = 0;

  // `rg`-eligibility facts that don't depend on any one candidate — computed
  // once, not per file/batch.
  const literalPattern = isLiteralPattern(input.pattern);
  const caseInsensitive = input.flags.includes("i");

  const concurrency = Math.max(1, grepConcurrency());
  for (let i = 0; i < present.length; ) {
    // Budget check BEFORE dispatching the next batch — same two checks the
    // old sequential loop did before each file, just now per-batch. A batch
    // that's already been dispatched always runs to completion (see below);
    // this is the gate that stops a NEW batch from starting.
    if (Date.now() >= deadline || matches.length >= input.maxMatches) {
      truncated = true;
      notReached = present.length - i;
      break;
    }

    const batch = present.slice(i, i + concurrency);
    // Every file in this batch gets the SAME remaining-match budget,
    // computed once per batch (not per file) — the value the sequential loop
    // already passed to `scanLinesForMatches`'s `maxMatches`.
    const batchMaxMatches = input.maxMatches - matches.length;

    const settled = await Promise.allSettled(
      batch.map(async ({ candidate, row }) => {
        const source = await openAssetTextSource(row);
        const display = displayFor(displayByAsset, candidate);
        const canUseRg =
          literalPattern &&
          input.contextLines === 0 &&
          source.filePath !== undefined &&
          (await isRgAvailable());
        if (canUseRg && source.filePath) {
          try {
            return await scanFileWithRg(source.filePath, input.pattern, {
              assetId: candidate.assetId,
              display,
              maxMatches: batchMaxMatches,
              deadline,
              caseInsensitive,
            });
          } catch {
            // Unexpected `rg` invocation failure for this file — silently
            // fall back to the JS scanner rather than treating a workable
            // file as `errored`; `rg` is optional acceleration only.
          }
        }
        return scanLinesForMatches(source.iterateLines(0), {
          assetId: candidate.assetId,
          display,
          regex,
          contextLines: input.contextLines,
          maxMatches: batchMaxMatches,
          deadline,
        });
      }),
    );

    // Fold per-file outcomes into the shared counters in one place, after
    // the whole batch settles — not scattered increments inside concurrent
    // callbacks — and in the batch's original candidate order (not
    // completion order), so `matches` stays deterministic regardless of
    // which file's I/O happened to finish first.
    for (let j = 0; j < batch.length; j++) {
      const outcome = settled[j];
      if (outcome.status === "fulfilled") {
        filesScanned++;
        matches.push(...outcome.value.matches);
        if (outcome.value.truncated) truncated = true;
      } else {
        // Asset deleted mid-flight, object missing, corrupt cache file, etc.
        // — this candidate was NOT actually searched. Record it so the
        // caller can tell "searched, no match" apart from "we don't
        // actually know" — skipping gracefully rather than failing the
        // whole grep for every other candidate, but never silently as a
        // clean scan.
        errored.push(batch[j].candidate.assetId);
      }
    }

    // A dispatched batch always runs every file to completion, even if an
    // earlier file in the SAME batch already reached `maxMatches` mid-way
    // (no in-flight cancellation) — so `matches` can overshoot by up to
    // `concurrency - 1` files' worth of matches, a bounded amount, never
    // unbounded. Cap it back down right here so the response never actually
    // exceeds `maxMatches`, and so the next iteration's pre-dispatch budget
    // check (top of the loop) sees the true, capped state.
    if (matches.length > input.maxMatches) {
      matches = matches.slice(0, input.maxMatches);
      truncated = true;
    }

    i += batch.length;
  }
  if (matches.length >= input.maxMatches) truncated = true;

  return { matches, filesScanned, missing, stale, unsearchable, errored, notReached, truncated };
};

// ── readLines ────────────────────────────────────────────────────────────────

/**
 * Lazily compute (and persist) line checkpoints + accurate stats for an
 * auto-registered row by scanning its text object once — a read+scan of the
 * already-stored object, never a re-fetch/re-upload. Derived rows always have
 * checkpoints computed eagerly at `putText` time, so this only ever triggers
 * for `writtenBy === "auto"` rows.
 */
const computeAndPersistCheckpoints = async (db: Db, row: AssetTextPO): Promise<AssetTextPO> => {
  const scanner = new TextStreamScanner();
  for await (const chunk of readObjectInChunks(row.textStorageKey)) {
    scanner.write(chunk);
  }
  const result = scanner.finish();

  const updated: AssetTextPO = {
    ...row,
    lineCount: result.lineCount,
    charCount: result.charCount,
    byteCount: result.byteCount,
    lineCheckpoints: result.checkpoints,
    statsComputedAt: new Date(),
  };
  await db
    .update(busabaseAssetTexts)
    .set({
      lineCount: updated.lineCount,
      charCount: updated.charCount,
      byteCount: updated.byteCount,
      lineCheckpoints: updated.lineCheckpoints,
      statsComputedAt: updated.statsComputedAt,
    })
    .where(eq(busabaseAssetTexts.id, row.id));
  return updated;
};

export const readAssetTextLines = async (input: ReadTextLinesInput): Promise<ReadLinesVO> => {
  await ensureReady();
  const db = await getDb();
  const spaceId = getContextSpaceId();

  const requestedStart = Math.max(1, input.startLine);
  let requestedEnd = Math.max(requestedStart, input.endLine);
  if (requestedEnd - requestedStart + 1 > READ_LINES_MAX_LINES) {
    requestedEnd = requestedStart + READ_LINES_MAX_LINES - 1;
  }

  const [assetRow] = await db
    .select({ id: busabaseAssets.id })
    .from(busabaseAssets)
    .where(and(eq(busabaseAssets.id, input.assetId), eq(busabaseAssets.spaceId, spaceId)))
    .limit(1);
  if (!assetRow) {
    throw new ORPCError("NOT_FOUND", { message: `Asset not found: ${input.assetId}` });
  }

  const [row] = await db
    .select()
    .from(busabaseAssetTexts)
    .where(eq(busabaseAssetTexts.assetId, input.assetId))
    .limit(1);
  if (!row || row.status !== "present") {
    throw new ORPCError("BAD_REQUEST", {
      message: `Asset has no readable text (status: ${row?.status ?? "missing"}).`,
    });
  }

  // Lazy checkpoint computation for auto rows whose stats haven't been
  // computed yet — signaled directly by `statsComputedAt` being null (see
  // `autoRegisterAssetText`, which never scans, vs `putAssetText` /
  // `computeAndPersistCheckpoints`, which always set it once real stats are
  // persisted). Derived rows always have checkpoints computed eagerly by
  // `putText`, so never recomputed here.
  //
  // Deliberately NOT inferred from a side lookup (e.g. comparing byteCount
  // against a joined attachment row found by storageKey) — that lookup can
  // silently and permanently stop matching after the asset's attachment is
  // deduped/repointed/deleted, which would make every `readLines` call
  // needlessly recompute checkpoints from scratch forever instead of trusting
  // the ones already computed.
  let effectiveRow = row;
  if (row.writtenBy === "auto" && !row.statsComputedAt) {
    effectiveRow = await computeAndPersistCheckpoints(db, row);
  }

  const totalLines = effectiveRow.lineCount;
  if (totalLines === 0) {
    return {
      lines: [],
      startLine: requestedStart,
      endLine: requestedEnd,
      totalLines,
      truncated: false,
    };
  }

  const clampedStart = Math.min(requestedStart, totalLines);
  const clampedEnd = Math.min(requestedEnd, totalLines);

  const checkpoint = nearestCheckpointAtOrBefore(effectiveRow.lineCheckpoints, clampedStart);
  const source = await openAssetTextSource(effectiveRow);

  const collected: string[] = [];
  let currentLine = checkpoint.line;
  let bytesCollected = 0;
  // Set when the byte cap is what stopped collection — the ONE way the loop
  // can exit early without having actually completed the requested range.
  let byteCapHit = false;

  for await (const rawLine of source.iterateLines(checkpoint.byteOffset)) {
    if (currentLine > clampedEnd) {
      break;
    }
    if (currentLine >= clampedStart) {
      const lineBytes = Buffer.byteLength(rawLine, "utf8") + 1; // +1 for the newline
      // Byte cap hit — but always keep at least the first collected line,
      // even if it alone exceeds the cap (never return nothing).
      if (bytesCollected + lineBytes > READ_LINES_MAX_RESPONSE_BYTES && collected.length > 0) {
        byteCapHit = true;
        break;
      }
      collected.push(rawLine);
      bytesCollected += lineBytes;
    }
    currentLine++;
  }

  // The full requested (already EOF-clamped) range was actually collected iff
  // we didn't stop early for the byte cap AND `currentLine` advanced past
  // `clampedEnd`. That's true both when the loop's own `currentLine >
  // clampedEnd` guard broke it AND when the stream simply ran out exactly at
  // EOF (`clampedEnd === totalLines`, so after consuming the last line
  // `currentLine` is `totalLines + 1`) — the async generator ending on its
  // own never gives the loop body another chance to observe that condition,
  // so it must be checked here, after the loop, not only inside it.
  const completedRequestedRange = !byteCapHit && currentLine > clampedEnd;

  return {
    lines: collected,
    startLine: clampedStart,
    endLine: collected.length > 0 ? clampedStart + collected.length - 1 : clampedStart,
    totalLines,
    truncated: !completedRequestedRange,
  };
};
