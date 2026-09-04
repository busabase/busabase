import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { NodeVO } from "busabase-contract/types";
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

/** A minimal `NodeVO` — only the fields the sidebar row builder reads. */
const nodeVO = (
  overrides: Partial<NodeVO> & Pick<NodeVO, "id" | "slug" | "name" | "type">,
): NodeVO => ({
  baseId: null,
  children: [],
  createdAt: "2026-01-01T00:00:00.000Z",
  description: "",
  explicitVisibility: null,
  icon: null,
  metadata: {},
  parentId: null,
  position: 0,
  updatedAt: "2026-01-01T00:00:00.000Z",
  ...overrides,
});

const renderShellWithNodes = (nodes: NodeVO[]) =>
  renderToStaticMarkup(
    <QueryClientProvider client={new QueryClient()}>
      <Router hook={useStaticLocation} searchHook={useStaticSearch}>
        <BusabaseDashboardShell
          activeChangeRequestCount={0}
          chrome={{
            hideUserMenu: true,
            onSignOut: () => undefined,
            user: { avatar: "", email: "tester@example.com", name: "Tester" },
          }}
          locale="zh-CN"
          nodes={nodes}
          onCreateClick={() => undefined}
          onSearchClick={() => undefined}
        >
          <span />
        </BusabaseDashboardShell>
      </Router>
    </QueryClientProvider>,
  );

describe("BusabaseDashboardShell shared marker", () => {
  // The point of the marker is that it is readable WITHOUT hovering — an admin
  // scanning the tree can see which nodes are published. Server-rendered markup
  // is exactly the idle (un-hovered) state, so its presence here is the check.
  it("marks a shared node and leaves unshared siblings unmarked", () => {
    const markup = renderShellWithNodes([
      nodeVO({
        id: "nd_root",
        name: "Workspace",
        slug: "workspace",
        type: "folder",
        children: [
          nodeVO({
            id: "nd_public",
            name: "Public Doc",
            parentId: "nd_root",
            shared: true,
            slug: "public-doc",
            type: "doc",
          }),
          nodeVO({
            id: "nd_private",
            name: "Private Doc",
            parentId: "nd_root",
            shared: false,
            slug: "private-doc",
            type: "doc",
          }),
        ],
      }),
    ]);

    expect(markup).toContain("Public Doc");
    expect(markup).toContain("Private Doc");
    // Localized through the same `share` message block as the dialog. Counted
    // by the tooltip attribute rather than the bare string: the marker renders
    // it twice on purpose (hover tooltip + screen-reader text).
    expect(markup.split('title="已公开分享"').length - 1).toBe(1);
  });

  it("renders no marker at all when nothing is shared", () => {
    const markup = renderShellWithNodes([
      nodeVO({ id: "nd_plain", name: "Plain Doc", slug: "plain-doc", type: "doc" }),
    ]);

    expect(markup).toContain("Plain Doc");
    expect(markup).not.toContain("已公开分享");
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
