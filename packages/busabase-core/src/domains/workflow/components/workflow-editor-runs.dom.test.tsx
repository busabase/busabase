// @vitest-environment jsdom
// The Runs tab as wired into the workflow editor (`graph-detail-view.tsx`):
// the Run button, the Configure/Runs tabs, the trigger event + Base pickers,
// and the selected run's highlight on the canvas step nodes.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { BusabaseQueryUtils } from "busabase-contract/api-client/react-query";
import type { NodeDetailVO } from "busabase-contract/contract/node-detail-schemas";
import type { WorkflowRun } from "busabase-contract/domains/workflow/run";
import type { ComponentType, ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CoreI18nProvider } from "../../../i18n";
import { coreMessagesByLocale } from "../../../i18n/catalog";
import { TopbarNodeActionsSlot } from "../../dashboard/components/topbar";
import {
  type DashboardVisitorKind,
  DashboardVisitorProvider,
} from "../../dashboard/visitor-context";
import { WorkflowDetailView } from "../../rich-node/components/graph-detail-view";

// Render each step through its real node component so the run highlight is
// observable; the rest of React Flow is irrelevant here.
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
      nodes,
      nodeTypes,
    }: {
      nodes: { id: string; type: string; data: unknown }[];
      nodeTypes: Record<string, ComponentType<{ id: string; data: unknown; selected: boolean }>>;
    }) => (
      <div data-testid="workflow-editor">
        {nodes.map((node) => {
          const NodeComponent = nodeTypes[node.type];
          return NodeComponent ? (
            <div data-flow-node={node.id} key={node.id}>
              <NodeComponent data={node.data} id={node.id} selected={false} />
            </div>
          ) : null;
        })}
      </div>
    ),
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
      getViewport: vi.fn(() => ({ x: 0, y: 0, zoom: 1 })),
      setViewport: vi.fn(async () => true),
    }),
  };
});

const messages = coreMessagesByLocale.en;

const workflowDetail: Extract<NodeDetailVO, { type: "workflow" }> = {
  type: "workflow",
  node: {
    parentId: null,
    explicitVisibility: null,
    position: 0,
    createdAt: "2026-10-30T00:00:00.000Z",
    updatedAt: "2026-10-30T00:00:00.000Z",
    baseId: null,
    children: [],
    id: "workflow-1",
    type: "workflow",
    slug: "lead-intake",
    name: "Lead intake",
    description: "",
    metadata: {},
  },
  document: {
    version: 2,
    nodes: [
      {
        id: "new-lead",
        kind: "trigger",
        position: { x: 0, y: 0 },
        label: "New lead",
        description: "",
        eventName: "lead.submitted",
        baseId: "",
      },
      {
        id: "cool-off",
        kind: "wait",
        position: { x: 240, y: 0 },
        label: "Cool-off",
        description: "",
        duration: 1,
        unit: "hours",
      },
    ],
    edges: [{ id: "e1", source: "new-lead", target: "cool-off", label: "", outcome: "default" }],
    settings: { executionMode: "event", concurrency: 1, timeoutMs: 30_000, errorPolicy: "stop" },
  },
};

const waitingRun: WorkflowRun = {
  id: "run-1",
  spaceId: "space-1",
  workflowNodeId: "workflow-1",
  status: "waiting",
  trigger: "manual",
  startedBy: "user-1",
  startedVia: null,
  cancelledBy: null,
  cursorNodeId: "cool-off",
  previousNodeId: "new-lead",
  outputs: {
    "new-lead": {
      kind: "trigger",
      capturedAt: "2026-10-30T10:00:00.000Z",
      record: null,
      data: { eventName: "lead.submitted", payload: {} },
    },
  },
  recordId: null,
  payload: {},
  pause: { kind: "wait", nodeId: "cool-off", resumeAt: "2026-10-30T11:00:00.000Z" },
  error: null,
  freshness: "snapshot-steps-plus-explicit-reread",
  startedAt: "2026-10-30T10:00:00.000Z",
  updatedAt: "2026-10-30T10:00:00.000Z",
};

const listRuns = vi.fn(async () => ({
  runs: [waitingRun],
  canRun: true,
  decidableRunIds: [],
  nextCursor: null,
  queuedCount: 0,
  actorNames: {},
}));
const listBases = vi.fn(async () => [{ id: "base-leads", name: "Leads" }]);

const orpc = {
  agents: {
    connections: {
      list: { queryOptions: () => ({ queryKey: ["agents"], queryFn: async () => [] }) },
    },
  },
  bases: {
    list: { queryOptions: () => ({ queryKey: ["bases", "list"], queryFn: listBases }) },
  },
  nodes: {
    get: {
      key: () => ["nodes", "get"],
      queryOptions: () => ({ queryKey: ["nodes", "get"], queryFn: async () => workflowDetail }),
    },
    list: { queryOptions: () => ({ queryKey: ["nodes", "list"] }) },
    updateContent: { mutationOptions: () => ({ mutationFn: async () => ({}) }) },
    subscription: {
      get: {
        queryOptions: () => ({ queryKey: ["nodes", "subscription"], queryFn: async () => null }),
      },
      set: { mutationOptions: () => ({ mutationFn: async () => null }) },
    },
  },
  workflows: {
    list: {
      queryOptions: ({ input }: { input: unknown }) => ({
        queryKey: ["workflows", "list", input],
        queryFn: listRuns,
      }),
    },
    start: { mutationOptions: () => ({ mutationFn: vi.fn() }) },
    resume: { mutationOptions: () => ({ mutationFn: vi.fn() }) },
    decide: { mutationOptions: () => ({ mutationFn: vi.fn() }) },
    cancel: { mutationOptions: () => ({ mutationFn: vi.fn() }) },
    cancelQueued: { mutationOptions: () => ({ mutationFn: vi.fn() }) },
  },
} as unknown as BusabaseQueryUtils;

