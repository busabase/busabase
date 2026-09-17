// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { BusabaseQueryUtils } from "busabase-contract/api-client/react-query";
import type { NodeDetailVO } from "busabase-contract/contract/node-detail-schemas";
import { afterEach, describe, expect, it } from "vitest";
import { CoreI18nProvider, coreMessagesByLocale, fmt } from "../../../i18n";
import { isPinnableNode } from "../../dashboard/components/side-panel-sources";
import { TopbarNodeActionsSlot } from "../../dashboard/components/topbar";
import { DashboardVisitorProvider } from "../../dashboard/visitor-context";
import { HtmlDetailView } from "./html-detail-view";
import "./register";

const detail: Extract<NodeDetailVO, { type: "html" }> = {
  type: "html",
  node: {
    id: "html-1",
    parentId: null,
    type: "html",
    slug: "preview-example",
    name: "示例页面",
    description: "",
    metadata: {},
    explicitVisibility: null,
    position: 0,
    createdAt: "2026-09-14T00:00:00.000Z",
    updatedAt: "2026-09-14T00:00:00.000Z",
    baseId: null,
    children: [],
  },
  document: { version: 1, source: "<main>你好</main>" },
};

// Member previews render the real NodeAgentPromptsButton, whose closed menu
// prepares (but does not fetch) the connected-agent query.
const agents = {
  connections: {
    list: {
      queryOptions: () => ({
        queryKey: ["agents", "connections"],
        queryFn: async () => [],
      }),
    },
  },
};

const orpc = {
  agents,
  nodes: {
    get: {
      queryOptions: () => ({ queryKey: ["nodes", "html-1"], queryFn: async () => detail }),
    },
    updateContent: { mutationOptions: () => ({ mutationFn: async () => detail }) },
  },
} as unknown as BusabaseQueryUtils;

afterEach(() => {
  cleanup();
  window.history.replaceState(null, "", "/");
});

