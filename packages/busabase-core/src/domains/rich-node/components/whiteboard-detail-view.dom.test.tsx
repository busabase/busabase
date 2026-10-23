// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { BusabaseQueryUtils } from "busabase-contract/api-client/react-query";
import type { NodeDetailVO } from "busabase-contract/contract/node-detail-schemas";
import type { WhiteboardDocument } from "busabase-contract/domains/rich-node/types";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WhiteboardDetailView } from "./whiteboard-detail-view";

const canvasApi = vi.hoisted(() => ({ scrollToContent: vi.fn(), updateScene: vi.fn() }));

vi.mock("@excalidraw/excalidraw", () => ({
  Excalidraw: ({
    excalidrawAPI,
    initialData,
    onChange,
  }: {
    excalidrawAPI: (api: typeof canvasApi) => void;
    initialData: WhiteboardDocument;
    onChange: (elements: unknown[], appState: object) => void;
  }) => {
    const [elements, setElements] = useState(initialData.elements);
    const [apiReady, setApiReady] = useState(false);
    const changeRef = useRef(onChange);
    changeRef.current = onChange;
    useEffect(() => {
      excalidrawAPI(canvasApi);
      // Let the parent's API-dependent mount effects settle before simulating
      // input, just as the real canvas finishes mounting before a user draws.
      const ready = setTimeout(() => setApiReady(true), 0);
      return () => clearTimeout(ready);
    }, [excalidrawAPI]);
    useEffect(() => {
      changeRef.current(elements, {});
    }, [elements]);
    return (
      <>
        <button
          type="button"
          disabled={!apiReady}
          onClick={() =>
            setElements([...elements, { id: `shape-${elements.length}`, type: "rectangle" }])
          }
        >
          Draw shape ({elements.length})
        </button>
        <button type="button" onClick={() => onChange(elements, {})}>
          Refresh scene
        </button>
      </>
    );
  },
}));

vi.mock("./rich-node-shell", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./rich-node-shell")>();
  return {
    ...actual,
    RichNodeShell: ({
      children,
      onSave,
      status,
    }: {
      children: ReactNode;
      onSave: () => void;
      status: string;
    }) => (
      <div>
        <span data-testid="save-status">{status}</span>
        <button type="button" onClick={onSave} disabled={status === "saving" || status === "saved"}>
          Save board
        </button>
        {children}
      </div>
    ),
  };
});

const detail = (id: string): Extract<NodeDetailVO, { type: "whiteboard" }> => ({
  type: "whiteboard",
  node: {
    id,
    parentId: null,
    type: "whiteboard",
    slug: id,
    name: id,
    description: "",
    metadata: {},
    explicitVisibility: null,
    position: 0,
    createdAt: "2026-10-22T00:00:00.000Z",
    updatedAt: "2026-10-22T00:00:00.000Z",
    baseId: null,
    children: [],
  },
  document: { version: 1, elements: [], appState: {} },
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("WhiteboardDetailView sessions", () => {
  it("starts a cached second board with a fresh saved baseline and saves that board's first edit", async () => {
    const boards = { "board-a": detail("board-a"), "board-b": detail("board-b") };
    let finishSave!: () => void;
    const pendingSave = new Promise<void>((resolve) => {
      finishSave = resolve;
    });
    const mutation = vi.fn(
      async (input: { nodeId: keyof typeof boards; content: { document: WhiteboardDocument } }) => {
        await pendingSave;
        boards[input.nodeId] = { ...boards[input.nodeId], document: input.content.document };
        return { id: "board-save", status: "merged" };
      },
    );
    const orpc = {
      nodes: {
        get: {
          key: () => ["nodes", "get"],
          queryOptions: ({ input }: { input: { nodeId: keyof typeof boards } }) => ({
            queryKey: ["nodes", "get", input],
            queryFn: async () => boards[input.nodeId],
          }),
        },
        list: { queryOptions: () => ({ queryKey: ["nodes", "list"] }) },
        updateContent: { mutationOptions: () => ({ mutationFn: mutation }) },
      },
    } as unknown as BusabaseQueryUtils;
    const client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity } } });
    for (const board of Object.values(boards)) {
      client.setQueryData(
        orpc.nodes.get.queryOptions({ input: { nodeId: board.node.id, type: "whiteboard" } })
          .queryKey,
        board,
      );
    }
    const view = (slug: string) => (
      <QueryClientProvider client={client}>
        <WhiteboardDetailView orpc={orpc} slug={slug} />
      </QueryClientProvider>
    );
    const { rerender } = render(view("board-a"));
    const firstBoardDraw = await screen.findByRole("button", { name: "Draw shape (0)" });
    await waitFor(() => expect(firstBoardDraw.hasAttribute("disabled")).toBe(false));
    fireEvent.click(firstBoardDraw);
    expect(screen.getByTestId("save-status").textContent).toBe("dirty");
    rerender(view("board-b"));
    const secondBoardDraw = await screen.findByRole("button", { name: "Draw shape (0)" });
    await waitFor(() => expect(secondBoardDraw.hasAttribute("disabled")).toBe(false));
    expect(screen.getByTestId("save-status").textContent).toBe("saved");
    fireEvent.click(screen.getByRole("button", { name: "Draw shape (0)" }));
    expect(screen.getByTestId("save-status").textContent).toBe("dirty");
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Save board" })));
    await waitFor(() => expect(mutation).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole("button", { name: "Refresh scene" }));
    await act(async () => {
      finishSave();
      await pendingSave;
    });
    await waitFor(() => expect(screen.getByTestId("save-status").textContent).toBe("saved"));
    // The save refetch adds the first persisted element. It must not fit/zoom
    // the author's viewport as if another person replaced the scene.
    expect(canvasApi.scrollToContent).not.toHaveBeenCalled();
    expect(mutation.mock.calls[0]?.[0]).toMatchObject({
      nodeId: "board-b",
      content: { document: { elements: [{ id: "shape-0", type: "rectangle" }] } },
    });
  });
});
