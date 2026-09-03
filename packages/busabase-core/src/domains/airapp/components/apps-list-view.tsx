"use client";

import { useQuery } from "@tanstack/react-query";
import type { BusabaseQueryUtils } from "busabase-contract/api-client/react-query";
import { Button } from "kui/button";
import { CircleAlert, LayoutGrid } from "lucide-react";
import { useCoreI18n } from "../../../i18n";
import { AppLauncherGrid, AppLauncherGridSkeleton } from "./app-launcher";

/**
 * Launcher grid of every AirApp in the current space — the "App Launcher" reached
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
      {/* Kept deliberately, matching `AgentsListView`: every list view reached
          from the Space Selector opens with an in-body title + one-line
          description over a `border-b`, so sibling views start their content at
          the same height. The Topbar label is navigation chrome, not this
          page's own heading. */}
      <header className="flex items-center justify-between border-b px-6 py-4">
        <div>
          <h1 className="font-medium text-lg">{messages.nav.apps}</h1>
          <p className="text-muted-foreground text-sm">{messages.airapp.librarySubtitle}</p>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-6">
        {nodesQuery.isPending ? (
          <AppLauncherGridSkeleton />
        ) : nodesQuery.isError ? (
          <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
            <CircleAlert className="size-8 text-muted-foreground" />
            <div className="max-w-sm">
              <h2 className="font-medium">{messages.airapp.libraryErrorTitle}</h2>
              <p className="mt-1 text-muted-foreground text-sm">
                {messages.airapp.libraryErrorBody}
              </p>
            </div>
            <Button onClick={() => void nodesQuery.refetch()} size="sm" variant="outline">
              {messages.airapp.libraryRetry}
            </Button>
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
          <AppLauncherGrid nodes={nodes} />
        )}
      </div>
    </div>
  );
}
