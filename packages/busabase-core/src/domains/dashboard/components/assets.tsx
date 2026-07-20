import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { BusabaseQueryUtils } from "busabase-contract/api-client/react-query";
import type { AssetTextStatus } from "busabase-contract/types";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "kui/dialog";
import { Skeleton } from "kui/skeleton";
import {
  AlertTriangle,
  ArrowLeft,
  ChevronRight,
  FileText,
  FileX,
  Film,
  Image as ImageIcon,
  Music,
  RefreshCw,
  Trash2,
  Upload,
} from "lucide-react";
import { type ReactNode, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { fmt, useCoreI18n } from "../../../i18n";
import { INLINE_ASSET_TEXT_MAX_BYTES, isTxtFile, utf8ByteLength } from "../helpers/asset-text-grep";
import { ConfirmActionDialog, EmptyState } from "./primitives";

export const assetSizeUnits = ["B", "KB", "MB", "GB"];
export function formatAssetSize(bytes: number): string {
  if (!bytes) return "0 B";
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), assetSizeUnits.length - 1);
  const value = bytes / 1024 ** i;
  return `${value >= 10 || i === 0 ? Math.round(value) : value.toFixed(1)} ${assetSizeUnits[i]}`;
}

export function assetKindIcon(mimeType: string) {
  if (mimeType.startsWith("image/")) return ImageIcon;
  if (mimeType.startsWith("video/")) return Film;
  if (mimeType.startsWith("audio/")) return Music;
  return FileText;
}

export function hasAssetMetadata(metadata: Record<string, unknown> | null | undefined) {
  return Object.keys(metadata ?? {}).length > 0;
}

export function formatAssetMetadata(metadata: Record<string, unknown> | null | undefined) {
  return JSON.stringify(hasAssetMetadata(metadata) ? metadata : {}, null, 2);
}