function renderEditor(visitorKind: DashboardVisitorKind) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <CoreI18nProvider locale="en">
        <DashboardVisitorProvider visitorKind={visitorKind}>
          <WorkflowDetailView orpc={orpc} slug="workflow-1" />
          <TopbarNodeActionsSlot />
        </DashboardVisitorProvider>
      </CoreI18nProvider>
    </QueryClientProvider>,
  );
}

const stepNode = (container: HTMLElement, id: string) =>
  container.querySelector<HTMLElement>(`[data-flow-node="${id}"] > div`);

afterEach(() => {
  cleanup();
  listRuns.mockClear();
  listBases.mockClear();
  window.history.replaceState(null, "", "/");
});

describe("workflow editor Runs tab", () => {
  it("keeps a custom trigger event selectable and offers a Base only for record events", async () => {
    const { container } = renderEditor("member");
    const eventSelect = await waitFor(() => {
      const select = container.querySelector<HTMLSelectElement>("[data-workflow-trigger-event]");
      if (!select) throw new Error("trigger event select missing");
      return select;
    });
    expect([...eventSelect.options].map((option) => [option.value, option.text])).toEqual([
      ["manual", messages.richNodes.manual],
      ["record.created", messages.richNodes.eventRecordCreated],
      ["record.updated", messages.richNodes.eventRecordUpdated],
      ["lead.submitted", "lead.submitted (label only)"],
    ]);
    expect(eventSelect.value).toBe("lead.submitted");
    expect(container.querySelector("[data-workflow-trigger-base]")).toBeNull();
    expect(listBases).not.toHaveBeenCalled();

    fireEvent.change(eventSelect, { target: { value: "record.created" } });
    const baseSelect = await waitFor(() => {
      const select = container.querySelector<HTMLSelectElement>("[data-workflow-trigger-base]");
      if (!select || select.options.length < 2) throw new Error("base select not loaded");
      return select;
    });
    expect([...baseSelect.options].map((option) => [option.value, option.text])).toEqual([
      ["", messages.richNodes.anyBase],
      ["base-leads", "Leads"],
    ]);
    // The saved custom event stays available after switching away from it.
    expect([...eventSelect.options].map((option) => option.value)).toContain("lead.submitted");
    expect(stepNode(container, "new-lead")?.textContent).toContain(
      messages.richNodes.eventRecordCreated,
    );
  });

  it("opens Runs from the Run button, highlights the selected run, and clears it on Configure", async () => {
    const { container } = renderEditor("member");
    await screen.findByTestId("workflow-editor");
    expect(container.querySelector("[data-workflow-runs-panel]")).toBeNull();
    expect(listRuns).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: messages.workflowRuns.runWorkflow }));
    await waitFor(() => expect(container.querySelector("[data-workflow-run-item]")).not.toBeNull());
    expect(
      container.querySelector("[data-workflow-configuration] [data-workflow-runs-panel]"),
    ).not.toBeNull();
    await waitFor(() =>
      expect(stepNode(container, "cool-off")?.getAttribute("data-run-state")).toBe("paused"),
    );
    expect(stepNode(container, "new-lead")?.getAttribute("data-run-state")).toBe("done");
    expect(stepNode(container, "cool-off")?.textContent).toContain(
      messages.workflowRuns.stepPaused,
    );

    // Radix tabs switch on mouse down.
    fireEvent.mouseDown(
      container.querySelector("[data-workflow-aside-tab='configure']") as HTMLElement,
    );
    await waitFor(() => expect(container.querySelector("[data-workflow-runs-panel]")).toBeNull());
    expect(stepNode(container, "cool-off")?.hasAttribute("data-run-state")).toBe(false);
    expect(screen.getByLabelText(messages.richNodes.label)).not.toBeNull();
  });

  it("blocks starting a run while the canvas has unsaved edits", async () => {
    const { container } = renderEditor("member");
    const labelInput = (await screen.findByLabelText(messages.richNodes.label)) as HTMLInputElement;
    fireEvent.change(labelInput, { target: { value: "New lead (edited)" } });
    fireEvent.click(screen.getByRole("button", { name: messages.workflowRuns.runWorkflow }));
    const start = await waitFor(() => {
      const button = container.querySelector<HTMLButtonElement>("[data-workflow-run-start]");
      if (!button) throw new Error("start button missing");
      return button;
    });
    expect(start.disabled).toBe(true);
    expect(screen.getByText(messages.workflowRuns.unsavedBlocked)).not.toBeNull();
  });

  it("shows no run UI to anonymous visitors", async () => {
    const { container } = renderEditor("anonymous");
    await screen.findByTestId("workflow-editor");
    expect(screen.queryByRole("button", { name: messages.workflowRuns.runWorkflow })).toBeNull();
    expect(container.querySelector("[data-workflow-aside-tab]")).toBeNull();
    expect(container.querySelector("[data-workflow-runs-panel]")).toBeNull();
    expect(listRuns).not.toHaveBeenCalled();
  });
});
