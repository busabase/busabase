"use client";

import type { NodeVO } from "busabase-contract/types";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "kui/tooltip";
import { SPALink as Link } from "openlib/ui/dashboard";
import { useState } from "react";
import { useSearch } from "wouter";
import { mergeSearchIntoHref } from "../../dashboard/helpers/link-search";
import { getAirAppFallbackGlyph } from "../utils/app-icon";

export interface AppLauncherNode {
  id: string;
  slug: string;
  name: string;
  type: string;
  icon?: NodeVO["icon"];
}

const launcherGridClassName =
  "grid max-w-7xl grid-cols-3 justify-start gap-x-3 gap-y-8 sm:grid-cols-[repeat(auto-fill,minmax(6rem,6rem))] sm:gap-x-4 md:grid-cols-[repeat(auto-fill,minmax(7rem,7rem))] md:gap-x-8 md:gap-y-9";

export function AirAppIcon({ node }: { node: AppLauncherNode | NodeVO }) {
  const imageUrl = node.icon?.type === "attachment" ? node.icon.url : null;
  const [failedImageUrl, setFailedImageUrl] = useState<string | null>(null);
  const fallback = getAirAppFallbackGlyph(node.name);
  const emoji = node.icon?.type === "emoji" ? node.icon.value : fallback.isEmoji && fallback.value;

  return (
    <span
      aria-hidden="true"
      className="flex size-16 shrink-0 items-center justify-center overflow-hidden rounded-2xl border border-border/60 bg-muted text-foreground transition-[transform,translate,scale,background-color,border-color] duration-150 group-hover:border-border group-hover:bg-accent motion-safe:group-hover:-translate-y-0.5 motion-safe:group-hover:scale-[1.03] motion-safe:group-active:translate-y-0 motion-safe:group-active:scale-[0.97] motion-reduce:transition-none md:size-18 xl:size-20"
      data-airapp-icon
    >
      {imageUrl && imageUrl !== failedImageUrl ? (
        <img
          alt=""
          className="size-full object-cover"
          onError={() => setFailedImageUrl(imageUrl)}
          src={imageUrl}
        />
      ) : emoji ? (
        <span className="text-3xl leading-none">{emoji}</span>
      ) : (
        <span className="font-semibold text-xl leading-none">{fallback.value}</span>
      )}
    </span>
  );
}

export function AppLauncherItem({ node }: { node: AppLauncherNode | NodeVO }) {
  const currentSearch = useSearch();
  const href = mergeSearchIntoHref(`/${node.type}/${node.slug}`, currentSearch);

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Link
          aria-label={node.name}
          className="group flex w-full min-w-0 flex-col items-center gap-3 rounded-xl p-1 text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background sm:w-24 md:w-28"
          data-app-launcher-item
          data-node-id={node.id}
          href={href}
        >
          <AirAppIcon node={node} />
          <span
            className="line-clamp-2 min-h-10 w-full text-center font-medium text-sm leading-5 [overflow-wrap:anywhere]"
            dir="auto"
          >
            {node.name}
          </span>
        </Link>
      </TooltipTrigger>
      <TooltipContent className="max-w-xs text-center [overflow-wrap:anywhere]" dir="auto">
        <span className="break-words">{node.name}</span>
      </TooltipContent>
    </Tooltip>
  );
}

export function AppLauncherGrid({ nodes }: { nodes: Array<AppLauncherNode | NodeVO> }) {
  return (
    <TooltipProvider delayDuration={300}>
      <div className={launcherGridClassName} data-app-launcher-grid>
        {nodes.map((node) => (
          <AppLauncherItem key={node.id} node={node} />
        ))}
      </div>
    </TooltipProvider>
  );
}

export function AppLauncherGridSkeleton() {
  return (
    <div aria-hidden="true" className={launcherGridClassName}>
      {Array.from({ length: 9 }).map((_, index) => (
        <div
          className="flex w-full flex-col items-center gap-3 p-1 sm:w-24 md:w-28"
          // biome-ignore lint/suspicious/noArrayIndexKey: fixed-length skeleton placeholder list
          key={index}
        >
          <div className="size-16 animate-pulse rounded-2xl bg-muted motion-reduce:animate-none md:size-18 xl:size-20" />
          <div className="h-4 w-16 animate-pulse rounded bg-muted motion-reduce:animate-none" />
          <div className="h-3 w-10 animate-pulse rounded bg-muted motion-reduce:animate-none" />
        </div>
      ))}
    </div>
  );
}
