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
 */
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
import { type AssetTextPO, busabaseAssetTexts } from "../schema/asset-texts";
import { autoRegisterAssetText } from "./asset-texts-logic";
import { readObjectInChunks } from "./object-stream";
import { openAssetTextSource } from "./text-cache";
import { nearestCheckpointAtOrBefore, TextStreamScanner } from "./text-scan";

type Db = Awaited<ReturnType<typeof getDb>>;

// ── Guardrails ────────────────────────────────────────────────────────────────

/** Overridable (`BUSABASE_GREP_TIMEOUT_MS`) so tests can exercise the timeout path deterministically. */
const grepTimeoutMs = (): number => {
  const raw = process.env.BUSABASE_GREP_TIMEOUT_MS;
  const parsed = raw ? Number(raw) : Number.NaN;
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 10_000;
};
const MAX_PATTERN_LENGTH = 500;
/**
 * Regex against a line is only ever run within this many chars — bounds one
 * exec's cost. Deliberately tight (not the object/response caps elsewhere in
 * this file): catastrophic-backtracking cost is exponential in input length,
 * so even at this size a crafted pattern that slips past
 * `CATASTROPHIC_PATTERN_HINT` / `hasOverlappingQuantifiedAlternation` can
 * still make a single `regex.exec` call run far longer than is comfortable —
 * a single `exec` is NOT interruptible by the scan deadline (that's only
 * re-checked between lines). This guard reduces, but does not eliminate, that
 * residual risk; see the Drive Grep Retrieval PR report for the full caveat.
 */
const LONG_LINE_GUARD_CHARS = 8 * 1024;
const READ_LINES_MAX_LINES = 2000;
const READ_LINES_MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
/** How often (in scanned lines) to re-check the wall-clock budget mid-file. */
const DEADLINE_CHECK_EVERY_LINES = 500;

