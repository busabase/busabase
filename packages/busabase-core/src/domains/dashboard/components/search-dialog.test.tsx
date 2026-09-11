import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { BusabaseQueryUtils } from "busabase-contract/api-client/react-query";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Router } from "wouter";
import { CoreI18nProvider } from "../../../i18n";
import { createKnownNodeCache } from "../helpers/known-node-cache";
import { DashboardVisitorProvider } from "../visitor-context";
import { SearchDialog } from "./search-dialog";

Object.assign(globalThis, { React });

/**
 * Minimal stand-in for the oRPC query utils. Every procedure the dialog touches
 * returns an inert, never-resolving query — the point of these tests is which
 * tabs a visitor is offered, not what any request comes back with.
 */
const inert = (key: string) => ({
  queryOptions: (opts?: { input?: unknown }) => ({
    queryKey: [key, opts?.input],
    queryFn: () => new Promise(() => undefined),
  }),
});
const orpc = {
  search: inert("search"),
  nodes: { list: inert("nodes.list"), searchByName: inert("nodes.searchByName") },
} as unknown as BusabaseQueryUtils;

const useStaticLocation = (): [string, (path: string) => void] => ["/home", () => undefined];

const renderDialog = (visitorKind: "anonymous" | "member") =>
  renderToStaticMarkup(
    <QueryClientProvider client={new QueryClient()}>
      <Router hook={useStaticLocation} searchHook={() => ""}>
        <CoreI18nProvider locale="en">
          <DashboardVisitorProvider visitorKind={visitorKind}>
            <SearchDialog
              nodeCache={createKnownNodeCache(`test:${visitorKind}`)}
              onClose={() => undefined}
              open
              orpc={orpc}
            />
          </DashboardVisitorProvider>
        </CoreI18nProvider>
      </Router>
    </QueryClientProvider>,
  );

/**
 * The filter dropdown replaced the tab strip. Its trigger only shows the ACTIVE
 * option, so the full set is asserted from the menu items the dropdown renders.
 * `DropdownMenuContent` is portalled and closed at rest, so the options are read
 * off the trigger's `aria`-linked content only when open — under
 * `renderToStaticMarkup` neither is present. What IS always in the markup is the
 * trigger label, which is enough for the one thing these tests guard: that an
 * anonymous visitor is never offered the Apps/Skills surfaces.
 */
const triggerLabel = (markup: string) =>
  // The dropdown trigger is the only button carrying aria-haspopup="menu";
  // matching "the first button" instead picks up the overlay's close button.
  markup
    .match(/<button[^>]*aria-haspopup="menu"[^>]*>([\s\S]*?)<\/button>/)?.[1]
    ?.replace(/<[^>]*>/g, "")
    .trim() ?? "";

describe("SearchDialog filter", () => {
  it("opens on the everything filter for a member", () => {
    expect(triggerLabel(renderDialog("member"))).toBe("Everything");
  });

  // The tab strip is gone, so the guard that used to live on it has to live
  // here: `nodes.list` is on busabase-core's anonymous allowlist and filters by
  // node VISIBILITY, not node TYPE, while Skills and AirApps both declare
  // `publicAccess: "no"`. A link visitor must not be offered either surface.
  it("never renders the apps or skills sections for an anonymous visitor", () => {
    const markup = renderDialog("anonymous");

    expect(markup).not.toContain("Apps");
    expect(markup).not.toContain("Skills");
  });

  it("still renders the dialog for an anonymous visitor rather than hiding search", () => {
    expect(renderDialog("anonymous")).toContain("busabase-dashboard-search");
  });
});
