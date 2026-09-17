// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { BusabaseQueryUtils } from "busabase-contract/api-client/react-query";
import type { NodeDetailVO } from "busabase-contract/contract/node-detail-schemas";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CoreI18nProvider, coreMessagesByLocale } from "../../../i18n";
import { isPinnableNode } from "../../dashboard/components/side-panel-sources";
import { TopbarNodeActionsSlot } from "../../dashboard/components/topbar";
import { DashboardVisitorProvider } from "../../dashboard/visitor-context";
import { WorkflowDetailView, WorkflowSidePanelPreview } from "./graph-detail-view";
import "./register";
import { WhiteboardDetailView, WhiteboardSidePanelPreview } from "./whiteboard-detail-view";

vi.mock("@excalidraw/excalidraw", async () => {
  const React = await import("react");
  return {
    Excalidraw: ({
      excalidrawAPI,
      viewModeEnabled,
    }: {
      excalidrawAPI?: (api: { scrollToContent: () => void; updateScene: () => void }) => void;
      viewModeEnabled?: boolean;
    }) => {
      const identity = React.useRef(`excalidraw-${Math.random()}`).current;
      React.useEffect(() => {
        excalidrawAPI?.({ scrollToContent: vi.fn(), updateScene: vi.fn() });
      }, [excalidrawAPI]);
      return (
        <div
          data-editor-identity={identity}
          data-testid="excalidraw-editor"
          data-view-mode={String(Boolean(viewModeEnabled))}
        />
      );
    },
    restoreElements: (elements: unknown[]) => elements,
  };
});

vi.mock("@xyflow/react", async () => {
  const React = await import("react");
  return {
    addEdge: (edge: unknown, edges: unknown[]) => [...edges, edge],
    Background: () => null,
    BackgroundVariant: { Dots: "dots" },
    Controls: () => null,
    Handle: () => null,
    Position: { Left: "left", Right: "right" },
    ReactFlow: ({
      children,
      edges,
      nodes,
      nodesConnectable,
      nodesDraggable,
    }: {
      children?: ReactNode;
      edges: unknown[];
      nodes: unknown[];
      nodesConnectable: boolean;
      nodesDraggable: boolean;
    }) => {
      const identity = React.useRef(`workflow-${Math.random()}`).current;
      return (
        <div
          data-connectable={String(nodesConnectable)}
          data-draggable={String(nodesDraggable)}
          data-edge-count={edges.length}
          data-editor-identity={identity}
          data-node-count={nodes.length}
          data-testid="workflow-editor"
        >
          {children}
        </div>
      );
    },
    ReactFlowProvider: ({ children }: { children: ReactNode }) => children,
    useEdgesState: (initial: unknown[]) => {
      const [edges, setEdges] = React.useState(initial);
      return [edges, setEdges, vi.fn()] as const;
    },
    useNodesState: (initial: unknown[]) => {
      const [nodes, setNodes] = React.useState(initial);
      return [nodes, setNodes, vi.fn()] as const;
    },
    useReactFlow: () => ({
      fitView: vi.fn(async () => true),
      getViewport: vi.fn(() => ({ x: 0, y: 0, zoom: 0.4 })),
      setViewport: vi.fn(async () => true),
    }),
  };
});

const baseNode = {
  parentId: "visual-tools",
  explicitVisibility: null,
  position: 0,
  createdAt: "2026-09-16T00:00:00.000Z",
  updatedAt: "2026-09-16T00:00:00.000Z",
  baseId: null,
  children: [],
};

const whiteboardDetail: Extract<NodeDetailVO, { type: "whiteboard" }> = {
  type: "whiteboard",
  node: {
    ...baseNode,
    id: "whiteboard-1",
    type: "whiteboard",
    slug: "product-launch-whiteboard",
    name: "Product Launch Whiteboard",
    description: "Goals, owners, and launch questions.",
    metadata: {},
  },
  document: {
    version: 1,
    elements: [{ id: "goal", type: "rectangle" }],
    appState: {},
  },
};

const workflowDetail: Extract<NodeDetailVO, { type: "workflow" }> = {
  type: "workflow",
  node: {
    ...baseNode,
    id: "workflow-1",
    type: "workflow",
    slug: "lead-intake-workflow",
    name: "Lead Intake Workflow",
    description: "A webhook-to-review process.",
    metadata: {},
  },
  document: {
    version: 2,
    nodes: [
      {
        id: "new-lead",
        kind: "trigger",
        position: { x: 0, y: 80 },
        label: "New lead",
        description: "Start from a form.",
        eventName: "lead.submitted",
      },
    ],
    edges: [],
    settings: {
      executionMode: "manual",
      concurrency: 1,
      timeoutMs: 30_000,
      errorPolicy: "stop",
    },
  },
};

const agents = {
  connections: {
    list: { queryOptions: () => ({ queryKey: ["agents"], queryFn: async () => [] }) },
  },
};

const orpc = {
  agents,
  nodes: {
    get: {
      queryOptions: ({ input }: { input: { type: string } }) => ({
        queryKey: ["nodes", input.type],
        queryFn: async () => (input.type === "whiteboard" ? whiteboardDetail : workflowDetail),
      }),
    },
    updateContent: {
      mutationOptions: () => ({ mutationFn: async () => ({}) }),
    },
  },
} as unknown as BusabaseQueryUtils;

function Providers({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <QueryClientProvider client={client}>
      <CoreI18nProvider locale="en">
        <DashboardVisitorProvider visitorKind="member">{children}</DashboardVisitorProvider>
      </CoreI18nProvider>
    </QueryClientProvider>
  );
}

afterEach(() => {
  cleanup();
  window.history.replaceState(null, "", "/");
});