// `present` is the expected/healthy state — silent, no badge, matching the
// existing convention here (badges only appear for notable/actionable states,
// like `unusedBadge` above). `missing` and `stale` are the two states an
// agent/user can actually act on (supply text / re-supply after a replace);
// `none` is a deliberate terminal "nothing to extract" state. See the Drive
// Grep Retrieval spec's textStatus lifecycle for the full state machine.
export function AssetTextStatusChip({ status }: { status: AssetTextStatus }) {
  const messages = useCoreI18n();
  if (status === "present") return null;

  const config = {
    missing: {
      Icon: FileText,
      label: messages.assets.textStatusMissing,
      hint: messages.assets.textStatusMissingHint,
      className: "border-muted-foreground/30 bg-muted text-muted-foreground",
    },
    none: {
      Icon: FileX,
      label: messages.assets.textStatusNone,
      hint: messages.assets.textStatusNoneHint,
      className: "border-muted-foreground/30 bg-muted text-muted-foreground",
    },
    stale: {
      Icon: AlertTriangle,
      label: messages.assets.textStatusStale,
      hint: messages.assets.textStatusStaleHint,
      className:
        "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300",
    },
  }[status];

  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 font-medium text-[11px] ${config.className}`}
      title={config.hint}
    >
      <config.Icon className="size-3" />
      {config.label}
    </span>
  );
}

export function AssetMetadataBlock({
  metadata,
  framed = false,
  compact = false,
}: {
  metadata: Record<string, unknown> | null | undefined;
  framed?: boolean;
  compact?: boolean;
}) {
  const messages = useCoreI18n();
  const content = (
    <>
      <div className="mb-2 flex items-center justify-between gap-2">
        <h2 className="font-medium text-sm">{messages.assets.metadata}</h2>
        {hasAssetMetadata(metadata) ? (
          <span className="rounded-full border bg-muted px-2 py-0.5 text-muted-foreground text-[10px] uppercase">
            {messages.assets.metadataJson}
          </span>
        ) : null}
      </div>
      <pre
        className={`overflow-auto whitespace-pre-wrap break-words rounded-md border bg-muted/40 p-3 font-mono text-[11px] leading-5 ${compact ? "max-h-48" : "max-h-72"}`}
      >
        {formatAssetMetadata(metadata)}
      </pre>
    </>
  );

  return framed ? (
    <div className="rounded-xl border bg-background p-4">{content}</div>
  ) : (
    <div className="mt-3 border-t pt-3">{content}</div>
  );
}

// How many lines each fetch (first expand, or "load more") pulls — well under
// the server's 2000-line/~2MB cap (see readTextLines' successDescription), so
// an initial preview stays cheap even for a huge file.
const TEXT_PREVIEW_WINDOW_SIZE = 500;

/**
 * Collapsed-by-default preview of an asset's extracted text (Drive Grep
 * Retrieval's `readTextLines`). Only ever rendered for `present`/`stale`
 * textStatus (see call site) — `missing`/`none` have nothing to preview.
 * Fetches lazily (nothing hits the network until expanded), in appendable
 * 500-line windows instead of the full file, and keeps already-fetched
 * chunks in local state rather than growing a single ever-larger query.
 */
export function AssetTextPreviewPanel({
  orpc,
  assetId,
  textStatus,
}: {
  orpc: BusabaseQueryUtils;
  assetId: string;
  textStatus: AssetTextStatus;
}) {
  const messages = useCoreI18n();
  const [isExpanded, setIsExpanded] = useState(false);
  const [lines, setLines] = useState<string[]>([]);
  const [loadedThrough, setLoadedThrough] = useState(0);
  const [totalLines, setTotalLines] = useState<number | null>(null);
  const [truncated, setTruncated] = useState(false);
  const [range, setRange] = useState({ startLine: 1, endLine: TEXT_PREVIEW_WINDOW_SIZE });

  // Reset all accumulated preview state when the asset itself changes — this
  // component's local state would otherwise leak across assets if the parent
  // AssetDetailView instance is reused for a different assetId.
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset only on assetId change
  useEffect(() => {
    setIsExpanded(false);
    setLines([]);
    setLoadedThrough(0);
    setTotalLines(null);
    setTruncated(false);
    setRange({ startLine: 1, endLine: TEXT_PREVIEW_WINDOW_SIZE });
  }, [assetId]);

  const textLinesQuery = useQuery({
    ...orpc.assets.readTextLines.queryOptions({
      input: { assetId, startLine: range.startLine, endLine: range.endLine },
    }),
    enabled: isExpanded,
  });

  // Append each newly-resolved window to the accumulated preview once, keyed
  // off `loadedThrough` so re-fetches of an already-loaded window (e.g.
  // collapsing then re-expanding) don't duplicate lines.
  useEffect(() => {
    const data = textLinesQuery.data;
    if (!data || data.startLine <= loadedThrough) return;
    setLines((current) => [...current, ...data.lines]);
    setLoadedThrough(data.endLine);
    setTotalLines(data.totalLines);
    setTruncated(data.truncated);
  }, [textLinesQuery.data, loadedThrough]);

  if (textStatus !== "present" && textStatus !== "stale") return null;

  const hasMore = totalLines !== null && (truncated || totalLines > loadedThrough);
  const isBusy = textLinesQuery.isFetching;

  return (
    <div className="rounded-xl border bg-background p-4">
      <button
        className="flex w-full items-center gap-1.5 text-left font-medium text-sm"
        onClick={() => setIsExpanded((current) => !current)}
        type="button"
      >
        <ChevronRight
          className={`size-3.5 shrink-0 text-muted-foreground transition-transform ${isExpanded ? "rotate-90" : ""}`}
        />
        {isExpanded ? messages.assets.textPreviewHide : messages.assets.textPreviewShow}
      </button>

      {isExpanded ? (
        <div className="mt-3 border-t pt-3">
          {textStatus === "stale" ? (
            <p className="mb-2 rounded-md border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-amber-800 text-xs dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300">
              {messages.assets.textPreviewStaleWarning}
            </p>
          ) : null}

          {textLinesQuery.isError ? (
            <p className="rounded-md border border-destructive/40 bg-destructive/10 px-2.5 py-1.5 text-destructive text-xs">
              {textLinesQuery.error instanceof Error
                ? textLinesQuery.error.message
                : messages.assets.textPreviewFailed}
            </p>
          ) : null}

          {lines.length > 0 ? (
            <pre className="max-h-96 overflow-y-auto whitespace-pre-wrap break-words rounded-md border bg-muted/40 p-3 font-mono text-[11px] leading-5">
              {lines.join("\n")}
            </pre>
          ) : null}

          {isBusy ? (
            <p className="mt-2 text-muted-foreground text-xs">
              {messages.assets.textPreviewLoading}
            </p>
          ) : null}

          <div className="mt-2 flex items-center gap-2">
            {!isBusy && hasMore ? (
              <button
                className="rounded-md border bg-background px-2.5 py-1 text-xs hover:bg-muted"
                onClick={() =>
                  setRange({
                    startLine: loadedThrough + 1,
                    endLine: loadedThrough + TEXT_PREVIEW_WINDOW_SIZE,
                  })
                }
                type="button"
              >
                {messages.search.loadMore}
              </button>
            ) : null}
            {totalLines !== null && loadedThrough > 0 ? (
              <span className="text-muted-foreground text-[11px]">
                {fmt(messages.assets.textPreviewRange, {
                  start: 1,
                  end: loadedThrough,
                  total: totalLines,
                })}
              </span>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function AssetsHeader({ count, unusedCount = 0 }: { count: number; unusedCount?: number }) {
  const messages = useCoreI18n();

  return (
    <div className="flex items-center gap-2">
      <ImageIcon className="size-5 text-muted-foreground" />
      <h1 className="font-semibold text-xl">{messages.assets.title}</h1>
      {count > 0 ? (
        <span className="rounded-full border bg-muted px-2 py-0.5 text-muted-foreground text-xs">
          {count}
        </span>
      ) : null}
      {unusedCount > 0 ? (
        <span className="rounded-full border border-destructive/40 px-2 py-0.5 text-destructive text-xs">
          {fmt(messages.assets.unusedBadge, { count: unusedCount })}
        </span>
      ) : null}
    </div>
  );
}

// The deduped Asset library (grid) + per-asset detail with the Where-Used panel.
// A global view (not a node-tree screen): `/assets` and `/assets/:assetId`.
export function AssetsView({
  orpc,
  assetId,
  onOpenAsset,
  onBack,
  onOpenNode,
  emptyGuide,
}: {
  orpc: BusabaseQueryUtils;
  assetId: string | null;
  onOpenAsset: (id: string) => void;
  onBack: () => void;
  onOpenNode: (nodeType: string, nodeSlug: string) => void;
  emptyGuide?: ReactNode;
}) {
  return (
    <div className="h-full min-h-0 w-full min-w-0 overflow-auto" data-dashboard-scroll="assets">
      {assetId ? (
        <AssetDetailView assetId={assetId} onBack={onBack} onOpenNode={onOpenNode} orpc={orpc} />
      ) : (
        <AssetLibraryView emptyGuide={emptyGuide} onOpenAsset={onOpenAsset} orpc={orpc} />
      )}
    </div>
  );
}

const ASSET_CARD_SKELETON_IDS = [
  "asset-card-skel-1",
  "asset-card-skel-2",
  "asset-card-skel-3",
  "asset-card-skel-4",
  "asset-card-skel-5",
  "asset-card-skel-6",
  "asset-card-skel-7",
  "asset-card-skel-8",
];

// Mirrors the card grid rendered once `listQuery` resolves (square thumbnail
// + name/size below it), at the same responsive column counts, so the
// library's first load shimmers into shape instead of showing plain text in
// an otherwise-empty pane.
function AssetLibrarySkeleton() {
  return (
    <div className="w-full p-4 md:p-6" aria-hidden>
      <div className="flex items-center gap-2">
        <Skeleton className="size-5 rounded" />
        <Skeleton className="h-6 w-24" />
      </div>
      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-8">
        {ASSET_CARD_SKELETON_IDS.map((id) => (
          <div className="flex flex-col overflow-hidden rounded-lg border bg-background" key={id}>
            <Skeleton className="aspect-square w-full rounded-none" />
            <div className="flex flex-col gap-1.5 p-2">
              <Skeleton className="h-4 w-4/5" />
              <Skeleton className="h-3 w-1/3" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function AssetLibraryView({
  orpc,
  onOpenAsset,
  emptyGuide,
}: {
  orpc: BusabaseQueryUtils;
  onOpenAsset: (id: string) => void;
  emptyGuide?: ReactNode;
}) {
  const messages = useCoreI18n();
  const listQuery = useQuery(orpc.assets.list.queryOptions({}));
  const [unusedOnly, setUnusedOnly] = useState(false);
  const allAssets = listQuery.data ?? [];
  const unusedCount = useMemo(
    () => allAssets.filter((asset) => asset.usageCount === 0).length,
    [allAssets],
  );
  const assets = unusedOnly ? allAssets.filter((asset) => asset.usageCount === 0) : allAssets;

  if (listQuery.isLoading) {
    return <AssetLibrarySkeleton />;
  }
  if (listQuery.isError) {
    return (
      <div className="w-full p-4 md:p-6">
        <AssetsHeader count={0} />
        <EmptyState
          body={
            listQuery.error instanceof Error ? listQuery.error.message : messages.assets.failedBody
          }
          title={messages.assets.failedTitle}
        />
      </div>
    );
  }
  if (allAssets.length === 0) {
    return (
      <div className="w-full p-4 md:p-6">
        <AssetsHeader count={0} />
        <EmptyState
          body={messages.assets.emptyBody}
          title={messages.assets.emptyTitle}
          action={emptyGuide}
        />
      </div>
    );
  }
  return (
    <div className="w-full p-4 md:p-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <AssetsHeader count={allAssets.length} unusedCount={unusedCount} />
        {unusedCount > 0 ? (
          <label className="flex items-center gap-1.5 text-muted-foreground text-sm">
            <input
              checked={unusedOnly}
              className="size-4 shrink-0 accent-foreground"
              onChange={(event) => setUnusedOnly(event.target.checked)}
              type="checkbox"
            />
            {messages.assets.unusedOnly}
          </label>
        ) : null}
      </div>
      {assets.length === 0 ? (
        <p className="mt-4 text-muted-foreground text-sm">{messages.assets.noUnusedAssets}</p>
      ) : (
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-8">
          {assets.map((asset) => {
            const Icon = assetKindIcon(asset.mimeType);
            const isImage = asset.mimeType.startsWith("image/");
            return (
              <button
                className="group flex flex-col overflow-hidden rounded-lg border bg-background text-left transition-colors hover:border-foreground/30"
                key={asset.id}
                onClick={() => onOpenAsset(asset.id)}
                type="button"
              >
                <div className="relative grid aspect-square place-items-center overflow-hidden bg-muted">
                  {isImage ? (
                    <img
                      alt={asset.name}
                      className="h-full w-full object-cover"
                      loading="lazy"
                      src={asset.url}
                    />
                  ) : (
                    <Icon className="size-10 text-muted-foreground" />
                  )}
                  {asset.usageCount > 0 ? (
                    <span className="absolute top-1.5 right-1.5 rounded-full bg-foreground/80 px-1.5 py-0.5 font-medium text-[10px] text-background">
                      {asset.usageCount}×
                    </span>
                  ) : null}
                  {hasAssetMetadata(asset.metadata) ? (
                    <span className="absolute bottom-1.5 left-1.5 rounded-full bg-background/90 px-1.5 py-0.5 font-medium text-[10px] text-foreground uppercase shadow-sm">
                      {messages.assets.metadataBadge}
                    </span>
                  ) : null}
                </div>
                <div className="flex flex-col gap-0.5 p-2">
                  <span className="truncate font-medium text-sm" title={asset.name}>
                    {asset.name}
                  </span>
                  <span className="text-muted-foreground text-xs">
                    {formatAssetSize(asset.size)}
                  </span>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

type AssetTextWriteMode = "paste" | "upload";
type AssetTextWritePhase = "idle" | "requesting" | "uploading" | "binding" | "saving";

export function AssetSearchableTextPanel({
  assetId,
  orpc,
  status,
  onPersisted,
}: {
  assetId: string;
  orpc: BusabaseQueryUtils;
  status: AssetTextStatus;
  onPersisted: () => Promise<void>;
}) {
  const messages = useCoreI18n();
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<AssetTextWriteMode>("paste");
  const [text, setText] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [pendingStorageKey, setPendingStorageKey] = useState<string | null>(null);
  const [phase, setPhase] = useState<AssetTextWritePhase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [confirmReplace, setConfirmReplace] = useState(false);
  const [confirmNone, setConfirmNone] = useState(false);
  const putTextMutation = useMutation(orpc.assets.putText.mutationOptions());
  const createUploadMutation = useMutation(orpc.assets.createTextUploadUrl.mutationOptions());
  const byteCount = utf8ByteLength(text);
  const pasteTooLarge = byteCount > INLINE_ASSET_TEXT_MAX_BYTES;
  const isBusy = phase !== "idle";
  const actionLabel =
    status === "present" ? messages.assets.textReplace : messages.assets.textSupply;

  const resetWriteState = () => {
    setText("");
    setFile(null);
    setPendingStorageKey(null);
    setError(null);
    setPhase("idle");
    setMode("paste");
    setConfirmReplace(false);
  };

  const persistSuccess = async () => {
    await onPersisted();
    toast.success(messages.assets.textWriteSuccess);
    setOpen(false);
    resetWriteState();
  };

  const writePaste = async () => {
    setPhase("saving");
    await putTextMutation.mutateAsync({ assetId, text });
    await persistSuccess();
  };

  const validateUpload = (selectedFile: File) => {
    if (!isTxtFile(selectedFile)) {
      throw new Error(messages.assets.textUploadTxtOnly);
    }
    if (selectedFile.size === 0) {
      throw new Error(messages.assets.textUploadEmpty);
    }
  };

  const writeUpload = async () => {
    if (!file) return;
    validateUpload(file);
    let storageKey = pendingStorageKey;
    if (!storageKey) {
      setPhase("requesting");
      const upload = await createUploadMutation.mutateAsync({ assetId, sizeBytes: file.size });
      setPhase("uploading");
      const response = await fetch(upload.uploadUrl, {
        method: "PUT",
        body: file,
        headers: { "Content-Type": "text/plain; charset=utf-8" },
      });
      if (!response.ok) {
        throw new Error(fmt(messages.assets.textUploadHttpFailed, { status: response.status }));
      }
      storageKey = upload.storageKey;
      setPendingStorageKey(storageKey);
    }
    setPhase("binding");
    try {
      await putTextMutation.mutateAsync({ assetId, storageKey });
    } catch (bindError) {
      // The server may consume/delete the temporary object before a later
      // persistence failure. Re-uploading is the only reliable retry path.
      setPendingStorageKey(null);
      if (bindError instanceof Error && bindError.message.includes("not valid UTF-8")) {
        throw new Error(messages.assets.textUploadUtf8Only);
      }
      throw bindError;
    }
    await persistSuccess();
  };

  const executeWrite = async () => {
    setError(null);
    try {
      if (mode === "paste") await writePaste();
      else await writeUpload();
    } catch (writeError) {
      setError(writeError instanceof Error ? writeError.message : messages.assets.textWriteFailed);
      setPhase("idle");
    }
  };

  const requestWrite = () => {
    if (status === "present") {
      // Do not stack this confirmation beside the KUI dialog: its focus trap
      // makes sibling overlays inaccessible. Preserve the entered payload and
      // reopen it if the user cancels.
      setOpen(false);
      setConfirmReplace(true);
      return;
    }
    void executeWrite();
  };

  const markNone = async () => {
    setError(null);
    setPhase("saving");
    try {
      await putTextMutation.mutateAsync({ assetId, none: true });
      await persistSuccess();
      setConfirmNone(false);
    } catch (writeError) {
      setError(writeError instanceof Error ? writeError.message : messages.assets.textWriteFailed);
      setPhase("idle");
      setConfirmNone(false);
    }
  };

  const submitDisabled =
    isBusy || (mode === "paste" ? text.length === 0 || pasteTooLarge : file === null);

  return (
    <div className="rounded-xl border bg-background p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="font-medium text-sm">{messages.assets.searchableText}</h2>
          <p className="mt-1 text-muted-foreground text-xs leading-5">
            {messages.assets.searchableTextDescription}
          </p>
        </div>
        <AssetTextStatusChip status={status} />
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          className="inline-flex items-center gap-1.5 rounded-md bg-foreground px-2.5 py-1.5 font-medium text-background text-xs hover:bg-foreground/85"
          onClick={() => setOpen(true)}
          type="button"
        >
          <RefreshCw className="size-3.5" />
          {actionLabel}
        </button>
        {status !== "none" ? (
          <button
            className="rounded-md border bg-background px-2.5 py-1.5 text-muted-foreground text-xs hover:bg-muted hover:text-foreground"
            onClick={() => setConfirmNone(true)}
            type="button"
          >
            {messages.assets.textMarkNone}
          </button>
        ) : null}
      </div>
      {error && !open ? (
        <div className="mt-3 rounded-md border border-destructive/40 bg-destructive/10 px-2.5 py-2 text-destructive text-xs">
          {error}
        </div>
      ) : null}

      <Dialog
        open={open}
        onOpenChange={(nextOpen) => {
          if (isBusy) return;
          setOpen(nextOpen);
          if (!nextOpen) resetWriteState();
        }}
      >
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>{actionLabel}</DialogTitle>
            <DialogDescription>{messages.assets.textWriteDescription}</DialogDescription>
          </DialogHeader>

          <div className="flex rounded-md border bg-muted p-1" role="tablist">
            {(["paste", "upload"] as const).map((writeMode) => (
              <button
                aria-selected={mode === writeMode}
                className={`flex-1 rounded-sm px-3 py-1.5 font-medium text-sm ${
                  mode === writeMode
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground"
                }`}
                disabled={isBusy}
                key={writeMode}
                onClick={() => {
                  setMode(writeMode);
                  setError(null);
                }}
                role="tab"
                type="button"
              >
                {writeMode === "paste" ? messages.assets.textPaste : messages.assets.textUpload}
              </button>
            ))}
          </div>

          {mode === "paste" ? (
            <div>
              <label className="font-medium text-sm" htmlFor="asset-searchable-text">
                {messages.assets.textPasteLabel}
              </label>
              <textarea
                className="mt-2 min-h-48 w-full resize-y rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
                disabled={isBusy}
                id="asset-searchable-text"
                onChange={(event) => setText(event.target.value)}
                placeholder={messages.assets.textPastePlaceholder}
                value={text}
              />
              <div
                className={`mt-1 text-xs ${pasteTooLarge ? "text-destructive" : "text-muted-foreground"}`}
              >
                {fmt(messages.assets.textByteCount, {
                  count: byteCount,
                  limit: INLINE_ASSET_TEXT_MAX_BYTES,
                })}
                {pasteTooLarge ? ` ${messages.assets.textPasteTooLarge}` : ""}
              </div>
            </div>
          ) : (
            <div>
              <label className="font-medium text-sm" htmlFor="asset-searchable-text-file">
                {messages.assets.textUploadLabel}
              </label>
              <input
                accept=".txt,text/plain"
                className="mt-2 block w-full rounded-md border bg-background px-3 py-2 text-sm file:mr-3 file:rounded-md file:border-0 file:bg-muted file:px-2.5 file:py-1 file:text-foreground file:text-xs"
                disabled={isBusy}
                id="asset-searchable-text-file"
                onChange={(event) => {
                  setFile(event.target.files?.[0] ?? null);
                  setPendingStorageKey(null);
                  setError(null);
                }}
                type="file"
              />
              <p className="mt-1 text-muted-foreground text-xs">{messages.assets.textUploadHint}</p>
            </div>
          )}

          {error ? (
            <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-destructive text-sm">
              {error}
            </div>
          ) : null}
          {isBusy ? (
            <p aria-live="polite" className="text-muted-foreground text-sm">
              {phase === "requesting"
                ? messages.assets.textUploadPreparing
                : phase === "uploading"
                  ? messages.assets.textUploading
                  : phase === "binding"
                    ? messages.assets.textUploadBinding
                    : messages.assets.textSaving}
            </p>
          ) : null}

          <DialogFooter>
            <button
              className="rounded-md border bg-background px-3 py-1.5 font-medium text-sm hover:bg-muted"
              disabled={isBusy}
              onClick={() => setOpen(false)}
              type="button"
            >
              {messages.common.cancel}
            </button>
            <button
              className="inline-flex items-center gap-1.5 rounded-md bg-foreground px-3 py-1.5 font-medium text-background text-sm hover:bg-foreground/85 disabled:cursor-not-allowed disabled:opacity-50"
              disabled={submitDisabled}
              onClick={requestWrite}
              type="button"
            >
              <Upload className="size-4" />
              {isBusy ? messages.common.working : actionLabel}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmActionDialog
        body={messages.assets.textReplaceConfirmBody}
        confirmLabel={messages.assets.textReplaceConfirm}
        destructive={false}
        onCancel={() => {
          setConfirmReplace(false);
          setOpen(true);
        }}
        onConfirm={() => {
          setConfirmReplace(false);
          void executeWrite();
        }}
        open={confirmReplace}
        pending={isBusy}
        title={messages.assets.textReplaceConfirmTitle}
      />
      <ConfirmActionDialog
        body={messages.assets.textMarkNoneConfirmBody}
        confirmLabel={messages.assets.textMarkNoneConfirm}
        destructive={false}
        onCancel={() => setConfirmNone(false)}
        onConfirm={() => void markNone()}
        open={confirmNone}
        pending={isBusy}
        title={messages.assets.textMarkNoneConfirmTitle}
      />
    </div>
  );
}

// Mirrors the detail pane rendered once `detailQuery` resolves — a "Back" row,
// a large preview area, and a title/chips card — so opening an asset shimmers
// into shape instead of showing plain text in an otherwise-empty pane.
function AssetDetailSkeleton() {
  return (
    <div className="w-full p-4 md:p-6" aria-hidden>
      <Skeleton className="mb-3 h-4 w-20" />
      <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_340px] xl:grid-cols-[minmax(0,1fr)_380px]">
        <Skeleton className="min-h-[240px] w-full rounded-xl" />
        <div className="flex flex-col gap-4">
          <div className="rounded-xl border bg-background p-4">
            <Skeleton className="h-5 w-3/4" />
            <div className="mt-2 flex flex-wrap gap-1.5">
              <Skeleton className="h-5 w-16 rounded-full" />
              <Skeleton className="h-5 w-20 rounded-full" />
              <Skeleton className="h-5 w-12 rounded-full" />
            </div>
          </div>
          <Skeleton className="h-24 w-full rounded-xl" />
        </div>
      </div>
    </div>
  );
}

export function AssetDetailView({
  orpc,
  assetId,
  onBack,
  onOpenNode,
}: {
  orpc: BusabaseQueryUtils;
  assetId: string;
  onBack: () => void;
  onOpenNode: (nodeType: string, nodeSlug: string) => void;
}) {
  const messages = useCoreI18n();
  const detailQuery = useQuery(orpc.assets.get.queryOptions({ input: { assetId } }));
  const queryClient = useQueryClient();
  const [textRevision, setTextRevision] = useState(0);
  const deleteMutation = useMutation({
    ...orpc.assets.delete.mutationOptions(),
    onSuccess: () => {
      toast.success(messages.assets.deleted);
      queryClient.invalidateQueries({ queryKey: orpc.assets.list.queryOptions({}).queryKey });
      onBack();
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : messages.assets.deleteFailed);
    },
  });
  const detail = detailQuery.data ?? null;

  const refreshAssetText = async () => {
    await Promise.all([
      queryClient.invalidateQueries({
        queryKey: orpc.assets.get.queryOptions({ input: { assetId } }).queryKey,
      }),
      queryClient.invalidateQueries({ queryKey: orpc.assets.list.queryOptions({}).queryKey }),
      queryClient.invalidateQueries({ queryKey: orpc.assets.readTextLines.key() }),
    ]);
    setTextRevision((current) => current + 1);
  };

  if (!detail) {
    return detailQuery.isLoading ? (
      <AssetDetailSkeleton />
    ) : (
      <EmptyState body={messages.assets.notFoundBody} title={messages.assets.notFoundTitle} />
    );
  }

  const { asset, usages } = detail;
  const isImage = asset.mimeType.startsWith("image/");
  const metaChips = [
    asset.mimeType,
    formatAssetSize(asset.size),
    fmt(messages.assets.uses, { count: usages.length, plural: usages.length === 1 ? "" : "s" }),
  ];

  return (
    <div className="w-full p-4 md:p-6">
      <button
        className="mb-3 inline-flex items-center gap-1 text-muted-foreground text-sm hover:text-foreground"
        onClick={onBack}
        type="button"
      >
        <ArrowLeft className="size-4" /> {messages.assets.title}
      </button>

      <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_340px] xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="grid min-h-[240px] place-items-center overflow-hidden rounded-xl border bg-muted">
          {isImage ? (
            <img alt={asset.name} className="max-h-[60vh] w-full object-contain" src={asset.url} />
          ) : (
            <a
              className="flex flex-col items-center gap-2 p-8 text-muted-foreground text-sm hover:text-foreground"
              href={asset.url}
              rel="noreferrer"
              target="_blank"
            >
              <FileText className="size-12" />
              {messages.assets.openFile}
            </a>
          )}
        </div>

        <div className="flex flex-col gap-4">
          <div className="rounded-xl border bg-background p-4">
            <h1 className="break-words font-semibold text-lg">{asset.name}</h1>
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              {metaChips.map((chip) => (
                <span
                  className="rounded-full border bg-muted px-2 py-0.5 text-muted-foreground text-xs"
                  key={chip}
                >
                  {chip}
                </span>
              ))}
            </div>
            {asset.contentHash ? (
              <p
                className="mt-2 truncate font-mono text-[11px] text-muted-foreground"
                title={asset.contentHash}
              >
                {asset.contentHash}
              </p>
            ) : null}
            <div className="mt-3 border-t pt-3">
              <button
                className="inline-flex items-center gap-1.5 rounded-md border border-destructive/40 px-2.5 py-1 text-destructive text-xs hover:bg-destructive/10 disabled:cursor-not-allowed disabled:opacity-50"
                disabled={usages.length > 0 || deleteMutation.isPending}
                onClick={() => deleteMutation.mutate({ assetId: asset.id })}
                title={
                  usages.length > 0
                    ? messages.assets.deleteBlockedTitle
                    : messages.assets.deleteTitle
                }
                type="button"
              >
                <Trash2 className="size-3.5" />
                {deleteMutation.isPending ? messages.common.deleting : messages.assets.deleteAsset}
              </button>
              {usages.length > 0 ? (
                <p className="mt-1.5 text-muted-foreground text-xs">
                  {fmt(messages.assets.stillUsed, {
                    count: usages.length,
                    plural: usages.length === 1 ? "" : "s",
                  })}
                </p>
              ) : null}
            </div>
          </div>

          <AssetSearchableTextPanel
            assetId={asset.id}
            onPersisted={refreshAssetText}
            orpc={orpc}
            status={asset.textStatus}
          />

          <AssetTextPreviewPanel
            assetId={asset.id}
            key={`${asset.id}:${textRevision}`}
            orpc={orpc}
            textStatus={asset.textStatus}
          />

          <AssetMetadataBlock framed metadata={asset.metadata} />

          <div className="rounded-xl border bg-background p-4">
            <h2 className="mb-2 font-medium text-sm">{messages.assets.whereUsed}</h2>
            {usages.length === 0 ? (
              <p className="text-muted-foreground text-sm">{messages.assets.notReferenced}</p>
            ) : (
              <ul className="flex flex-col gap-1">
                {usages.map((usage) => (
                  <li key={`${usage.nodeId}:${usage.recordId ?? ""}:${usage.fieldSlug ?? ""}`}>
                    <button
                      className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted"
                      onClick={() => onOpenNode(usage.nodeType, usage.nodeSlug)}
                      type="button"
                    >
                      <span className="truncate font-medium">{usage.nodeName}</span>
                      <span className="text-muted-foreground text-xs">{usage.nodeType}</span>
                      {usage.fieldSlug ? (
                        <span className="ml-auto truncate text-muted-foreground text-xs">
                          {usage.fieldSlug}
                        </span>
                      ) : null}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
