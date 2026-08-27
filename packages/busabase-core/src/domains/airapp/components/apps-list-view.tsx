"use client";

import { useQuery } from "@tanstack/react-query";
import type { BusabaseQueryUtils } from "busabase-contract/api-client/react-query";
import { LayoutGrid } from "lucide-react";
import { useCoreI18n } from "../../../i18n";
import { AppGalleryGrid } from "./app-gallery-card";

/**
 * Gallery grid of every AirApp in the current space — the "App Library" reached
 * from the Space Selector menu, analogous to `AgentsListView` for connected
 * agents. Unlike Agents, there is no "Add app" affordance here: creating an
 * AirApp goes through the regular "New" node-creation flow, not this view.
 */
export function AppsListView({ orpc }: { orpc: BusabaseQueryUtils }) {
  const messages = useCoreI18n();
  const nodesQuery = useQuery(orpc.nodes.list.queryOptions({ input: { types: ["airapp"] } }));
  const nodes = nodesQuery.data ?? [];

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex items-center justify-between border-b px-6 py-4">
        <div>
          <h1 className="font-medium text-lg">{messages.nav.apps}</h1>
          <p className="text-muted-foreground text-sm">{messages.airapp.librarySubtitle}</p>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto p-6">
        {nodesQuery.isPending ? (
          <div
            className="grid gap-3"
            style={{ gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))" }}
          >
            {Array.from({ length: 6 }).map((_, index) => (
              <div
                // biome-ignore lint/suspicious/noArrayIndexKey: fixed-length skeleton placeholder list
                key={index}
                className="aspect-[3/2] animate-pulse rounded-lg border border-border/60 bg-muted/40"
              />
            ))}
          </div>
        ) : nodes.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
            <LayoutGrid className="size-8 text-muted-foreground" />
            <div>
              <h2 className="font-medium">{messages.airapp.libraryEmptyTitle}</h2>
              <p className="mt-1 text-muted-foreground text-sm">
                {messages.airapp.libraryEmptyBody}
              </p>
            </div>
          </div>
        ) : (
          <AppGalleryGrid nodes={nodes} />
        )}
      </div>
    </div>
  );
}
