// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { BusabaseQueryUtils } from "busabase-contract/api-client/react-query";
import type { SpaceWelcomeVO } from "busabase-contract/domains/space-welcome/types";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CoreI18nProvider } from "../../../i18n";
import { createKnownNodeCache } from "../helpers/known-node-cache";

vi.mock("openlib/ui/dashboard", () => ({
  SPALink: ({
    children,
    href,
    className,
  }: {
    children: unknown;
    href: string;
    className?: string;
  }) => (
    <a className={className} href={href}>
      {children as never}
    </a>
  ),
}));
// The real editor is Crepe/ProseMirror; Home only has to hand it the body read-only.
vi.mock("../../doc/components", () => ({
  DocEditor: ({ content, editable }: { content: string; editable?: boolean }) => (
    <div data-editable={String(editable)} data-testid="doc-editor">
      {content}
    </div>
  ),
}));
vi.mock("../../rich-node/components/html-detail-view", () => ({
  HtmlPreviewSurface: ({ source }: { source: string }) => (
    <iframe data-testid="html-preview" sandbox="allow-scripts" srcDoc={source} title="preview" />
  ),
}));
vi.mock("./agent-skill-button", () => ({
  AgentIntegrationDialog: ({ open }: { open: boolean }) =>
    open ? <div data-testid="integration-dialog" /> : null,
}));
vi.mock("../helpers/activity-events", () => ({
  buildActivityEventFromItem: (item: { id: string }) => ({ id: item.id }),
}));
vi.mock("./activity", () => ({
  ActivityRow: ({ event }: { event: { id: string } }) => <div data-activity-row={event.id} />,
}));

const { HomeView } = await import("./home");
const { EmptyAgentGuide } = await import("./empty-agent-guide");
const { SpaceWelcomeCard } = await import("../../space-welcome/components/space-welcome-card");

type NodeDetail = {
  type: string;
  node: Record<string, unknown>;
  body?: string;
  document?: unknown;
};

const nodeVO = (id: string, type: string, name: string) => ({
  id,
  parentId: null,
  type,
  slug: `${id}-slug`,
  name,
  description: "",
  metadata: {},
  settings: {},
  explicitVisibility: null,
  icon: null,
  position: 0,
  createdAt: "2026-10-30T00:00:00.000Z",
  updatedAt: "2026-10-30T00:00:00.000Z",
  baseId: null,
  children: [],
});

const docDetail = (
  id = "nod_guide",
  name = "Welcome to Acme",
  body = "## Start here\nOpen the CRM.",
) => ({
  type: "doc",
  node: nodeVO(id, "doc", name),
  body,
});
const htmlDetail = (id = "nod_page", name = "Acme portal") => ({
  type: "html",
  node: nodeVO(id, "html", name),
  document: { version: 1, source: "<h1>Hello Acme</h1>" },
});

const forbidden = () => Object.assign(new Error("Forbidden"), { code: "FORBIDDEN", status: 403 });
const notFound = () => Object.assign(new Error("Not Found"), { code: "NOT_FOUND", status: 404 });

let scopeCounter = 0;

interface Setup {
  welcome?: () => Promise<SpaceWelcomeVO>;
  nodes?: Record<string, () => Promise<NodeDetail>>;
  /** Activity items: any entry makes the space "not empty". */
  activity?: Array<{ id: string }>;
  visited?: boolean;
  guide?: boolean;
  scope?: string;
}

const welcomeAt =
  (nodeId: string | null, version = 1) =>
  async (): Promise<SpaceWelcomeVO> => ({
    spaceId: "spc_acme",
    nodeId,
    version,
    updatedAt: nodeId ? "2026-10-30T00:00:00.000Z" : null,
  });

