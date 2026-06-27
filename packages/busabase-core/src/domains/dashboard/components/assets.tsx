import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, FileText, Film, Image as ImageIcon, Music, Trash2 } from "lucide-react";
import type { ReactNode } from "react";
import { toast } from "sonner";
import type { BusabaseQueryUtils } from "../../../api-client/react-query";
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

export function AssetsHeader({ count }: { count: number }) {
  return (
    <div className="flex items-center gap-2">
      <ImageIcon className="size-5 text-muted-foreground" />
      <h1 className="font-semibold text-xl">Assets</h1>
      {count > 0 ? (
        <span className="rounded-full border bg-muted px-2 py-0.5 text-muted-foreground text-xs">
          {count}
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
  const listQuery = useQuery(orpc.assets.list.queryOptions({}));
  const assets = listQuery.data ?? [];

  if (listQuery.isLoading) {
    return (
      <div className="grid min-h-[320px] place-items-center text-muted-foreground text-sm">
        Loading assets…
      </div>
    );
  }
  if (listQuery.isError) {
    return (
      <div className="mx-auto w-full max-w-6xl p-4 md:p-6">
        <AssetsHeader count={0} />
        <EmptyState
          body={
            listQuery.error instanceof Error ? listQuery.error.message : "Could not load assets."
          }
          title="Failed to load assets"
        />
      </div>
    );
  }
  if (assets.length === 0) {
    return (
      <div className="mx-auto w-full max-w-6xl p-4 md:p-6">
        <AssetsHeader count={0} />
        <EmptyState
          body="Files you upload to records show up here as a deduplicated library."
          title="No assets yet"
          action={emptyGuide}
        />
      </div>
    );
  }
  return (
    <div className="mx-auto w-full max-w-6xl p-4 md:p-6">
      <AssetsHeader count={assets.length} />
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
              </div>
              <div className="flex flex-col gap-0.5 p-2">
                <span className="truncate font-medium text-sm" title={asset.name}>
                  {asset.name}
                </span>
                <span className="text-muted-foreground text-xs">{formatAssetSize(asset.size)}</span>
              </div>
            </button>
          );
        })}
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
  const detailQuery = useQuery(orpc.assets.get.queryOptions({ input: { assetId } }));
  const queryClient = useQueryClient();
  const deleteMutation = useMutation({
    ...orpc.assets.delete.mutationOptions(),
    onSuccess: () => {
      toast.success("Asset deleted");
      queryClient.invalidateQueries({ queryKey: orpc.assets.list.queryOptions({}).queryKey });
      onBack();
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Could not delete asset");
    },
  });
  const detail = detailQuery.data ?? null;

  if (!detail) {
    return detailQuery.isLoading ? (
      <div className="grid min-h-[320px] place-items-center text-muted-foreground text-sm">
        Loading asset…
      </div>
    ) : (
      <EmptyState body="This asset no longer exists." title="Asset not found" />
    );
  }

  const { asset, usages } = detail;
  const isImage = asset.mimeType.startsWith("image/");
  const metaChips = [
    asset.mimeType,
    formatAssetSize(asset.size),
    `${usages.length} use${usages.length === 1 ? "" : "s"}`,
  ];

  return (
    <div className="mx-auto w-full max-w-5xl p-4 md:p-6">
      <button
        className="mb-3 inline-flex items-center gap-1 text-muted-foreground text-sm hover:text-foreground"
        onClick={onBack}
        type="button"
      >
        <ArrowLeft className="size-4" /> Assets
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
              Open file
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
                    ? "Remove every reference before deleting this asset"
                    : "Delete this asset and its stored file"
                }
                type="button"
              >
                <Trash2 className="size-3.5" />
                {deleteMutation.isPending ? "Deleting…" : "Delete asset"}
              </button>
              {usages.length > 0 ? (
                <p className="mt-1.5 text-muted-foreground text-xs">
                  Still used in {usages.length} place{usages.length === 1 ? "" : "s"}.
                </p>
              ) : null}
            </div>
          </div>

          <div className="rounded-xl border bg-background p-4">
            <h2 className="mb-2 font-medium text-sm">Where used</h2>
            {usages.length === 0 ? (
              <p className="text-muted-foreground text-sm">Not referenced by any record yet.</p>
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
