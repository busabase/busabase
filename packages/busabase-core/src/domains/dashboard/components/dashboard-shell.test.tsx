import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Router } from "wouter";
import { useCoreI18n } from "../../../i18n";
import { BusabaseDashboardShell } from "./dashboard-shell";
import { BusabaseTopbarBreadcrumb } from "./topbar";

Object.assign(globalThis, { React });

const useStaticLocation = (): [string, (path: string) => void] => ["/", () => undefined];
const useStaticSearch = () => "";

function ShareMessageProbe() {
  const messages = useCoreI18n();
  return <span>{messages.share.shareToWeb}</span>;
}

describe("BusabaseDashboardShell i18n", () => {
  it("provides its locale to sidebar-owned dialogs", () => {
    const queryClient = new QueryClient();
    const markup = renderToStaticMarkup(
      <QueryClientProvider client={queryClient}>
        <Router hook={useStaticLocation} searchHook={useStaticSearch}>
          <BusabaseDashboardShell
            activeChangeRequestCount={0}
            chrome={{
              hideUserMenu: true,
              onSignOut: () => undefined,
              user: { avatar: "", email: "tester@example.com", name: "Tester" },
            }}
            locale="zh-CN"
            nodes={[]}
            onCreateClick={() => undefined}
            onSearchClick={() => undefined}
          >
            <ShareMessageProbe />
          </BusabaseDashboardShell>
        </Router>
      </QueryClientProvider>,
    );

    expect(markup).toContain("分享到网页");
    expect(markup).not.toContain("Share to web");
  });
});

describe("BusabaseTopbarBreadcrumb", () => {
  it("links ancestors and marks the current node as the current page", () => {
    const markup = renderToStaticMarkup(
      <Router hook={useStaticLocation} searchHook={useStaticSearch}>
        <BusabaseTopbarBreadcrumb
          items={[{ href: "/home", label: "Workspace" }, { label: "Quarterly Report" }]}
        />
      </Router>,
    );

    expect(markup).toContain('href="/home"');
    expect(markup).toContain(">Workspace</a>");
    expect(markup).toContain('aria-current="page"');
    expect(markup).toContain(">Quarterly Report</span>");
  });
});
