"use client";

import type {
  UnifiedGrepCoverage,
  UnifiedGrepMatchVO,
} from "busabase-contract/contract/grep-schemas";
import { FileText, Rows3, Table2 } from "lucide-react";
import { SPALink as Link } from "openlib/ui/dashboard";
import type { ReactNode } from "react";
import { fmt, useCoreI18n } from "../../../i18n";
import { mergeSearchIntoHref } from "../helpers/link-search";

/**
 * Rendering for `grep` hits — deliberately NOT the `search` result row.
 *
 * A search result is a THING (a record, a file) with a title and a timestamp.
 * A grep hit is a POSITION: this file, this line, this column, with the lines
 * around it. Squeezing one into the other's row would throw away the only thing
 * that makes a pattern search worth running — being able to see the match in
 * its context without opening anything.
 */

const sourceIcon: Record<UnifiedGrepMatchVO["source"], ReactNode> = {
  files: <FileText className="size-3.5" />,
  nodes: <Rows3 className="size-3.5" />,
  records: <Table2 className="size-3.5" />,
};

/** Where a hit lives, as a line a person can read. */
const hitLocation = (match: UnifiedGrepMatchVO): string => {
  if (match.source === "files") {
    // `drivePath` is the mounted path INCLUDING the file name (it mirrors
    // `busabase_asset_usages.path`), so joining it to `fileName` renders
    // `exports/december.csv/december.csv`. It is empty for an asset that is not
    // path-mounted — a File node — which is the only case that needs the name.
    return match.drivePath || match.fileName;
  }
  if (match.source === "nodes") return match.name;
  return `${match.baseSlug} · ${match.fieldSlug}`;
};

/** The dashboard route that opens the thing a hit is inside. */
const hitHref = (match: UnifiedGrepMatchVO, currentSearch: string): string => {
  const path =
    match.source === "files"
      ? `/assets/${match.assetId}`
      : match.source === "nodes"
        ? `/${match.type}/${match.slug}`
        : `/base/${match.baseSlug}/${match.recordId}`;
  return mergeSearchIntoHref(path, currentSearch);
};

/** A stable key: the same asset/node/record can match on many lines. */
const hitKey = (match: UnifiedGrepMatchVO): string => {
  const owner =
    match.source === "files"
      ? match.assetId
      : match.source === "nodes"
        ? match.nodeId
        : `${match.recordId}:${match.fieldSlug}`;
  return `${match.source}:${owner}:${match.line}:${match.column}`;
};

function MatchLine({ match }: { match: UnifiedGrepMatchVO }) {
  const messages = useCoreI18n();
  const t = messages.searchPage;
  return (
    <pre className="mt-1.5 overflow-x-auto rounded-md bg-muted/50 px-2.5 py-1.5 font-mono text-[11px] leading-relaxed">
      {match.before.map((line, index) => (
        <div
          className="text-muted-foreground"
          // Context lines carry no id of their own and can repeat verbatim, so
          // their offset from the hit is the only stable thing about them.
          key={`before-${match.line - match.before.length + index}`}
        >
          {line}
        </div>
      ))}
      <div className="text-foreground">
        <span className="mr-2 select-none text-muted-foreground">
          {fmt(t.patternLineNumber, { line: String(match.line) })}
        </span>
        {match.text}
      </div>
      {match.after.map((line, index) => (
        <div className="text-muted-foreground" key={`after-${match.line + index + 1}`}>
          {line}
        </div>
      ))}
    </pre>
  );
}

export function GrepMatchRow({
  currentSearch,
  match,
}: {
  currentSearch: string;
  match: UnifiedGrepMatchVO;
}) {
  const messages = useCoreI18n();
  const t = messages.searchPage;
  return (
    <div className="rounded-lg px-3 py-2.5 transition-colors hover:bg-muted">
      <div className="flex min-w-0 items-center gap-2">
        <span className="flex size-6 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
          {sourceIcon[match.source]}
        </span>
        <Link
          className="min-w-0 flex-1 truncate font-medium text-foreground text-sm"
          href={hitHref(match, currentSearch)}
        >
          {hitLocation(match)}
        </Link>
        {/* A whiteboard/workflow body is stored as JSON, so grep's `line`
            indexes EXTRACTED text in document order — it is not a position to
            open the file at, and saying so beats letting someone hunt for
            line 34 in a canvas. */}
        {match.source === "nodes" && (match.type === "whiteboard" || match.type === "workflow") ? (
          <span className="shrink-0 rounded bg-muted/70 px-1.5 py-0.5 text-[10px] text-muted-foreground">
            {t.patternExtractedText}
          </span>
        ) : null}
      </div>
      <MatchLine match={match} />
    </div>
  );
}

/**
 * What the scan did NOT read.
 *
 * Collapsed by default — it is diagnostics, not results — but present, because
 * an empty grep result has two very different meanings ("your pattern is not in
 * this workspace" vs "half of it was never opened") and the coverage block is
 * the only thing that tells them apart.
 */
export function GrepCoverageNote({
  coverage,
  truncated,
}: {
  coverage: UnifiedGrepCoverage;
  truncated: boolean;
}) {
  const messages = useCoreI18n();
  const t = messages.searchPage;

  const scanned = coverage.files.scanned + coverage.nodes.scanned + coverage.records.scanned;
  const notReached =
    coverage.files.notReached + coverage.nodes.notReached + coverage.records.notReached;
  const errored =
    coverage.files.errored.length + coverage.nodes.errored.length + coverage.records.errored.length;
  const unread =
    coverage.files.missing.length + coverage.files.stale.length + coverage.files.unsearchable;

  const incomplete = truncated || notReached > 0 || errored > 0 || unread > 0;

  return (
    <details className="mt-3 rounded-lg border border-border/60 px-3 py-2">
      <summary className="cursor-pointer text-muted-foreground text-xs">
        {incomplete ? t.patternCoverageIncomplete : t.patternCoverageComplete}
      </summary>
      <ul className="mt-2 space-y-0.5 text-muted-foreground text-[11px]">
        <li>{fmt(t.patternCoverageScanned, { count: String(scanned) })}</li>
        {notReached > 0 ? (
          <li>{fmt(t.patternCoverageNotReached, { count: String(notReached) })}</li>
        ) : null}
        {unread > 0 ? <li>{fmt(t.patternCoverageUnread, { count: String(unread) })}</li> : null}
        {errored > 0 ? <li>{fmt(t.patternCoverageErrored, { count: String(errored) })}</li> : null}
      </ul>
    </details>
  );
}

export { hitKey };