// A crude but effective heuristic for classic catastrophic-backtracking shapes:
// a quantified group directly re-quantified, e.g. `(a+)+`, `(a*)*`, `(a+){2,}`.
const CATASTROPHIC_PATTERN_HINT = /\([^()]*[+*][^()]*\)[+*]|\([^()]*[+*][^()]*\)\{\d*,/;

/**
 * The other classic catastrophic-backtracking shape: a quantified group whose
 * alternation branches overlap — one is a prefix of another, or two are
 * identical — e.g. `(a|a)*`, `(a|aa)*`. Detected structurally (split the
 * group body on unescaped `|`, compare branches) rather than flagging ANY
 * quantified alternation, which would false-positive on ordinary, safe
 * patterns like `(cat|dog)*` or `(foo|bar){2,5}` (their branches share no
 * prefix relationship, so they can't blow up the same way).
 *
 * Same scope limitation as `CATASTROPHIC_PATTERN_HINT`: only looks at groups
 * with no nested parens (`[^()]*`) — a crude-but-effective heuristic, not a
 * full regex parser.
 */
const hasOverlappingQuantifiedAlternation = (pattern: string): boolean => {
  const groupWithQuantifier = /\(([^()]*)\)(?:[+*]|\{\d*,)/g;
  for (const match of pattern.matchAll(groupWithQuantifier)) {
    const body = match[1];
    if (!body.includes("|")) continue;
    const branches = body.split(/(?<!\\)\|/).filter((branch) => branch.length > 0);
    for (let i = 0; i < branches.length; i++) {
      for (let j = i + 1; j < branches.length; j++) {
        const a = branches[i];
        const b = branches[j];
        if (a === b || a.startsWith(b) || b.startsWith(a)) {
          return true;
        }
      }
    }
  }
  return false;
};

/**
 * Compile a caller-supplied grep pattern defensively: length-capped, a
 * heuristic reject for classic catastrophic-backtracking shapes, and only the
 * `i` flag is honored (line-by-line scanning already makes `m`/`s` moot; `g`/`y`
 * would introduce `lastIndex` statefulness we don't want).
 *
 * NOTE (residual risk, not fully closed): these heuristics catch the classic
 * shapes named above, but regex catastrophic backtracking has other forms
 * this crude structural check does not exhaustively cover, and a single
 * `regex.exec` call is not itself interruptible by the scan deadline once
 * started (see `LONG_LINE_GUARD_CHARS`). A fully robust fix would run pattern
 * matching in a worker thread with a hard timeout — out of scope for this
 * pass; flagged here as a follow-up rather than silently claimed solved.
 */
export const compileGrepPattern = (pattern: string, flags = ""): RegExp => {
  if (pattern.length === 0) {
    throw new ORPCError("BAD_REQUEST", { message: "pattern must not be empty." });
  }
  if (pattern.length > MAX_PATTERN_LENGTH) {
    throw new ORPCError("BAD_REQUEST", {
      message: `pattern exceeds the ${MAX_PATTERN_LENGTH}-char limit.`,
    });
  }
  if (CATASTROPHIC_PATTERN_HINT.test(pattern) || hasOverlappingQuantifiedAlternation(pattern)) {
    throw new ORPCError("BAD_REQUEST", {
      message:
        "pattern rejected: nested/overlapping quantifiers can cause catastrophic backtracking.",
    });
  }
  const safeFlags = [...new Set([...flags].filter((flag) => flag === "i"))].join("");
  try {
    return new RegExp(pattern, safeFlags);
  } catch (error) {
    throw new ORPCError("BAD_REQUEST", {
      message: `Invalid pattern: ${error instanceof Error ? error.message : String(error)}`,
    });
  }
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

const loadAssetTextRows = async (db: Db, assetIds: string[]): Promise<Map<string, AssetTextPO>> => {
  if (assetIds.length === 0) return new Map();
  const rows = await db
    .select()
    .from(busabaseAssetTexts)
    .where(inArray(busabaseAssetTexts.assetId, assetIds));
  return new Map(rows.map((row) => [row.assetId, row]));
};

// ── Line-by-line matching with context ──────────────────────────────────────

interface PendingMatch {
  match: GrepMatchVO;
  afterNeeded: number;
}

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
  const matches: GrepMatchVO[] = [];
  const pending: PendingMatch[] = [];
  const rollingBefore: string[] = [];
  let lineNumber = 0;
  let linesSinceCheck = 0;
  let truncated = false;

  const flushReady = () => {
    while (pending.length > 0 && pending[0].afterNeeded === 0) {
      const next = pending.shift();
      if (next) matches.push(next.match);
    }
  };

  for await (const rawLine of lines) {
    lineNumber++;
    linesSinceCheck++;
    if (linesSinceCheck >= DEADLINE_CHECK_EVERY_LINES) {
      linesSinceCheck = 0;
      if (Date.now() >= opts.deadline) {
        truncated = true;
        break;
      }
    }

    for (const item of pending) {
      if (item.afterNeeded > 0) {
        item.match.after.push(rawLine);
        item.afterNeeded--;
      }
    }
    flushReady();
    if (matches.length >= opts.maxMatches) {
      truncated = true;
      break;
    }

    if (matches.length + pending.length < opts.maxMatches) {
      const withinGuard = rawLine.length > LONG_LINE_GUARD_CHARS;
      const guardedLine = withinGuard ? rawLine.slice(0, LONG_LINE_GUARD_CHARS) : rawLine;
      const execResult = opts.regex.exec(guardedLine);
      if (execResult) {
        const match: GrepMatchVO = {
          assetId: opts.assetId,
          fileName: opts.display.fileName,
          drivePath: opts.display.drivePath,
          line: lineNumber,
          column: execResult.index + 1,
          text: withinGuard ? `${guardedLine}…` : guardedLine,
          before: [...rollingBefore],
          after: [],
        };
        if (opts.contextLines > 0) {
          pending.push({ match, afterNeeded: opts.contextLines });
        } else {
          matches.push(match);
        }
      }
    }

    if (opts.contextLines > 0) {
      rollingBefore.push(rawLine);
      if (rollingBefore.length > opts.contextLines) rollingBefore.shift();
    }

    if (matches.length >= opts.maxMatches && pending.length === 0) {
      truncated = true;
      break;
    }
  }

  // EOF (or deadline break) — flush whatever pending matches have (partial `after` is fine).
  while (pending.length > 0 && matches.length < opts.maxMatches) {
    const next = pending.shift();
    if (next) matches.push(next.match);
  }
  if (pending.length > 0) truncated = true;

  return { matches: matches.slice(0, opts.maxMatches), truncated };
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
  const matches: GrepMatchVO[] = [];
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

  for (let i = 0; i < present.length; i++) {
    const { candidate, row } = present[i];
    if (Date.now() >= deadline || matches.length >= input.maxMatches) {
      truncated = true;
      notReached = present.length - i;
      break;
    }
    try {
      const source = await openAssetTextSource(row);
      const result = await scanLinesForMatches(source.iterateLines(0), {
        assetId: candidate.assetId,
        display: displayFor(displayByAsset, candidate),
        regex,
        contextLines: input.contextLines,
        maxMatches: input.maxMatches - matches.length,
        deadline,
      });
      filesScanned++;
      matches.push(...result.matches);
      if (result.truncated) truncated = true;
    } catch {
      // Asset deleted mid-flight, object missing, corrupt cache file, etc. —
      // this candidate was NOT actually searched. Record it so the caller can
      // tell "searched, no match" apart from "we don't actually know" —
      // skipping gracefully rather than failing the whole grep for every
      // other candidate, but never silently as a clean scan.
      errored.push(candidate.assetId);
    }
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