describe("visual node preview parity", () => {
  it("keeps the same Whiteboard editor mounted through URL-backed fullscreen", async () => {
    window.history.replaceState(null, "", "/whiteboard/product-launch-whiteboard?demo=node-types");
    const messages = coreMessagesByLocale.en;
    const { container } = render(
      <Providers>
        <WhiteboardDetailView orpc={orpc} slug={whiteboardDetail.node.id} />
        <TopbarNodeActionsSlot />
      </Providers>,
    );

    const editor = await screen.findByTestId("excalidraw-editor");
    const identity = editor.getAttribute("data-editor-identity");
    expect(editor.getAttribute("data-view-mode")).toBe("false");
    expect(screen.getByRole("heading", { name: whiteboardDetail.node.name })).not.toBeNull();
    expect(screen.getByRole("button", { name: messages.nodeDetail.details })).not.toBeNull();

    fireEvent.click(screen.getByRole("button", { name: messages.airapp.enterFullscreen }));
    await waitFor(() =>
      expect(
        container.querySelector(
          '[data-visual-node-preview="whiteboard"][data-preview-fullscreen="true"]',
        ),
      ).not.toBeNull(),
    );
    expect(screen.getByTestId("excalidraw-editor").getAttribute("data-editor-identity")).toBe(
      identity,
    );
    expect(window.location.search).toContain("demo=node-types");
    expect(window.location.search).toContain("fullscreen=1");

    fireEvent.click(screen.getByRole("button", { name: messages.airapp.exitFullscreen }));
    await waitFor(() => expect(window.location.search).not.toContain("fullscreen=1"));
    expect(screen.getByTestId("excalidraw-editor").getAttribute("data-editor-identity")).toBe(
      identity,
    );
    expect(screen.getByRole("button", { name: messages.nodeDetail.pinToSidePanel })).not.toBeNull();
  });

  it("focuses the Workflow canvas in fullscreen and restores its selected configuration", async () => {
    window.history.replaceState(null, "", "/workflow/lead-intake-workflow?demo=node-types");
    const messages = coreMessagesByLocale.en;
    const { container } = render(
      <Providers>
        <WorkflowDetailView orpc={orpc} slug={workflowDetail.node.id} />
        <TopbarNodeActionsSlot />
      </Providers>,
    );

    const editor = await screen.findByTestId("workflow-editor");
    const identity = editor.getAttribute("data-editor-identity");
    const configuration = container.querySelector<HTMLElement>("[data-workflow-configuration]");
    expect(configuration?.className).not.toContain("hidden");
    expect((screen.getByLabelText(messages.richNodes.label) as HTMLInputElement).value).toBe(
      "New lead",
    );

    fireEvent.click(screen.getByRole("button", { name: messages.airapp.enterFullscreen }));
    await waitFor(() => expect(configuration?.className).toContain("hidden"));
    expect(screen.getByTestId("workflow-editor").getAttribute("data-editor-identity")).toBe(
      identity,
    );
    expect(screen.getByTestId("workflow-editor").getAttribute("data-node-count")).toBe("1");

    fireEvent.click(screen.getByRole("button", { name: messages.airapp.exitFullscreen }));
    await waitFor(() => expect(configuration?.className).not.toContain("hidden"));
    expect((screen.getByLabelText(messages.richNodes.label) as HTMLInputElement).value).toBe(
      "New lead",
    );
    expect(screen.getByTestId("workflow-editor").getAttribute("data-editor-identity")).toBe(
      identity,
    );
  });

  it("renders local-fullscreen read-only Side Panel previews without changing the main URL", async () => {
    window.history.replaceState(null, "", "/dashboard/local/home?demo=node-types");
    const messages = coreMessagesByLocale.en;
    const whiteboard = render(
      <Providers>
        <WhiteboardSidePanelPreview orpc={orpc} payload={{ nodeId: "whiteboard-1" }} />
      </Providers>,
    );
    const whiteboardEditor = await screen.findByTestId("excalidraw-editor");
    const whiteboardIdentity = whiteboardEditor.getAttribute("data-editor-identity");
    expect(whiteboardEditor.getAttribute("data-view-mode")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: messages.airapp.enterFullscreen }));
    await waitFor(() =>
      expect(
        whiteboard.container.querySelector(
          '[data-visual-node-preview="whiteboard"][data-preview-fullscreen="true"]',
        ),
      ).not.toBeNull(),
    );
    expect(screen.getByTestId("excalidraw-editor").getAttribute("data-editor-identity")).toBe(
      whiteboardIdentity,
    );
    expect(window.location.search).toBe("?demo=node-types");
    whiteboard.unmount();

    const workflow = render(
      <Providers>
        <WorkflowSidePanelPreview orpc={orpc} payload={{ nodeId: "workflow-1" }} />
      </Providers>,
    );
    const workflowEditor = await screen.findByTestId("workflow-editor");
    const workflowIdentity = workflowEditor.getAttribute("data-editor-identity");
    expect(workflowEditor.getAttribute("data-draggable")).toBe("false");
    expect(workflowEditor.getAttribute("data-connectable")).toBe("false");
    fireEvent.click(screen.getByRole("button", { name: messages.airapp.enterFullscreen }));
    await waitFor(() =>
      expect(
        workflow.container.querySelector(
          '[data-visual-node-preview="workflow"][data-preview-fullscreen="true"]',
        ),
      ).not.toBeNull(),
    );
    expect(screen.getByTestId("workflow-editor").getAttribute("data-editor-identity")).toBe(
      workflowIdentity,
    );
    expect(window.location.search).toBe("?demo=node-types");
  });

  it("registers Whiteboard and Workflow as pinnable nodes", () => {
    expect(isPinnableNode("whiteboard")).toBe(true);
    expect(isPinnableNode("workflow")).toBe(true);
  });
});