function setup({
  welcome = welcomeAt(null, 0),
  nodes = {},
  activity = [],
  visited = false,
  guide = true,
  scope = `spc_acme:user_${++scopeCounter}`,
}: Setup = {}) {
  const nodeGet = vi.fn(async (nodeId: string) => {
    const resolve = nodes[nodeId];
    if (!resolve) throw notFound();
    return resolve();
  });
  const orpc = {
    changeRequests: {
      reviewCount: {
        queryOptions: () => ({ queryKey: ["reviewCount"], queryFn: async () => ({ review: 0 }) }),
      },
    },
    activity: {
      listPaged: {
        queryOptions: () => ({
          queryKey: ["activity"],
          queryFn: async () => ({ items: activity }),
        }),
      },
    },
    spaceWelcome: {
      get: {
        queryOptions: (options: Record<string, unknown> = {}) => ({
          ...options,
          queryKey: [["spaceWelcome", "get"]],
          queryFn: welcome,
        }),
      },
    },
    nodes: {
      get: {
        queryOptions: ({ input }: { input: { nodeId: string } }) => ({
          queryKey: ["nodes.get", input.nodeId],
          queryFn: () => nodeGet(input.nodeId),
        }),
      },
    },
  } as unknown as BusabaseQueryUtils;
  const nodeCache = createKnownNodeCache(scope);
  if (visited) {
    nodeCache.recordVisit(
      { id: "nod_crm", type: "base", name: "CRM", slug: "crm", path: "/base/crm" },
      "2026-10-30T00:00:00.000Z",
    );
  }
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = () => (
    <QueryClientProvider client={client}>
      <CoreI18nProvider locale="en">
        <HomeView
          changeRequests={[]}
          emptyGuide={
            guide ? <EmptyAgentGuide edition="cloud" onCreateNode={() => {}} /> : undefined
          }
          nodeCache={nodeCache}
          onOpenSearch={() => {}}
          orpc={orpc}
        />
      </CoreI18nProvider>
    </QueryClientProvider>
  );
  const rendered = render(view());
  return { ...rendered, view, nodeGet, scope };
}

const welcomeCard = () => document.querySelector('[data-home-section="welcome"]');
const guideCard = () =>
  document.querySelector("[data-getting-started]:not([data-getting-started=node-types])");
const recentSection = () => document.querySelector('[data-home-section="recent"]');
const settle = () =>
  waitFor(() =>
    expect(document.querySelector("[data-activity-row], [data-home-section]")).toBeTruthy(),
  );

afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe("Home welcome page", () => {
  it("shows a readable Doc welcome above the unchanged sections, read-only, with an Open link", async () => {
    setup({
      welcome: welcomeAt("nod_guide"),
      nodes: { nod_guide: async () => docDetail() },
      activity: [{ id: "evt_1" }],
      visited: true,
    });
    await waitFor(() => expect(welcomeCard()).toBeTruthy());
    const card = welcomeCard() as HTMLElement;
    expect(card.textContent).toContain("Welcome to Acme");
    expect(screen.getByTestId("doc-editor").textContent).toContain("Open the CRM.");
    expect(screen.getByTestId("doc-editor").getAttribute("data-editable")).toBe("false");
    expect(screen.getByRole("link", { name: /Open/ }).getAttribute("href")).toBe(
      "/doc/nod_guide-slug",
    );
    // Nothing is removed: the digest still follows, below the card.
    expect(recentSection()).toBeTruthy();
    expect(document.querySelector('[data-home-section="activity"]')).toBeTruthy();
    expect(guideCard()).toBeNull();
    // The card comes first.
    expect(
      card.compareDocumentPosition(recentSection() as Element) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("caps a long Doc and lets the member expand and collapse it; a short one has no toggle", async () => {
    const original = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetHeight");
    // jsdom does no layout: report a tall body for the long Doc's content only.
    Object.defineProperty(HTMLElement.prototype, "offsetHeight", {
      configurable: true,
      get(this: HTMLElement) {
        return this.querySelector?.('[data-testid="doc-editor"]')?.textContent?.includes("Chapter")
          ? 900
          : 40;
      },
    });
    try {
      const long = setup({
        welcome: welcomeAt("nod_guide"),
        nodes: { nod_guide: async () => docDetail("nod_guide", "Handbook", "# Chapter 1\n...") },
        visited: true,
      });
      await waitFor(() => expect(welcomeCard()).toBeTruthy());
      const body = () => document.querySelector("[data-space-welcome-doc]");
      expect(body()?.getAttribute("data-space-welcome-doc")).toBe("collapsed");
      expect(body()?.className).toContain("max-h-80");
      fireEvent.click(screen.getByRole("button", { name: "Expand" }));
      expect(body()?.getAttribute("data-space-welcome-doc")).toBe("expanded");
      expect(screen.getByRole("button", { name: "Collapse" }).getAttribute("aria-expanded")).toBe(
        "true",
      );
      fireEvent.click(screen.getByRole("button", { name: "Collapse" }));
      expect(body()?.getAttribute("data-space-welcome-doc")).toBe("collapsed");
      long.unmount();

      setup({
        welcome: welcomeAt("nod_guide"),
        nodes: { nod_guide: async () => docDetail("nod_guide", "Short", "Hi") },
        visited: true,
      });
      await waitFor(() => expect(welcomeCard()?.textContent).toContain("Short"));
      expect(screen.queryByRole("button", { name: "Expand" })).toBeNull();
      expect(document.querySelector("[data-space-welcome-doc]")?.className).not.toContain(
        "max-h-80",
      );
    } finally {
      if (original) Object.defineProperty(HTMLElement.prototype, "offsetHeight", original);
    }
  });

  it("starts watching the height when an empty Doc gains content, and caps it then", async () => {
    const original = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetHeight");
    Object.defineProperty(HTMLElement.prototype, "offsetHeight", {
      configurable: true,
      get(this: HTMLElement) {
        return this.querySelector?.('[data-testid="doc-editor"]')?.textContent?.includes("Chapter")
          ? 900
          : 40;
      },
    });
    const card = (body: string) => (
      <CoreI18nProvider locale="en">
        <SpaceWelcomeCard
          detail={docDetail("nod_guide", "Handbook", body) as never}
          onClose={vi.fn()}
        />
      </CoreI18nProvider>
    );
    try {
      // A refetch can turn an empty page into a long one. The measured block only mounts
      // for a non-empty body, so the observer has to attach on that flip, not at first render.
      const view = render(card(""));
      expect(screen.getByText("This page is empty.")).toBeTruthy();
      expect(screen.queryByRole("button", { name: "Expand" })).toBeNull();
      view.rerender(card("# Chapter 1\n..."));
      await waitFor(() => expect(screen.getByRole("button", { name: "Expand" })).toBeTruthy());
      expect(
        document.querySelector("[data-space-welcome-doc]")?.getAttribute("data-space-welcome-doc"),
      ).toBe("collapsed");
    } finally {
      if (original) Object.defineProperty(HTMLElement.prototype, "offsetHeight", original);
    }
  });

  it("renders an HTML welcome in the sandboxed preview frame", async () => {
    setup({ welcome: welcomeAt("nod_page"), nodes: { nod_page: async () => htmlDetail() } });
    await waitFor(() => expect(welcomeCard()).toBeTruthy());
    expect(screen.getByTestId("html-preview").getAttribute("srcdoc")).toContain("Hello Acme");
    expect(document.querySelector("[data-space-welcome-html]")?.className).toContain("h-[28rem]");
  });

  it("closes per member and space, stays closed on the next visit, and reopens from Home", async () => {
    const first = setup({
      welcome: welcomeAt("nod_guide"),
      nodes: { nod_guide: async () => docDetail() },
      visited: true,
    });
    await waitFor(() => expect(welcomeCard()).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Close welcome page" }));
    expect(welcomeCard()).toBeNull();
    expect(screen.getByRole("button", { name: "Welcome page" })).toBeTruthy();
    first.unmount();

    // Same member, same space: still closed.
    const again = setup({
      welcome: welcomeAt("nod_guide"),
      nodes: { nod_guide: async () => docDetail() },
      visited: true,
      scope: first.scope,
    });
    await waitFor(() => expect(screen.getByRole("button", { name: "Welcome page" })).toBeTruthy());
    expect(welcomeCard()).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Welcome page" }));
    expect(welcomeCard()).toBeTruthy();
    again.unmount();

    // Another member (or space) never inherits that dismissal.
    setup({
      welcome: welcomeAt("nod_guide"),
      nodes: { nod_guide: async () => docDetail() },
      visited: true,
    });
    await waitFor(() => expect(welcomeCard()).toBeTruthy());
  });

  it("shows a newly chosen welcome page even to a member who closed the previous one", async () => {
    const first = setup({
      welcome: welcomeAt("nod_guide"),
      nodes: { nod_guide: async () => docDetail() },
      visited: true,
    });
    await waitFor(() => expect(welcomeCard()).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Close welcome page" }));
    first.unmount();
    setup({
      welcome: welcomeAt("nod_page", 2),
      nodes: { nod_page: async () => htmlDetail() },
      visited: true,
      scope: first.scope,
    });
    await waitFor(() => expect(welcomeCard()?.textContent).toContain("Acme portal"));
  });

  it("treats an unreadable welcome node exactly as no welcome, without leaking its name", async () => {
    const { nodeGet } = setup({
      welcome: welcomeAt("nod_secret"),
      nodes: {
        nod_secret: async () => {
          throw forbidden();
        },
      },
      activity: [{ id: "evt_1" }],
    });
    // A member who has visited nothing gets Getting started instead.
    await waitFor(() => expect(guideCard()?.getAttribute("data-getting-started")).toBe("member"));
    expect(nodeGet).toHaveBeenCalledWith("nod_secret");
    expect(welcomeCard()).toBeNull();
    expect(document.body.textContent).not.toContain("nod_secret");
    expect(screen.queryByRole("button", { name: "Welcome page" })).toBeNull();
  });

  it("treats a missing, trashed or non-page node, and an old server, as no welcome", async () => {
    for (const variant of [
      { welcome: welcomeAt("nod_gone") },
      {
        welcome: welcomeAt("nod_base"),
        nodes: {
          nod_base: async () => ({ type: "base", node: nodeVO("nod_base", "base", "Secret Base") }),
        },
      },
      {
        welcome: async () => {
          throw notFound();
        },
      },
    ]) {
      const rendered = setup({ ...variant, visited: true, activity: [{ id: "evt_1" }] });
      await settle();
      await waitFor(() => expect(recentSection()).toBeTruthy());
      // Give the welcome/node queries a chance to settle before asserting absence.
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 20));
      });
      expect(welcomeCard()).toBeNull();
      expect(document.body.textContent).not.toContain("Secret Base");
      expect(guideCard()).toBeNull();
      rendered.unmount();
    }
  });
});

describe("Home built-in Getting started", () => {
  it("replaces the empty sections in a brand-new space, keeping every way to fill it", async () => {
    setup();
    await waitFor(() => expect(guideCard()?.getAttribute("data-getting-started")).toBe("newSpace"));
    expect(screen.getByRole("link", { name: /Start from a template/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Create a Base or document/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Connect your agent/ })).toBeTruthy();
    // The real node types, not the four generic Bases.
    expect(document.querySelector('[data-node-type="base"]')).toBeTruthy();
    expect(document.querySelector('[data-node-type="doc"]')).toBeTruthy();
    expect(document.body.textContent).not.toContain("Knowledge Base");
    expect(recentSection()).toBeNull();
  });

  it("greets an invited member of a populated space without a template CTA", async () => {
    setup({ activity: [{ id: "evt_1" }] });
    await waitFor(() => expect(guideCard()?.getAttribute("data-getting-started")).toBe("member"));
    const card = guideCard() as HTMLElement;
    expect(card.textContent).toContain("Getting started");
    expect(card.querySelector('a[href="/templates"]')).toBeNull();
    expect(card.textContent).not.toContain("Create a Base or document");
    fireEvent.click(screen.getByRole("button", { name: /Connect your agent/ }));
    expect(screen.getByTestId("integration-dialog")).toBeTruthy();
    // The digest still follows below.
    expect(recentSection()).toBeTruthy();
  });

  it("stays out of the way once the member has visited something", async () => {
    setup({ activity: [{ id: "evt_1" }], visited: true });
    await waitFor(() => expect(recentSection()?.textContent).toContain("CRM"));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(guideCard()).toBeNull();
  });

  it("can be closed and reopened; closing it in an empty space brings back the section shells", async () => {
    const first = setup();
    await waitFor(() => expect(guideCard()).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Close getting started" }));
    expect(guideCard()).toBeNull();
    expect(recentSection()).toBeTruthy();
    expect(screen.getByRole("button", { name: "Getting started" })).toBeTruthy();
    first.unmount();

    setup({ scope: first.scope });
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Getting started" })).toBeTruthy(),
    );
    expect(guideCard()).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Getting started" }));
    expect(guideCard()).toBeTruthy();
  });

  it("decides nothing while the welcome is still loading", async () => {
    setup({ welcome: () => new Promise<SpaceWelcomeVO>(() => {}) });
    await waitFor(() => expect(recentSection()).toBeTruthy());
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(guideCard()).toBeNull();
    expect(welcomeCard()).toBeNull();
  });

  it("is not shown by a host that supplies no guide", async () => {
    setup({ guide: false, activity: [{ id: "evt_1" }] });
    await waitFor(() => expect(recentSection()).toBeTruthy());
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(guideCard()).toBeNull();
    expect(screen.queryByRole("button", { name: "Getting started" })).toBeNull();
  });
});
