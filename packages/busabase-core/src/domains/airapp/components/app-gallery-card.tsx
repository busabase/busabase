"use client";

import type { NodeVO } from "busabase-contract/types";
import { SPALink as Link } from "openlib/ui/dashboard";
import { useSearch } from "wouter";
import { mergeSearchIntoHref } from "../../dashboard/helpers/link-search";
import { resolveNodeIcon } from "../../dashboard/helpers/node-icons";

/**
 * Card min-width for the AirApp gallery grid — same `auto-fill` responsive
 * approach as `BusaBaseGallery`'s `CARD_MIN_WIDTH`, but AirApps only ever
 * need one size (no per-view configuration like a Base gallery), so this is a
 * plain constant rather than a lookup table.
 */
const APP_CARD_MIN_WIDTH = "120px";

export interface AppGalleryNode {
  id: string;
  slug: string;
  name: string;
  type: string;
  /** Custom avatar (emoji or cropped/uploaded image) — omitted callers fall
   *  back to the node-type icon, same as before this field existed. */
  icon?: NodeVO["icon"];
}

/**
 * One AirApp tile: a large icon "cover" over the app name, in the spirit of
 * `BusaBaseGallery`'s `GalleryCard` cover treatment — but AirApp nodes have no
 * attachment-backed cover image, so the cover area always falls back to the
 * node-type icon rather than a photo/initial.
 */
export function AppGalleryCard({ node }: { node: AppGalleryNode | NodeVO }) {
  const currentSearch = useSearch();
  const resolvedIcon = resolveNodeIcon(node);
  const href = mergeSearchIntoHref(`/${node.type}/${node.slug}`, currentSearch);

  return (
    <Link
      className="group flex flex-col overflow-hidden rounded-lg border border-border/60 bg-card transition-shadow hover:shadow-md"
      data-node-id={node.id}
      href={href}
    >
      <div className="flex aspect-[3/2] w-full items-center justify-center overflow-hidden bg-muted/50">
        {resolvedIcon.kind === "image" ? (
          <img alt="" className="size-full object-cover" src={resolvedIcon.url} />
        ) : resolvedIcon.kind === "emoji" ? (
          <span aria-hidden="true" className="text-3xl leading-none">
            {resolvedIcon.value}
          </span>
        ) : (
          <resolvedIcon.Icon
            aria-hidden="true"
            className="size-7 text-muted-foreground transition-colors group-hover:text-foreground"
          />
        )}
      </div>
      <div className="min-w-0 px-3 py-2.5">
        {/* Two lines, not `truncate`: at this card width a single line collapses
            sibling AirApps to the same prefix (three "Vite + React …" tiles read
            identically). `min-h` reserves both lines so one- and two-line names
            still produce tiles of equal height. */}
        <span
          className="line-clamp-2 min-h-10 font-medium text-foreground text-sm"
          title={node.name}
        >
          {node.name}
        </span>
      </div>
    </Link>
  );
}

/**
 * Responsive icon-grid wall for AirApp nodes — shared by the App Library
 * (`AppsListView`) and Home's recently used AirApps section, so both surfaces
 * present AirApps the same way instead of drifting into two markups.
 */
export function AppGalleryGrid({ nodes }: { nodes: Array<AppGalleryNode | NodeVO> }) {
  return (
    <div
      className="grid gap-3"
      style={{ gridTemplateColumns: `repeat(auto-fill, minmax(${APP_CARD_MIN_WIDTH}, 1fr))` }}
    >
      {nodes.map((node) => (
        <AppGalleryCard key={node.id} node={node} />
      ))}
    </div>
  );
}
