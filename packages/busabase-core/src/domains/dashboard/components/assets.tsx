import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { BusabaseQueryUtils } from "busabase-contract/api-client/react-query";
import { ArrowLeft, FileText, Film, Image as ImageIcon, Music, Trash2 } from "lucide-react";
import { type ReactNode, useMemo, useState } from "react";
import { toast } from "sonner";
import { fmt, useCoreI18n } from "../../../i18n";
import { EmptyState } from "./primitives";

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
  return assetId ? (
    <AssetDetailView assetId={assetId} onBack={onBack} onOpenNode={onOpenNode} orpc={orpc} />
  ) : (
    <AssetLibraryView emptyGuide={emptyGuide} onOpenAsset={onOpenAsset} orpc={orpc} />
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
    return (
      <div className="grid min-h-[320px] place-items-center text-muted-foreground text-sm">
        {messages.assets.loading}
      </div>
    );
  }
  if (listQuery.isError) {
    return (
      <div className="mx-auto w-full max-w-6xl p-4 md:p-6">
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
      <div className="mx-auto w-full max-w-6xl p-4 md:p-6">
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
    <div className="mx-auto w-full max-w-6xl p-4 md:p-6">
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
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
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

  if (!detail) {
    return detailQuery.isLoading ? (
      <div className="grid min-h-[320px] place-items-center text-muted-foreground text-sm">
        {messages.assets.loadingOne}
      </div>
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
    <div className="mx-auto w-full max-w-5xl p-4 md:p-6">
      <button
        className="mb-3 inline-flex items-center gap-1 text-muted-foreground text-sm hover:text-foreground"
        onClick={onBack}
        type="button"
      >
        <ArrowLeft className="size-4" /> {messages.assets.title}
      </button>

      <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_320px]">
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
            <div className="mt-2 flex flex-wrap gap-1.5">
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