describe("HtmlDetailView preview", () => {
  it.each(["zh-CN", "ja"] as const)(
    "opens %s on the localized preview with one iframe",
    async (locale) => {
      const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
      const messages = coreMessagesByLocale[locale].richNodes;

      const { container } = render(
        <QueryClientProvider client={client}>
          <CoreI18nProvider locale={locale}>
            <DashboardVisitorProvider visitorKind="anonymous">
              <HtmlDetailView orpc={orpc} slug="html-1" />
            </DashboardVisitorProvider>
          </CoreI18nProvider>
        </QueryClientProvider>,
      );

      expect(
        (await screen.findByRole("tab", { name: messages.preview })).getAttribute("data-state"),
      ).toBe("active");
      expect(screen.getByRole("tab", { name: messages.source }).getAttribute("data-state")).toBe(
        "inactive",
      );
      const frame = screen.getByTitle(fmt(messages.previewFrame, { name: detail.node.name }));
      expect(frame.getAttribute("srcdoc")).toBe("<main>你好</main>");
      expect(container.querySelectorAll("iframe")).toHaveLength(1);
      expect(screen.queryByRole("textbox", { name: messages.htmlSource })).toBeNull();
    },
  );

  it("shows the new node's document and localized preview after switching from an edited node", async () => {
    const locale = "ja";
    const messages = coreMessagesByLocale[locale].richNodes;
    const secondDetail: typeof detail = {
      ...detail,
      node: { ...detail.node, id: "html-2", slug: "second-preview", name: "次のページ" },
      document: { version: 1, source: "<main>次のページ</main>" },
    };
    const switchingOrpc = {
      agents,
      nodes: {
        get: {
          queryOptions: ({ input }: { input: { nodeId: string } }) => ({
            queryKey: ["nodes", input.nodeId],
            queryFn: async () => (input.nodeId === detail.node.id ? detail : secondDetail),
          }),
        },
        updateContent: { mutationOptions: () => ({ mutationFn: async () => detail }) },
      },
    } as unknown as BusabaseQueryUtils;
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const view = (slug: string) => (
      <QueryClientProvider client={client}>
        <CoreI18nProvider locale={locale}>
          <DashboardVisitorProvider visitorKind="member">
            <HtmlDetailView orpc={switchingOrpc} slug={slug} />
          </DashboardVisitorProvider>
        </CoreI18nProvider>
      </QueryClientProvider>
    );
    const { container, rerender } = render(view(detail.node.id));

    await screen.findByTitle(fmt(messages.previewFrame, { name: detail.node.name }));
    fireEvent.mouseDown(screen.getByRole("tab", { name: messages.source }));
    fireEvent.change(screen.getByRole("textbox", { name: messages.htmlSource }), {
      target: { value: "<main>未保存の変更</main>" },
    });
    fireEvent.mouseDown(screen.getByRole("tab", { name: messages.preview }));
    expect(
      screen
        .getByTitle(fmt(messages.previewFrame, { name: detail.node.name }))
        .getAttribute("srcdoc"),
    ).toBe("<main>未保存の変更</main>");

    rerender(view(secondDetail.node.id));

    const frame = await screen.findByTitle(
      fmt(messages.previewFrame, { name: secondDetail.node.name }),
    );
    expect(frame.getAttribute("srcdoc")).toBe(secondDetail.document.source);
    expect(container.querySelectorAll("iframe")).toHaveLength(1);
    expect(screen.getByRole("tab", { name: messages.preview }).getAttribute("data-state")).toBe(
      "active",
    );
    expect(screen.queryByRole("textbox", { name: messages.htmlSource })).toBeNull();
  });

  it("keeps one iframe while fullscreen forces Preview and exposes the HTML topbar actions", async () => {
    window.history.replaceState(null, "", "/html/preview-example?demo=node-types");
    const messages = coreMessagesByLocale.en;
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { container } = render(
      <QueryClientProvider client={client}>
        <CoreI18nProvider locale="en">
          <DashboardVisitorProvider visitorKind="member">
            <HtmlDetailView orpc={orpc} slug="html-1" />
            <TopbarNodeActionsSlot />
          </DashboardVisitorProvider>
        </CoreI18nProvider>
      </QueryClientProvider>,
    );

    const frame = await screen.findByTitle(
      fmt(messages.richNodes.previewFrame, { name: detail.node.name }),
    );
    frame.setAttribute("data-test-identity", "original-html-frame");

    fireEvent.click(await screen.findByRole("button", { name: messages.airapp.enterFullscreen }));

    await waitFor(() => {
      expect(
        screen.getByRole("tab", { name: messages.richNodes.preview }).getAttribute("data-state"),
      ).toBe("active");
    });
    expect(container.querySelectorAll("iframe")).toHaveLength(1);
    expect(container.querySelector("iframe")?.getAttribute("data-test-identity")).toBe(
      "original-html-frame",
    );
    expect(container.querySelector('[data-html-fullscreen="true"]')).not.toBeNull();
    expect(window.location.search).toContain("fullscreen=1");
    expect(window.location.search).toContain("demo=node-types");
    expect(screen.getByRole("button", { name: messages.nodeDetail.pinToSidePanel })).not.toBeNull();
    expect(screen.getByRole("button", { name: messages.richNodes.save })).not.toBeNull();

    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() =>
      expect(container.querySelector('[data-html-fullscreen="true"]')).toBeNull(),
    );
    expect(window.location.search).not.toContain("fullscreen=1");

    fireEvent.mouseDown(screen.getByRole("tab", { name: messages.richNodes.source }));
    expect(screen.getByRole("textbox", { name: messages.richNodes.htmlSource })).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: messages.airapp.enterFullscreen }));
    await waitFor(() => {
      expect(
        screen.getByRole("tab", { name: messages.richNodes.preview }).getAttribute("data-state"),
      ).toBe("active");
    });
    expect(container.querySelectorAll("iframe")).toHaveLength(1);
  });

  it("registers HTML as a pinnable side-panel node", () => {
    expect(isPinnableNode("html")).toBe(true);
  });

  it("keeps source read-only and write actions hidden for anonymous visitors", async () => {
    const messages = coreMessagesByLocale.en;
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <CoreI18nProvider locale="en">
          <DashboardVisitorProvider visitorKind="anonymous">
            <HtmlDetailView orpc={orpc} slug="html-1" />
            <TopbarNodeActionsSlot />
          </DashboardVisitorProvider>
        </CoreI18nProvider>
      </QueryClientProvider>,
    );

    await screen.findByRole("tab", { name: messages.richNodes.preview });
    fireEvent.mouseDown(screen.getByRole("tab", { name: messages.richNodes.source }));
    expect(
      screen.getByRole("textbox", { name: messages.richNodes.htmlSource }).hasAttribute("readonly"),
    ).toBe(true);
    expect(screen.queryByRole("button", { name: messages.richNodes.save })).toBeNull();
    expect(screen.queryByRole("button", { name: messages.nodeDetail.pinToSidePanel })).toBeNull();
  });
});
