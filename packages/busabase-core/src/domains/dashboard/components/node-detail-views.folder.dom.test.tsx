// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { BusabaseQueryUtils } from "busabase-contract/api-client/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CoreI18nProvider } from "../../../i18n";

vi.mock("wouter", () => ({
  useLocation: () => ["/folder/handbook", vi.fn()],
  useSearch: () => "",
}));
vi.mock("openlib/ui/dashboard", async (importOriginal) => ({
  ...(await importOriginal<typeof import("openlib/ui/dashboard")>()),
  SPALink: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

const { FolderDetailView } = await import("./node-detail-views");

const node = (id: string, type: string, name: string) => ({
  id,
  type,
  slug: id,
  name,
  description: "",
  metadata: {},
  settings: {},
  icon: null,
  children: [],
});

function renderFolder(
  body: string,
  children: ReturnType<typeof node>[],
  bodyFormat: "markdown" | "html" = "markdown",
) {
  const orpc = {
    nodes: {
      get: {
        queryOptions: () => ({
          queryKey: ["nodes", "folder", body, children.length, bodyFormat],
          queryFn: async () => ({
            type: "folder",
            node: node("handbook", "folder", "产品资料"),
            children,
            storagePrefix: "busabase/nodes/handbook/folder/",
            body,
            bodyFormat,
          }),
        }),
      },
    },
  } as unknown as BusabaseQueryUtils;
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <CoreI18nProvider locale="zh-CN">
        <FolderDetailView hideActions orpc={orpc} slug="handbook" />
      </CoreI18nProvider>
    </QueryClientProvider>,
  );
}

const README = "# 产品资料怎么用\n\n新同事先看流程图。\n\n![流程图](/api/assets/ast_flow/raw)\n";
const DOCS = [node("onboarding", "doc", "入职第一天"), node("pricing", "doc", "产品定价")];

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("folder detail — readme above the children", () => {
  it("shows the readme first and still lists every child below it", async () => {
    renderFolder(README, DOCS);

    const readme = await screen.findByTestId("folder-readme");
    expect(readme.textContent).toContain("说明");
    expect(screen.getByRole("heading", { name: "产品资料怎么用" })).toBeTruthy();
    expect(screen.getByRole("img", { name: "流程图" }).getAttribute("src")).toBe(
      "/api/assets/ast_flow/raw",
    );

    const links = screen.getAllByRole("link");
    expect(links.map((link) => link.textContent)).toEqual([
      expect.stringContaining("入职第一天"),
      expect.stringContaining("产品定价"),
    ]);
    // Readme before the list, in document order.
    expect(readme.compareDocumentPosition(links[0] as Node)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  });

  it("looks exactly as before when the folder has no readme", async () => {
    renderFolder("", DOCS);

    expect(await screen.findByText("入职第一天")).toBeTruthy();
    expect(screen.queryByTestId("folder-readme")).toBeNull();
  });

  it("keeps the empty-folder placeholder when there is neither a readme nor a child", async () => {
    renderFolder("   \n", []);

    expect(await screen.findByText("空文件夹")).toBeTruthy();
    expect(screen.queryByTestId("folder-readme")).toBeNull();
  });

  it("shows the readme in an empty folder, with a one-line note instead of the big placeholder", async () => {
    renderFolder(README, []);

    expect(await screen.findByTestId("folder-readme")).toBeTruthy();
    expect(screen.getByText("此文件夹还没有项目。")).toBeTruthy();
    expect(screen.queryByText("空文件夹")).toBeNull();
  });

  it("offers no 查看更多 for a readme that fits", async () => {
    renderFolder(README, DOCS);

    await screen.findByTestId("folder-readme");
    expect(screen.queryByRole("button", { name: "查看更多" })).toBeNull();
  });

  it("folds a tall readme behind 查看更多 and unfolds it again", async () => {
    // jsdom has no layout; stand in for a readme taller than the fold.
    vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockReturnValue(900);
    renderFolder(README, DOCS);

    const readme = await screen.findByTestId("folder-readme");
    const fold = readme.querySelector("[data-collapsed]");
    expect(fold?.getAttribute("data-collapsed")).toBe("true");

    fireEvent.click(screen.getByRole("button", { name: "查看更多" }));
    expect(fold?.getAttribute("data-collapsed")).toBe("false");
    const less = screen.getByRole("button", { name: "收起" });
    expect(less.getAttribute("aria-expanded")).toBe("true");

    fireEvent.click(less);
    expect(fold?.getAttribute("data-collapsed")).toBe("true");
    expect(screen.getByRole("button", { name: "查看更多" })).toBeTruthy();
  });
});

describe("folder detail — HTML readme", () => {
  const PAGE = '<h1>产品资料怎么用</h1><img src="/api/assets/ast_flow/raw" alt="流程图">';

  it("shows an HTML readme in the sandboxed HTML frame, not as Markdown, above the children", async () => {
    renderFolder(PAGE, DOCS, "html");

    const readme = await screen.findByTestId("folder-readme");
    expect(readme.getAttribute("data-readme-format")).toBe("html");
    expect(readme.textContent).toContain("说明");

    const frame = (await screen.findByTitle("产品资料 预览")) as HTMLIFrameElement;
    expect(readme.contains(frame)).toBe(true);
    // The same opaque sandbox an HTML node gets: scripts run, but never with
    // the workbench's origin.
    expect(frame.getAttribute("sandbox")).toContain("allow-scripts");
    expect(frame.getAttribute("sandbox")).not.toContain("allow-same-origin");
    expect(frame.getAttribute("srcdoc")).toContain(PAGE);

    // Rendered by the frame only — the source never reaches the workbench DOM.
    expect(screen.queryByRole("heading", { name: "产品资料怎么用" })).toBeNull();
    expect(screen.queryByRole("button", { name: "查看更多" })).toBeNull();

    const links = screen.getAllByRole("link");
    expect(links.map((link) => link.textContent)).toEqual([
      expect.stringContaining("入职第一天"),
      expect.stringContaining("产品定价"),
    ]);
    expect(readme.compareDocumentPosition(links[0] as Node)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  });

  it("treats a blank HTML readme like no readme", async () => {
    renderFolder("  \n", DOCS, "html");

    expect(await screen.findByText("入职第一天")).toBeTruthy();
    expect(screen.queryByTestId("folder-readme")).toBeNull();
  });
});
