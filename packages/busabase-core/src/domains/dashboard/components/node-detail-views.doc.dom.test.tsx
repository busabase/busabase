// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { BusabaseQueryUtils } from "busabase-contract/api-client/react-query";
import { useEffect } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CoreI18nProvider } from "../../../i18n";
import type { DocOutlineItem } from "../../doc/components";
import { useTopbarNodeActionsStore } from "../store/topbar-node-actions-store";

vi.mock("wouter", () => ({
  useLocation: () => ["/doc/handbook", vi.fn()],
  useSearch: () => "",
}));
vi.mock("../../doc/components", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../doc/components")>();
  return {
    ...actual,
    DocEditor: ({
      content,
      editable,
      onOutlineChange,
    }: {
      content: string;
      editable: boolean;
      onOutlineChange?: (items: DocOutlineItem[]) => void;
    }) => {
      useEffect(() => {
        onOutlineChange?.(
          editable
            ? []
            : [
                { id: "overview", level: 1, text: "Overview" },
                { id: "setup", level: 2, text: "Setup" },
                { id: "details", level: 3, text: "Details" },
              ],
        );
      }, [editable, onOutlineChange]);

      return (
        <textarea
          aria-label="Document body"
          onChange={() => undefined}
          readOnly={!editable}
          value={content}
        />
      );
    },
  };
});
vi.mock("../../doc/hooks/use-doc-image-upload", () => ({ useDocImageUpload: () => vi.fn() }));
vi.mock("./node-agent-prompts-button", () => ({
  NodeAgentPromptsButton: () => <button type="button">Agent prompts</button>,
}));
vi.mock("./node-pin-button", () => ({
  NodePinButton: () => <button type="button">Pin</button>,
  nodeSidePanelTabId: () => "doc-preview:test",
}));
vi.mock("./node-actions-menu", () => ({
  NodeActionsMenu: () => <button type="button">More</button>,
}));

const [{ DocDetailView }, { TopbarNodeActionsSlot }] = await Promise.all([
  import("./node-detail-views"),
  import("./topbar"),
]);

const doc = {
  type: "doc",
  storagePrefix: "busabase/nodes/nod_handbook",
  body: "# Handbook\n\nLong document body",
  node: {
    id: "nod_handbook",
    parentId: null,
    type: "doc",
    slug: "handbook",
    name: "Handbook",
    description: "Team reference",
    metadata: {},
    settings: {},
    explicitVisibility: null,
    icon: null,
    position: 0,
    createdAt: "2026-09-15T00:00:00.000Z",
    updatedAt: "2026-09-15T00:00:00.000Z",
    baseId: null,
    children: [],
  },
} as const;

const orpc = {
  nodes: {
    get: {
      queryOptions: () => ({ queryKey: ["nodes", "get", doc.node.id], queryFn: async () => doc }),
    },
    updateContent: {
      mutationOptions: () => ({ mutationFn: vi.fn() }),
    },
  },
} as unknown as BusabaseQueryUtils;

function renderDoc() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <CoreI18nProvider locale="en">
      <QueryClientProvider client={client}>
        <div data-testid="topbar">
          <TopbarNodeActionsSlot />
        </div>
        <main data-testid="doc-body">
          <DocDetailView orpc={orpc} slug="handbook" />
        </main>
      </QueryClientProvider>
    </CoreI18nProvider>,
  );
}

afterEach(() => {
  cleanup();
  useTopbarNodeActionsStore.getState().setActions(null);
});

describe("DocDetailView editing actions", () => {
  it("replaces read actions with cancel and save controls in the topbar", async () => {
    renderDoc();
    const topbar = screen.getByTestId("topbar");
    const body = screen.getByTestId("doc-body");

    fireEvent.click(await within(topbar).findByRole("button", { name: "Edit" }));

    await waitFor(() => {
      expect(within(topbar).getByRole("button", { name: "Cancel" })).toBeTruthy();
      expect(within(topbar).getByRole("button", { name: "Save Now" })).toBeTruthy();
    });
    expect(within(topbar).queryByRole("button", { name: "Edit" })).toBeNull();
    expect(within(topbar).queryByRole("button", { name: "Agent prompts" })).toBeNull();
    expect(within(body).queryByRole("button", { name: "Cancel" })).toBeNull();
    expect(within(body).queryByRole("button", { name: "Save Now" })).toBeNull();
  });

  it("uses the card reading surface and hides the outline while editing", async () => {
    renderDoc();
    const body = screen.getByTestId("doc-body");
    await waitFor(() => {
      expect(body.querySelector("[data-doc-reading-viewport]")).toBeTruthy();
      expect(body.querySelector("[data-doc-reading-surface]")).toBeTruthy();
    });
    const viewport = body.querySelector("[data-doc-reading-viewport]");
    const surface = body.querySelector("[data-doc-reading-surface]");

    expect(viewport?.className).toContain("bg-background");
    expect(surface?.className).toContain("max-w-5xl");
    expect(surface?.className).toContain("border-x");
    expect(surface?.className).toContain("bg-card");
    expect(await within(body).findByRole("navigation", { name: "On this page" })).toBeTruthy();

    fireEvent.click(within(screen.getByTestId("topbar")).getByRole("button", { name: "Edit" }));

    await waitFor(() => {
      expect(within(body).queryByRole("navigation", { name: "On this page" })).toBeNull();
    });
  });
});
