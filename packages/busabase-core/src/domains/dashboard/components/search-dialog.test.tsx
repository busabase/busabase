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

const tabLabels = (markup: string) =>
  [...markup.matchAll(/role="tab"[^>]*>([\s\S]*?)<\/button>/g)].map((match) =>
    (match[1] ?? "").replace(/<[^>]*>/g, "").trim(),
  );

describe("SearchDialog tabs", () => {
  it("offers a member every tab, Skills and Apps included", () => {
    expect(tabLabels(renderDialog("member"))).toEqual([
      "Recent",
      "Apps",
      "Skills",
      "Records",
      "Files",
      "Change Requests",
      "Content",
    ]);
  });

  it("hides Skills and Apps from an anonymous public-link visitor", () => {
    const labels = tabLabels(renderDialog("anonymous"));

    expect(labels).not.toContain("Skills");
    expect(labels).not.toContain("Apps");
    // The rest of the dialog is untouched — this narrows the tab strip, it does
    // not turn search off for a link visitor.
    expect(labels).toEqual(["Recent", "Records", "Files", "Change Requests", "Content"]);
  });
});
