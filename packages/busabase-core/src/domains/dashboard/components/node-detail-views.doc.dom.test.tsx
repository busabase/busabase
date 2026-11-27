// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { BusabaseQueryUtils } from "busabase-contract/api-client/react-query";
import { useEffect, useImperativeHandle, useRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CoreI18nProvider } from "../../../i18n";
import type { DocEditorProps } from "../../doc/components";
import { useTopbarNodeActionsStore } from "../store/topbar-node-actions-store";

const navigate = vi.fn();
const editorSnapshotReads = vi.hoisted(() => vi.fn());
const deferEditorChange = vi.hoisted(() => ({ value: false }));
vi.mock("wouter", () => ({
  useLocation: () => ["/doc/handbook", navigate],
  useSearch: () => "",
}));
vi.mock("../../doc/components", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../doc/components")>();
  return {
    ...actual,
    DocEditor: ({ content, editable, editorRef, onChange, onOutlineChange }: DocEditorProps) => {
      const liveContent = useRef(content);
      useImperativeHandle(editorRef, () => ({
        getMarkdown: () => {
          editorSnapshotReads();
          return liveContent.current;
        },
      }));
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
          defaultValue={content}
          onChange={(event) => {
            liveContent.current = event.target.value;
            if (!deferEditorChange.value) onChange(event.target.value);
          }}
          readOnly={!editable}
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

const updateContentMutation = vi.fn();

function makeOrpc() {
  return {
    nodes: {
      get: {
        queryOptions: () => ({
          queryKey: ["nodes", "get", doc.node.id],
          queryFn: async () => doc,
        }),
      },
      updateContent: {
        mutationOptions: () => ({ mutationFn: updateContentMutation }),
      },
    },
  } as unknown as BusabaseQueryUtils;
}

function renderDoc() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <CoreI18nProvider locale="en">
      <QueryClientProvider client={client}>
        <div data-testid="topbar">
          <TopbarNodeActionsSlot />
        </div>
        <main data-testid="doc-body">
          <DocDetailView orpc={makeOrpc()} slug="handbook" />
        </main>
      </QueryClientProvider>
    </CoreI18nProvider>,
  );
}

async function enterEditModeAndChangeBody(topbar: HTMLElement, body: HTMLElement) {
  fireEvent.click(await within(topbar).findByRole("button", { name: "Edit" }));
  const textarea = await within(body).findByRole("textbox", { name: "Document body" });
  fireEvent.change(textarea, { target: { value: "# Handbook\n\nEdited body" } });
  return textarea;
}

afterEach(() => {
  cleanup();
  useTopbarNodeActionsStore.getState().setActions(null);
  updateContentMutation.mockReset();
  navigate.mockReset();
  editorSnapshotReads.mockReset();
  deferEditorChange.value = false;
});

describe("DocDetailView editing actions", () => {
  it.each([true, false])(
    "saves live editor content before onChange notifies React (autoMerge:%s)",
    async (autoMerge) => {
      deferEditorChange.value = true;
      updateContentMutation.mockResolvedValue({ id: "cr_snapshot" });
      renderDoc();
      const topbar = screen.getByTestId("topbar");
      const body = screen.getByTestId("doc-body");
      await enterEditModeAndChangeBody(topbar, body);
      fireEvent.change(within(body).getByRole("textbox", { name: "Document body" }), {
        target: { value: "Last keystroke before saving" },
      });
      // Live serialization is a save-time read, never an extra per-keystroke cost.
      expect(editorSnapshotReads).not.toHaveBeenCalled();
      if (autoMerge) {
        fireEvent.click(within(topbar).getByRole("button", { name: "Save Now" }));
      } else {
        fireEvent.pointerDown(within(topbar).getByRole("button", { name: "More submit options" }), {
          button: 0,
        });
        await waitFor(() => expect(screen.getByRole("menu")).toBeTruthy());
        fireEvent.click(screen.getByRole("menuitem", { name: "Save as Change Request" }));
      }
      await waitFor(() => expect(updateContentMutation).toHaveBeenCalledTimes(1));
      expect(updateContentMutation).toHaveBeenCalledWith(
        expect.objectContaining({
          content: { kind: "doc", body: "Last keystroke before saving" },
          autoMerge,
        }),
        expect.anything(),
      );
      expect(editorSnapshotReads).toHaveBeenCalledTimes(1);
    },
  );

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
    // Narrow containers only reserve the block-handle gutter for mouse users who are editing.
    expect(surface?.className).not.toContain("pointer-fine:pl-24");
    expect(await within(body).findByRole("navigation", { name: "On this page" })).toBeTruthy();

    fireEvent.click(within(screen.getByTestId("topbar")).getByRole("button", { name: "Edit" }));

    await waitFor(() => {
      expect(within(body).queryByRole("navigation", { name: "On this page" })).toBeNull();
    });
    expect(body.querySelector("[data-doc-reading-surface]")?.className).toContain(
      "pointer-fine:pl-24",
    );
  });

  it("saves an edited draft as a change request with autoMerge:false and navigates to the inbox", async () => {
    updateContentMutation.mockResolvedValue({ id: "cr_pending", status: "in_review" });
    renderDoc();
    const topbar = screen.getByTestId("topbar");
    const body = screen.getByTestId("doc-body");
    await enterEditModeAndChangeBody(topbar, body);

    fireEvent.pointerDown(within(topbar).getByRole("button", { name: "More submit options" }), {
      button: 0,
    });
    await waitFor(() => expect(screen.getByRole("menu")).toBeTruthy());
    fireEvent.click(screen.getByRole("menuitem", { name: "Save as Change Request" }));

    await waitFor(() => expect(updateContentMutation).toHaveBeenCalledTimes(1));
    expect(updateContentMutation).toHaveBeenCalledWith(
      expect.objectContaining({
        nodeId: doc.node.id,
        content: { kind: "doc", body: "# Handbook\n\nEdited body" },
        autoMerge: false,
      }),
      expect.anything(),
    );
    await waitFor(() => expect(navigate).toHaveBeenCalledWith("/inbox/cr_pending"));
  });

  it("saves an edited draft immediately with autoMerge:true", async () => {
    updateContentMutation.mockResolvedValue({ id: "cr_merged", status: "merged" });
    renderDoc();
    const topbar = screen.getByTestId("topbar");
    const body = screen.getByTestId("doc-body");
    await enterEditModeAndChangeBody(topbar, body);

    fireEvent.click(within(topbar).getByRole("button", { name: "Save Now" }));

    await waitFor(() => expect(updateContentMutation).toHaveBeenCalledTimes(1));
    expect(updateContentMutation).toHaveBeenCalledWith(
      expect.objectContaining({
        nodeId: doc.node.id,
        content: { kind: "doc", body: "# Handbook\n\nEdited body" },
        autoMerge: true,
      }),
      expect.anything(),
    );
    expect(navigate).not.toHaveBeenCalled();
    await waitFor(() => {
      expect(within(topbar).queryByRole("button", { name: "Save Now" })).toBeNull();
    });
  });
});
