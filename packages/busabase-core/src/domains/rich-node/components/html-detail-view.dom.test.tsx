// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { BusabaseQueryUtils } from "busabase-contract/api-client/react-query";
import type { NodeDetailVO } from "busabase-contract/contract/node-detail-schemas";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CoreI18nProvider, fmt } from "../../../i18n";
import { coreMessagesByLocale } from "../../../i18n/catalog";
import { isPinnableNode } from "../../dashboard/components/side-panel-sources";
import { TopbarNodeActionsSlot } from "../../dashboard/components/topbar";
import { DashboardVisitorProvider } from "../../dashboard/visitor-context";
import { HtmlDetailView, HtmlPreviewSurface } from "./html-detail-view";
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
    // The node actions menu prepares (but, closed, never fetches) the
    // subscription query and mutation.
    subscription: {
      get: {
        queryOptions: () => ({ queryKey: ["nodes", "subscription"], queryFn: async () => null }),
      },
      set: { mutationOptions: () => ({ mutationFn: async () => null }) },
    },
  },
} as unknown as BusabaseQueryUtils;

function renderMember(
  submit?: (source: string) => Promise<{ id: string; status: "merged" | "in_review" }>,
) {
  let published = detail;
  const update = vi.fn(async (input: { content: { document: { source: string } } }) => {
    const source = input.content.document.source;
    const result = submit ? await submit(source) : { id: "html-save", status: "merged" as const };
    if (result.status === "merged") {
      published = { ...detail, document: { version: 1, source } };
    }
    return result;
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const memberOrpc = {
    agents,
    nodes: {
      ...orpc.nodes,
      get: {
        key: () => ["nodes", "get"],
        queryOptions: () => ({
          queryKey: ["nodes", "get", detail.node.id],
          queryFn: async () => published,
        }),
      },
      list: {
        queryOptions: () => ({ queryKey: ["nodes", "list"], queryFn: async () => [] }),
      },
      updateContent: { mutationOptions: () => ({ mutationFn: update }) },
    },
    changeRequests: {
      get: {
        queryOptions: () => ({
          queryKey: ["changeRequests", "html-save"],
          queryFn: async () => ({ id: "html-save", status: "in_review" }),
        }),
      },
    },
  } as unknown as BusabaseQueryUtils;
  const view = render(
    <QueryClientProvider client={client}>
      <DashboardVisitorProvider visitorKind="member">
        <HtmlDetailView orpc={memberOrpc} slug={detail.node.id} />
        <TopbarNodeActionsSlot />
      </DashboardVisitorProvider>
    </QueryClientProvider>,
  );
  return { ...view, update };
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  Reflect.deleteProperty(navigator, "userActivation");
  window.history.replaceState(null, "", "/");
});

describe("HtmlDetailView preview", () => {
  it("delegates native video fullscreen while keeping the preview sandbox opaque", async () => {
    render(
      <HtmlPreviewSurface
        fullscreenState={{ fullscreen: false, setFullscreen: vi.fn() }}
        node={detail.node}
        source='<video controls src="https://example.test/report.mp4"></video>'
      />,
    );
    const frame = await screen.findByTitle(
      fmt(coreMessagesByLocale.en.richNodes.previewFrame, { name: detail.node.name }),
    );
    await waitFor(() =>
      expect(frame.getAttribute("srcdoc")).toContain(
        '<video controls src="https://example.test/report.mp4"></video>',
      ),
    );
    expect(frame.hasAttribute("allowfullscreen")).toBe(true);
    expect(frame.getAttribute("sandbox")).toBe(
      "allow-forms allow-modals allow-popups allow-popups-to-escape-sandbox allow-scripts",
    );
  });

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

      const frame = await screen.findByTitle(
        fmt(messages.previewFrame, { name: detail.node.name }),
      );
      expect(screen.queryByRole("tab")).toBeNull();
      expect(frame.getAttribute("srcdoc")).toContain("<main>你好</main>");
      expect(frame.getAttribute("sandbox")).toContain("allow-popups-to-escape-sandbox");
      expect(frame.getAttribute("sandbox")).not.toContain("allow-same-origin");
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
        // The node actions menu prepares (but, closed, never fetches) the
        // subscription query and mutation.
        subscription: {
          get: {
            queryOptions: () => ({
              queryKey: ["nodes", "subscription"],
              queryFn: async () => null,
            }),
          },
          set: { mutationOptions: () => ({ mutationFn: async () => null }) },
        },
      },
    } as unknown as BusabaseQueryUtils;
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const view = (slug: string) => (
      <QueryClientProvider client={client}>
        <CoreI18nProvider locale={locale}>
          <DashboardVisitorProvider visitorKind="member">
            <HtmlDetailView orpc={switchingOrpc} slug={slug} />
            <TopbarNodeActionsSlot />
          </DashboardVisitorProvider>
        </CoreI18nProvider>
      </QueryClientProvider>
    );
    const { container, rerender } = render(view(detail.node.id));

    await screen.findByTitle(fmt(messages.previewFrame, { name: detail.node.name }));
    fireEvent.click(screen.getByRole("button", { name: coreMessagesByLocale[locale].common.edit }));
    fireEvent.change(screen.getByRole("textbox", { name: messages.htmlSource }), {
      target: { value: "<main>未保存の変更</main>" },
    });
    fireEvent.mouseDown(screen.getByRole("tab", { name: messages.preview }));
    expect(
      screen
        .getByTitle(fmt(messages.previewFrame, { name: detail.node.name }))
        .getAttribute("srcdoc"),
    ).toContain("<main>未保存の変更</main>");

    rerender(view(secondDetail.node.id));

    const frame = await screen.findByTitle(
      fmt(messages.previewFrame, { name: secondDetail.node.name }),
    );
    expect(frame.getAttribute("srcdoc")).toContain(secondDetail.document.source);
    expect(container.querySelectorAll("iframe")).toHaveLength(1);
    expect(screen.queryByRole("tab")).toBeNull();
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

    await waitFor(() =>
      expect(container.querySelector('[data-html-fullscreen="true"]')).not.toBeNull(),
    );
    expect(container.querySelectorAll("iframe")).toHaveLength(1);
    expect(container.querySelector("iframe")?.getAttribute("data-test-identity")).toBe(
      "original-html-frame",
    );
    expect(container.querySelector('[data-html-fullscreen="true"]')).not.toBeNull();
    expect(window.location.search).toContain("fullscreen=1");
    expect(window.location.search).toContain("demo=node-types");
    expect(screen.getByRole("button", { name: messages.nodeDetail.pinToSidePanel })).not.toBeNull();
    expect(screen.queryByRole("button", { name: messages.richNodes.save })).toBeNull();
    expect(screen.queryByRole("tab")).toBeNull();

    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() =>
      expect(container.querySelector('[data-html-fullscreen="true"]')).toBeNull(),
    );
    expect(window.location.search).not.toContain("fullscreen=1");

    fireEvent.click(screen.getByRole("button", { name: messages.common.edit }));
    expect(screen.getByRole("textbox", { name: messages.richNodes.htmlSource })).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: messages.airapp.enterFullscreen }));
    await waitFor(() => {
      expect(
        screen.getByRole("tab", { name: messages.richNodes.preview }).getAttribute("data-state"),
      ).toBe("active");
    });
    expect(container.querySelectorAll("iframe")).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: messages.airapp.exitFullscreen }));
    await screen.findByRole("textbox", { name: messages.richNodes.htmlSource });
    expect(
      screen.getByRole("tab", { name: messages.richNodes.source }).getAttribute("data-state"),
    ).toBe("active");
  });

  it("registers HTML as a pinnable side-panel node", () => {
    expect(isPinnableNode("html")).toBe(true);
  });

  it("accepts only the active opaque preview's bridge during a user gesture", async () => {
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    const activation = { isActive: false };
    Object.defineProperty(navigator, "userActivation", { configurable: true, value: activation });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { unmount } = render(
      <QueryClientProvider client={client}>
        <DashboardVisitorProvider visitorKind="anonymous">
          <HtmlDetailView orpc={orpc} slug="html-1" />
        </DashboardVisitorProvider>
      </QueryClientProvider>,
    );
    const frame = await screen.findByTitle(
      fmt(coreMessagesByLocale.en.richNodes.previewFrame, { name: detail.node.name }),
    );
    const sessionId = /"sessionId":"([^"]+)"/.exec(frame.getAttribute("srcdoc") ?? "")?.[1];
    expect(sessionId).toBeTruthy();
    const message = {
      type: "busabase:html-preview:navigate",
      sessionId,
      href: "https://example.com/guide",
    };
    const send = (overrides: MessageEventInit = {}) =>
      window.dispatchEvent(
        new MessageEvent("message", {
          source: (frame as HTMLIFrameElement).contentWindow,
          origin: "null",
          data: message,
          ...overrides,
        }),
      );
    send();
    expect(open).not.toHaveBeenCalled();
    activation.isActive = true;
    send({ source: window });
    send({ origin: window.location.origin });
    send({ data: { ...message, sessionId: "expired" } });
    send({ data: { ...message, href: "javascript:alert(1)" } });
    expect(open).not.toHaveBeenCalled();
    send();
    expect(open).toHaveBeenCalledExactlyOnceWith(
      "https://example.com/guide",
      "_blank",
      "noopener,noreferrer",
    );
    unmount();
    send();
    expect(open).toHaveBeenCalledTimes(1);
  });

  it("exposes only fullscreen through the public reading slot and clears it on unmount", async () => {
    const messages = coreMessagesByLocale.en;
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { unmount } = render(
      <QueryClientProvider client={client}>
        <CoreI18nProvider locale="en">
          <DashboardVisitorProvider visitorKind="anonymous">
            <HtmlDetailView orpc={orpc} slug="html-1" />
            <TopbarNodeActionsSlot />
            <TopbarNodeActionsSlot readOnly />
          </DashboardVisitorProvider>
        </CoreI18nProvider>
      </QueryClientProvider>,
    );
    await screen.findByTitle(fmt(messages.richNodes.previewFrame, { name: detail.node.name }));
    expect(screen.queryByRole("tab")).toBeNull();
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.queryByRole("button", { name: messages.common.edit })).toBeNull();
    expect(screen.queryByRole("button", { name: messages.richNodes.save })).toBeNull();
    expect(screen.queryByRole("button", { name: messages.nodeDetail.pinToSidePanel })).toBeNull();
    expect(screen.getAllByRole("button")).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: messages.airapp.enterFullscreen }));
    await screen.findByRole("button", { name: messages.airapp.exitFullscreen });
    unmount();
    render(<TopbarNodeActionsSlot readOnly />);
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("starts members in reading mode with Edit before Agent and Pin after Agent", async () => {
    const { container, update } = renderMember();
    const messages = coreMessagesByLocale.en;
    const edit = await screen.findByRole("button", { name: messages.common.edit });
    const agent = screen.getByTestId("node-agent-prompts-button");
    const pin = screen.getByRole("button", { name: messages.nodeDetail.pinToSidePanel });
    expect(edit.compareDocumentPosition(agent) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(agent.compareDocumentPosition(pin) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.queryByRole("tab")).toBeNull();
    expect(screen.queryByRole("button", { name: messages.richNodes.save })).toBeNull();
    expect(container.querySelector("[data-rich-node-save-status]")).toBeNull();
    expect(update).not.toHaveBeenCalled();
  });

  it("edits only after Edit and discards a draft without writing or retaining dirty state", async () => {
    const messages = coreMessagesByLocale.en;
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    const { container, update } = renderMember();
    fireEvent.click(await screen.findByRole("button", { name: messages.common.edit }));
    expect(
      screen.getByRole("tab", { name: messages.richNodes.source }).getAttribute("data-state"),
    ).toBe("active");
    expect(container.querySelector("[data-rich-node-save-status]")).toBeNull();
    expect(
      screen.getByRole("button", { name: messages.richNodes.save }).hasAttribute("disabled"),
    ).toBe(true);
    fireEvent.change(screen.getByRole("textbox", { name: messages.richNodes.htmlSource }), {
      target: { value: "<main>Draft report</main>" },
    });
    fireEvent.mouseDown(screen.getByRole("tab", { name: messages.richNodes.preview }));
    expect(
      screen
        .getByTitle(fmt(messages.richNodes.previewFrame, { name: detail.node.name }))
        .getAttribute("srcdoc"),
    ).toContain("Draft report");
    expect(update).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: messages.common.cancel }));
    expect(confirm).toHaveBeenCalledWith(messages.richNodes.discardChanges);
    expect(screen.getByRole("tab", { name: messages.richNodes.source })).not.toBeNull();
    confirm.mockReturnValue(true);
    fireEvent.click(screen.getByRole("button", { name: messages.common.cancel }));
    expect(screen.queryByRole("tab")).toBeNull();
    expect(
      screen
        .getByTitle(fmt(messages.richNodes.previewFrame, { name: detail.node.name }))
        .getAttribute("srcdoc"),
    ).toContain(detail.document.source);
    fireEvent.click(screen.getByRole("button", { name: messages.common.edit }));
    expect(
      (screen.getByRole("textbox", { name: messages.richNodes.htmlSource }) as HTMLTextAreaElement)
        .value,
    ).toBe(detail.document.source);
    expect(container.querySelector("[data-rich-node-save-status]")).toBeNull();
    expect(update).not.toHaveBeenCalled();
  });

  it("keeps a failed draft for retry, then returns to the saved report", async () => {
    const messages = coreMessagesByLocale.en;
    const submit = vi
      .fn()
      .mockRejectedValueOnce(new Error("HTML save unavailable"))
      .mockResolvedValue({ id: "html-save", status: "merged" });
    const { update } = renderMember(submit);
    fireEvent.click(await screen.findByRole("button", { name: messages.common.edit }));
    fireEvent.change(screen.getByRole("textbox", { name: messages.richNodes.htmlSource }), {
      target: { value: "<main>Saved report</main>" },
    });
    fireEvent.click(screen.getByRole("button", { name: messages.richNodes.save }));
    await screen.findByRole("alert");
    expect(
      (screen.getByRole("textbox", { name: messages.richNodes.htmlSource }) as HTMLTextAreaElement)
        .value,
    ).toContain("Saved report");
    fireEvent.click(screen.getByRole("button", { name: messages.richNodes.save }));
    await screen.findByRole("button", { name: messages.common.edit });
    expect(screen.queryByRole("tab")).toBeNull();
    expect(screen.queryByRole("button", { name: messages.richNodes.save })).toBeNull();
    expect(
      screen
        .getByTitle(fmt(messages.richNodes.previewFrame, { name: detail.node.name }))
        .getAttribute("srcdoc"),
    ).toContain("Saved report");
    expect(update).toHaveBeenCalledTimes(2);
  });

  it("labels a submitted proposal as review and returns to the published version", async () => {
    const messages = coreMessagesByLocale.en;
    renderMember(async () => ({ id: "html-save", status: "in_review" }));
    fireEvent.click(await screen.findByRole("button", { name: messages.common.edit }));
    fireEvent.change(screen.getByRole("textbox", { name: messages.richNodes.htmlSource }), {
      target: { value: "<main>Proposed report</main>" },
    });
    fireEvent.click(screen.getByRole("button", { name: messages.richNodes.save }));
    const returnToReading = await screen.findByRole("button", {
      name: messages.richNodes.returnToReading,
    });
    expect(screen.getByRole("status").textContent).not.toBe(messages.richNodes.saved);
    expect(screen.getByRole("link", { name: messages.inbox.title })).not.toBeNull();
    fireEvent.click(returnToReading);
    expect(screen.queryByRole("tab")).toBeNull();
    const frame = screen.getByTitle(
      fmt(messages.richNodes.previewFrame, { name: detail.node.name }),
    );
    expect(frame.getAttribute("srcdoc")).toContain(detail.document.source);
    expect(frame.getAttribute("srcdoc")).not.toContain("Proposed report");
  });

  it("retains edits made while a save request is in flight", async () => {
    const messages = coreMessagesByLocale.en;
    let finishSave!: () => void;
    const request = new Promise<void>((resolve) => {
      finishSave = resolve;
    });
    const { update } = renderMember(async () => {
      await request;
      return { id: "html-save", status: "merged" };
    });
    fireEvent.click(await screen.findByRole("button", { name: messages.common.edit }));
    const source = screen.getByRole("textbox", { name: messages.richNodes.htmlSource });
    fireEvent.change(source, { target: { value: "<main>First revision</main>" } });
    fireEvent.click(screen.getByRole("button", { name: messages.richNodes.save }));
    await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
    fireEvent.change(source, { target: { value: "<main>New revision</main>" } });
    finishSave();
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: messages.richNodes.save }).hasAttribute("disabled"),
      ).toBe(false),
    );
    expect((source as HTMLTextAreaElement).value).toContain("New revision");
    expect(screen.queryByRole("button", { name: messages.common.edit })).toBeNull();
  });

  it("protects a draft from refresh, links and cancelled browser history navigation", async () => {
    window.history.replaceState(null, "", "/html/another-report");
    window.history.pushState({ html: true }, "", "/html/preview-example");
    const messages = coreMessagesByLocale.en;
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    const { update } = renderMember();
    fireEvent.click(await screen.findByRole("button", { name: messages.common.edit }));
    fireEvent.change(screen.getByRole("textbox", { name: messages.richNodes.htmlSource }), {
      target: { value: "<main>Keep this draft</main>" },
    });
    const beforeUnload = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(beforeUnload);
    expect(beforeUnload.defaultPrevented).toBe(true);

    const link = document.createElement("a");
    link.href = "/html/another-report";
    document.body.append(link);
    const click = new MouseEvent("click", { bubbles: true, cancelable: true });
    link.dispatchEvent(click);
    expect(click.defaultPrevented).toBe(true);
    link.remove();

    const routerListener = vi.fn();
    window.addEventListener("popstate", routerListener);
    try {
      confirm.mockClear();
      window.history.back();
      await waitFor(() => expect(confirm).toHaveBeenCalledTimes(1));
      await waitFor(() => expect(window.location.pathname).toBe("/html/preview-example"));
      expect(routerListener).not.toHaveBeenCalled();
      expect(window.history.state).toMatchObject({ html: true });
      expect(
        (
          screen.getByRole("textbox", {
            name: messages.richNodes.htmlSource,
          }) as HTMLTextAreaElement
        ).value,
      ).toContain("Keep this draft");
      confirm.mockReturnValue(true);
      window.history.back();
      await waitFor(() => expect(routerListener).toHaveBeenCalledTimes(1));
      expect(window.location.pathname).toBe("/html/another-report");
      expect(update).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener("popstate", routerListener);
    }
  });

  it("guards history before a router subscription registered prior to editing", async () => {
    window.history.replaceState(null, "", "/html/another-report");
    window.history.pushState(null, "", "/html/preview-example");
    const messages = coreMessagesByLocale.en;
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    const routerListener = vi.fn();
    window.addEventListener("popstate", routerListener);
    try {
      renderMember();
      fireEvent.click(await screen.findByRole("button", { name: messages.common.edit }));
      const source = screen.getByRole("textbox", { name: messages.richNodes.htmlSource });
      fireEvent.change(source, { target: { value: "<main>Keep this draft</main>" } });
      window.history.back();
      await waitFor(() => expect(confirm).toHaveBeenCalledWith(messages.richNodes.discardChanges));
      await waitFor(() => expect(window.location.pathname).toBe("/html/preview-example"));
      expect(routerListener).not.toHaveBeenCalled();
      expect(window.location.pathname).toBe("/html/preview-example");
      expect((source as HTMLTextAreaElement).value).toContain("Keep this draft");
    } finally {
      window.removeEventListener("popstate", routerListener);
    }
  });

  it("preserves both history branches when a draft rejects Back and Forward", async () => {
    window.history.replaceState(null, "", "/html/first-report");
    window.history.pushState({ html: true }, "", "/html/preview-example");
    window.history.pushState(null, "", "/html/next-report");
    window.history.pushState(null, "", "/html/last-report");
    window.history.go(-2);
    await waitFor(() => expect(window.location.pathname).toBe("/html/preview-example"));
    const historyLength = window.history.length;
    const messages = coreMessagesByLocale.en;
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    const { update } = renderMember();
    fireEvent.click(await screen.findByRole("button", { name: messages.common.edit }));
    const source = screen.getByRole("textbox", { name: messages.richNodes.htmlSource });
    fireEvent.change(source, { target: { value: "<main>Preserve both branches</main>" } });
    const routerListener = vi.fn();
    window.addEventListener("popstate", routerListener);
    try {
      window.history.forward();
      await waitFor(() => expect(confirm).toHaveBeenCalledTimes(1));
      await waitFor(() => expect(window.location.pathname).toBe("/html/preview-example"));
      expect(window.history.length).toBe(historyLength);
      expect(routerListener).not.toHaveBeenCalled();

      window.history.back();
      await waitFor(() => expect(confirm).toHaveBeenCalledTimes(2));
      await waitFor(() => expect(window.location.pathname).toBe("/html/preview-example"));
      expect(window.history.length).toBe(historyLength);
      expect(routerListener).not.toHaveBeenCalled();
      expect((source as HTMLTextAreaElement).value).toContain("Preserve both branches");

      confirm.mockReturnValue(true);
      window.history.forward();
      await waitFor(() => expect(window.location.pathname).toBe("/html/next-report"));
      window.history.forward();
      await waitFor(() => expect(window.location.pathname).toBe("/html/last-report"));
      expect(window.history.length).toBe(historyLength);
      expect(routerListener).toHaveBeenCalledTimes(2);
      expect(update).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener("popstate", routerListener);
    }
  });

  it("uses the traversal's state snapshot when another listener has already rewritten history state", async () => {
    window.history.replaceState(null, "", "/html/preview-example");
    const protectedState = window.history.state as { __busabaseHtmlHistoryPosition: number };
    const messages = coreMessagesByLocale.en;
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    const go = vi.spyOn(window.history, "go").mockImplementation(() => undefined);
    renderMember();
    fireEvent.click(await screen.findByRole("button", { name: messages.common.edit }));
    fireEvent.change(screen.getByRole("textbox", { name: messages.richNodes.htmlSource }), {
      target: { value: "<main>Preserve the correct history entry</main>" },
    });
    // A router's replaceState may already have copied the protected marker
    // onto the destination. The event still carries its original position.
    window.history.replaceState(protectedState, "", "/html/another-report");
    window.dispatchEvent(
      new PopStateEvent("popstate", {
        state: { __busabaseHtmlHistoryPosition: protectedState.__busabaseHtmlHistoryPosition - 1 },
      }),
    );
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(go).toHaveBeenCalledExactlyOnceWith(1);
    window.history.replaceState(protectedState, "", "/html/preview-example");
    window.dispatchEvent(new PopStateEvent("popstate", { state: protectedState }));
    expect(confirm).toHaveBeenCalledTimes(1);
  });

  it("intercepts native history traversal once without rewriting browser history", async () => {
    window.history.replaceState(null, "", "/html/preview-example");
    const navigation = new EventTarget();
    Object.defineProperty(navigation, "currentEntry", {
      get: () => ({ url: window.location.href, index: 0 }),
    });
    Object.defineProperty(window, "navigation", { configurable: true, value: navigation });
    const guard = (window as unknown as Record<symbol, { trackingLegacyHistory?: boolean }>)[
      Symbol.for("busabase.html-history-guard")
    ];
    const previousTracking = guard.trackingLegacyHistory;
    guard.trackingLegacyHistory = false;
    window.history.replaceState(null, "");
    const messages = coreMessagesByLocale.en;
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    const pushState = vi.spyOn(window.history, "pushState");
    const replaceState = vi.spyOn(window.history, "replaceState");
    const { unmount } = renderMember();
    try {
      fireEvent.click(await screen.findByRole("button", { name: messages.common.edit }));
      fireEvent.change(screen.getByRole("textbox", { name: messages.richNodes.htmlSource }), {
        target: { value: "<main>Keep this draft</main>" },
      });
      const traverse = (path: string, sameDocument = true) => {
        const event = new Event("navigate", { cancelable: true });
        Object.assign(event, {
          navigationType: "traverse",
          destination: { sameDocument, url: `http://localhost${path}` },
        });
        navigation.dispatchEvent(event);
        return event;
      };
      expect(traverse("/html/another-report").defaultPrevented).toBe(true);
      expect(confirm).toHaveBeenCalledTimes(1);
      expect(pushState).not.toHaveBeenCalled();
      expect(replaceState).not.toHaveBeenCalled();
      expect(traverse("/html/preview-example?fullscreen=1").defaultPrevented).toBe(false);
      expect(traverse("/html/another-report", false).defaultPrevented).toBe(false);
      expect(confirm).toHaveBeenCalledTimes(1);
      confirm.mockReturnValue(true);
      expect(traverse("/html/another-report").defaultPrevented).toBe(false);
      expect(confirm).toHaveBeenCalledTimes(2);
      window.history.pushState(null, "", "/html/another-report");
      window.dispatchEvent(new PopStateEvent("popstate"));
      expect(confirm).toHaveBeenCalledTimes(2);
      expect(replaceState).not.toHaveBeenCalled();
    } finally {
      unmount();
      guard.trackingLegacyHistory = previousTracking;
      Reflect.deleteProperty(window, "navigation");
    }
  });

  it("falls back when a partial Navigation API leaves currentEntry at the previous URL", async () => {
    window.history.replaceState(null, "", "/html/previous-report");
    const navigation = new EventTarget();
    let entryUrl = window.location.href;
    Object.defineProperty(navigation, "currentEntry", {
      get: () => ({ url: entryUrl, index: 0 }),
    });
    Object.defineProperty(window, "navigation", { configurable: true, value: navigation });
    const guard = (window as unknown as Record<symbol, { trackingLegacyHistory?: boolean }>)[
      Symbol.for("busabase.html-history-guard")
    ];
    const previousTracking = guard.trackingLegacyHistory;
    guard.trackingLegacyHistory = false;
    window.history.replaceState(null, "");
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    const nativeTraversal = () => {
      const event = new Event("navigate", { cancelable: true });
      Object.assign(event, {
        navigationType: "traverse",
        destination: { sameDocument: true, url: "http://localhost/html/previous-report" },
      });
      navigation.dispatchEvent(event);
      return event;
    };
    let unmount: () => void = () => undefined;
    try {
      window.history.pushState(null, "", "/html/preview-example");
      expect(window.history.state.__busabaseHtmlHistoryPosition).toBeTypeOf("number");
      expect(guard.trackingLegacyHistory).toBe(true);
      ({ unmount } = renderMember());
      const messages = coreMessagesByLocale.en;
      fireEvent.click(await screen.findByRole("button", { name: messages.common.edit }));
      const source = screen.getByRole("textbox", { name: messages.richNodes.htmlSource });
      fireEvent.change(source, { target: { value: "<main>Partial API draft</main>" } });
      expect(nativeTraversal().defaultPrevented).toBe(false);
      expect(confirm).not.toHaveBeenCalled();
      window.history.back();
      await waitFor(() => expect(confirm).toHaveBeenCalledTimes(1));
      await waitFor(() => expect(window.location.pathname).toBe("/html/preview-example"));
      expect((source as HTMLTextAreaElement).value).toContain("Partial API draft");

      // Reload makes the browser's API appear coherent again. A persisted
      // fallback marker must still prevent it from taking over this entry.
      entryUrl = window.location.href;
      const marker = window.history.state.__busabaseHtmlHistoryPosition;
      unmount();
      guard.trackingLegacyHistory = false;
      ({ unmount } = renderMember());
      fireEvent.click(await screen.findByRole("button", { name: messages.common.edit }));
      fireEvent.change(screen.getByRole("textbox", { name: messages.richNodes.htmlSource }), {
        target: { value: "<main>Draft after reload</main>" },
      });
      expect(window.history.state.__busabaseHtmlHistoryPosition).toBe(marker);
      confirm.mockClear();
      expect(nativeTraversal().defaultPrevented).toBe(false);
      expect(confirm).not.toHaveBeenCalled();
    } finally {
      unmount();
      guard.trackingLegacyHistory = previousTracking;
      Reflect.deleteProperty(window, "navigation");
    }
  });

  it("keeps history protected when an API becomes incoherent after the draft guard is installed", async () => {
    window.history.replaceState(null, "", "/html/previous-report");
    const navigation = new EventTarget();
    let lagging = false;
    Object.defineProperty(navigation, "currentEntry", {
      get: () => ({
        url: lagging ? "http://localhost/html/previous-report" : window.location.href,
        index: 0,
      }),
    });
    Object.defineProperty(window, "navigation", { configurable: true, value: navigation });
    const guard = (window as unknown as Record<symbol, { trackingLegacyHistory?: boolean }>)[
      Symbol.for("busabase.html-history-guard")
    ];
    const previousTracking = guard.trackingLegacyHistory;
    guard.trackingLegacyHistory = false;
    window.history.replaceState(null, "");
    window.history.pushState(null, "", "/html/preview-example");
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    const { unmount } = renderMember();
    try {
      const messages = coreMessagesByLocale.en;
      fireEvent.click(await screen.findByRole("button", { name: messages.common.edit }));
      const source = screen.getByRole("textbox", { name: messages.richNodes.htmlSource });
      fireEvent.change(source, { target: { value: "<main>Guard survives the API change</main>" } });
      expect(guard.trackingLegacyHistory).toBe(false);
      lagging = true;
      // The URL is unchanged, so this write need not re-render the editor.
      window.history.replaceState(null, "", window.location.href);
      expect(guard.trackingLegacyHistory).toBe(true);
      window.history.back();
      await waitFor(() => expect(confirm).toHaveBeenCalledTimes(1));
      await waitFor(() => expect(window.location.pathname).toBe("/html/preview-example"));
      expect((source as HTMLTextAreaElement).value).toContain("Guard survives the API change");
    } finally {
      unmount();
      guard.trackingLegacyHistory = previousTracking;
      Reflect.deleteProperty(window, "navigation");
    }
  });

  it("keeps a draft protected when a Navigation API object cannot subscribe", async () => {
    Object.defineProperty(window, "navigation", {
      configurable: true,
      value: { currentEntry: { url: window.location.href } },
    });
    const { unmount } = renderMember();
    try {
      const messages = coreMessagesByLocale.en;
      fireEvent.click(await screen.findByRole("button", { name: messages.common.edit }));
      fireEvent.change(screen.getByRole("textbox", { name: messages.richNodes.htmlSource }), {
        target: { value: "<main>Incomplete API draft</main>" },
      });
      const event = new Event("beforeunload", { cancelable: true });
      window.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(true);
    } finally {
      unmount();
      Reflect.deleteProperty(window, "navigation");
    }
  });
});
