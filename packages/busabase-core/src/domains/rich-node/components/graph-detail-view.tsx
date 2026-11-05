"use client";

import {
  addEdge,
  Background,
  BackgroundVariant,
  Controls,
  type Edge,
  type EdgeChange,
  Handle,
  type Node,
  type NodeChange,
  type NodeProps,
  Position,
  ReactFlow,
  type ReactFlowProps,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
  useReactFlow,
  type Viewport,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useQuery } from "@tanstack/react-query";
import type { BusabaseQueryUtils } from "busabase-contract/api-client/react-query";
import type {
  WorkflowDocument,
  WorkflowEdge,
  WorkflowNode,
  WorkflowSettings,
} from "busabase-contract/domains/rich-node/types";
import { isWorkflowRecordEvent } from "busabase-contract/domains/workflow/run";
import type { NodeVO } from "busabase-contract/types";
import { Button } from "kui/button";
import { Input } from "kui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "kui/tabs";
import { Textarea } from "kui/textarea";
import {
  Braces,
  CircleDot,
  CircleStop,
  Clock3,
  GitBranch,
  Info,
  Play,
  Plus,
  Trash2,
  UserCheck,
  Webhook,
  Zap,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { type CoreI18nMessages, fmt, useCoreI18n } from "../../../i18n";
import { getGraphAriaLabels } from "../../../i18n/graph-aria";
import {
  FullscreenPreviewSurface,
  PREVIEW_DETAIL_TAB_LIST_CLASS,
  PREVIEW_DETAIL_TAB_TRIGGER_CLASS,
  PreviewFullscreenButton,
  type PreviewFullscreenState,
  usePreviewFullscreen,
} from "../../dashboard/components/preview-fullscreen";
import { NodeDetailSkeleton } from "../../dashboard/components/skeletons";
import { asNodeDetail } from "../../dashboard/helpers/node-detail";
import { useReportLoadedNode } from "../../dashboard/hooks/use-report-loaded-node";
import type { NodeDetailProps } from "../../dashboard/node-detail-registry";
import type { SidePanelTabProps } from "../../dashboard/side-panel-registry";
import { useIsAnonymousVisitor } from "../../dashboard/visitor-context";
import {
  WorkflowActionSettings,
  WorkflowStepReference,
  workflowActionLabel,
} from "../../workflow/components/workflow-action-settings";
import {
  useWorkflowRunStepState,
  WorkflowRunHighlightContext,
} from "../../workflow/components/workflow-run-highlight";
import { WorkflowRunsPanel } from "../../workflow/components/workflow-runs-panel";
import { WorkflowTriggerBasePicker } from "../../workflow/components/workflow-trigger-base-picker";
import type { WorkflowRunStepState } from "../../workflow/utils/run-view";
import { parseWorkflowRunLink } from "../../workflow/utils/run-view";
import {
  RichNodeNotFound,
  RichNodeShell,
  useNodeContentSave,
  useServerDocumentSync,
} from "./rich-node-shell";

type WorkflowNodeKind = WorkflowNode["kind"];
interface WorkflowNodeFields {
  kind: WorkflowNodeKind;
  label: string;
  description: string;
  eventName: string;
  /** Trigger only: limits a record event to one Base. `""` means any Base. */
  baseId: string;
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  url: string;
  webhookRuleId: string;
  functionName: string;
  expression: string;
  duration: number;
  unit: "minutes" | "hours" | "days";
  approver: string;
  allowAgents: boolean;
  actionName: string;
  /** For record-writing actions. Kept as an object; the editor owns the JSON text. */
  fields: Record<string, unknown>;
  targetRecordId: string;
  outcome: string;
}
type WorkflowNodeData = WorkflowNodeFields & Record<string, unknown>;
type WorkflowNodePatch = Partial<WorkflowNodeFields>;
type WorkflowFlowNode = Node<WorkflowNodeData, "workflowStep">;

const workflowIcon = {
  trigger: CircleDot,
  webhook: Webhook,
  function: Braces,
  condition: GitBranch,
  wait: Clock3,
  approval: UserCheck,
  action: Zap,
  end: CircleStop,
};

const WORKFLOW_NODE_KINDS: WorkflowNodeKind[] = [
  "trigger",
  "webhook",
  "function",
  "condition",
  "wait",
  "approval",
  "action",
  "end",
];

const triggerEventLabel = (eventName: string, messages: CoreI18nMessages): string =>
  !eventName || eventName === "manual"
    ? messages.richNodes.manual
    : eventName === "record.created"
      ? messages.richNodes.eventRecordCreated
      : eventName === "record.updated"
        ? messages.richNodes.eventRecordUpdated
        : eventName;

const workflowNodeSummary = (data: WorkflowNodeData, messages: CoreI18nMessages): string => {
  switch (data.kind) {
    case "trigger":
      return triggerEventLabel(data.eventName, messages);
    case "webhook":
      return `${data.method} ${data.url || messages.richNodes.webhook}`;
    case "function":
      return data.functionName || data.webhookRuleId || messages.richNodes.function;
    case "condition":
      return data.expression || data.description || messages.richNodes.condition;
    case "wait":
      return `${data.duration} ${messages.richNodes[data.unit]}`;
    case "approval":
      return data.approver || messages.richNodes.approval;
    case "action":
      return (
        workflowActionLabel(data.actionName, messages) ||
        data.description ||
        messages.richNodes.action
      );
    case "end":
      return data.outcome && data.outcome !== "completed"
        ? data.outcome
        : messages.richNodes.completed;
  }
};

// Run highlight frames win over the plain selection frame so a failed or
// paused step stays visible while it is selected.
const RUN_STATE_FRAME: Record<WorkflowRunStepState, string> = {
  done: "border-primary/60 ring-2 ring-primary/25",
  paused: "border-dashed border-primary ring-2 ring-primary/40",
  failed: "border-destructive ring-2 ring-destructive/30",
};

const RUN_STATE_CHIP: Record<WorkflowRunStepState, string> = {
  done: "bg-primary/10 text-primary",
  paused: "bg-muted text-foreground",
  failed: "bg-destructive/10 text-destructive",
};

const runStateLabel = (state: WorkflowRunStepState, messages: CoreI18nMessages) =>
  state === "done"
    ? messages.workflowRuns.stepDone
    : state === "paused"
      ? messages.workflowRuns.stepPaused
      : messages.workflowRuns.stepFailed;

function WorkflowStepNode({ data, id, selected }: NodeProps<WorkflowFlowNode>) {
  const messages = useCoreI18n();
  const runState = useWorkflowRunStepState(id);
  const Icon = workflowIcon[data.kind];
  return (
    <div
      className={`w-56 border bg-card shadow-sm ${
        runState
          ? `${RUN_STATE_FRAME[runState]}${selected ? " shadow-md" : ""}`
          : selected
            ? "border-primary ring-2 ring-primary/15"
            : "border-border"
      }`}
      data-run-state={runState ?? undefined}
    >
      <Handle
        className="!size-2.5 !border-background !bg-muted-foreground"
        position={Position.Left}
        type="target"
      />
      <div className="flex h-10 items-center gap-2 border-border/60 border-b px-3">
        <Icon className="size-3.5 shrink-0 text-primary" />
        <span className="min-w-0 flex-1 truncate font-medium text-card-foreground text-xs">
          {data.label}
        </span>
        <span className="text-[10px] text-muted-foreground">{messages.richNodes[data.kind]}</span>
      </div>
      <div className="flex min-h-9 items-center gap-2 px-3 py-2 text-muted-foreground text-xs">
        <span className="min-w-0 flex-1 truncate">{workflowNodeSummary(data, messages)}</span>
        {runState ? (
          <span
            className={`shrink-0 px-1.5 py-0.5 font-medium text-[10px] leading-none ${RUN_STATE_CHIP[runState]}`}
          >
            {runStateLabel(runState, messages)}
          </span>
        ) : null}
      </div>
      <Handle
        className="!size-2.5 !border-background !bg-primary"
        position={Position.Right}
        type="source"
      />
    </div>
  );
}

const nodeTypes = { workflowStep: WorkflowStepNode };

const EMPTY_RUN_HIGHLIGHT: ReadonlyMap<string, WorkflowRunStepState> = new Map();

type WorkflowCanvasCallbacks = Pick<
  ReactFlowProps<WorkflowFlowNode, Edge>,
  "onConnect" | "onEdgeClick" | "onEdgesChange" | "onNodeClick" | "onNodesChange" | "onPaneClick"
>;

function WorkflowCanvas({
  edges,
  nodes,
  readOnly,
  ...callbacks
}: WorkflowCanvasCallbacks & {
  edges: Edge[];
  nodes: WorkflowFlowNode[];
  readOnly: boolean;
}) {
  const messages = useCoreI18n();
  return (
    <div
      className="h-full min-h-0 bg-muted/20"
      data-read-only={readOnly ? "true" : "false"}
      data-workflow-canvas=""
    >
      <ReactFlow
        ariaLabelConfig={getGraphAriaLabels(messages)}
        colorMode="system"
        connectOnClick={!readOnly}
        deleteKeyCode={readOnly ? null : ["Backspace", "Delete"]}
        edges={edges}
        edgesReconnectable={!readOnly}
        elementsSelectable
        fitView
        maxZoom={1.8}
        minZoom={readOnly ? 0.4 : 0.2}
        nodesConnectable={!readOnly}
        nodesDraggable={!readOnly}
        nodeTypes={nodeTypes}
        nodes={nodes}
        proOptions={{ hideAttribution: true }}
        {...callbacks}
      >
        <Background gap={20} size={1} variant={BackgroundVariant.Dots} />
        <Controls showInteractive={false} />
      </ReactFlow>
    </div>
  );
}

const newId = (prefix: string) =>
  `${prefix}-${typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : Date.now()}`;

const toWorkflowEdges = (edges: WorkflowEdge[]): Edge[] =>
  edges.map((edge) => ({
    id: edge.id,
    source: edge.source,
    target: edge.target,
    type: "smoothstep",
    animated: false,
    label: edge.label || undefined,
    data: { outcome: edge.outcome },
  }));

const persistedWorkflowEdges = (edges: Edge[]): WorkflowEdge[] =>
  edges.map((edge) => ({
    id: edge.id,
    source: edge.source,
    target: edge.target,
    label: typeof edge.label === "string" ? edge.label : "",
    outcome:
      typeof edge.data?.outcome === "string" && edge.data.outcome ? edge.data.outcome : "default",
  }));

const workflowNodeData = (node: WorkflowNode): WorkflowNodeData => ({
  kind: node.kind,
  label: node.label,
  description: node.description,
  eventName: node.kind === "trigger" ? node.eventName : "",
  // Graphs saved before Base filters existed carry no `baseId`.
  baseId: node.kind === "trigger" || node.kind === "action" ? (node.baseId ?? "") : "",
  method: node.kind === "webhook" ? node.method : "POST",
  url: node.kind === "webhook" ? node.url : "",
  webhookRuleId: node.kind === "function" ? node.webhookRuleId : "",
  functionName: node.kind === "function" ? node.functionName : "",
  expression: node.kind === "condition" ? node.expression : "",
  duration: node.kind === "wait" ? node.duration : 1,
  unit: node.kind === "wait" ? node.unit : "hours",
  approver: node.kind === "approval" ? node.approver : "",
  allowAgents: node.kind === "approval" ? (node.allowAgents ?? false) : false,
  actionName: node.kind === "action" ? node.actionName : "",
  // Graphs saved before record-writing actions carry neither.
  fields: node.kind === "action" ? (node.fields ?? {}) : {},
  targetRecordId: node.kind === "action" ? (node.targetRecordId ?? "") : "",
  outcome: node.kind === "end" ? node.outcome : "completed",
});

const persistedWorkflowNode = (
  entry: WorkflowFlowNode,
  messages: CoreI18nMessages,
): WorkflowNode => {
  const data = entry.data;
  const base = {
    id: entry.id,
    position: entry.position,
    label: data.label.trim() || messages.richNodes.untitledStep,
    description: data.description,
  };
  switch (data.kind) {
    case "trigger":
      return { ...base, kind: data.kind, eventName: data.eventName, baseId: data.baseId };
    case "webhook":
      return { ...base, kind: data.kind, method: data.method, url: data.url };
    case "function":
      return {
        ...base,
        kind: data.kind,
        webhookRuleId: data.webhookRuleId,
        functionName: data.functionName,
      };
    case "condition":
      return { ...base, kind: data.kind, expression: data.expression };
    case "wait":
      return { ...base, kind: data.kind, duration: data.duration, unit: data.unit };
    case "approval":
      return {
        ...base,
        kind: data.kind,
        approver: data.approver,
        allowAgents: data.allowAgents,
      };
    case "action":
      return {
        ...base,
        kind: data.kind,
        actionName: data.actionName,
        fields: data.fields,
        targetRecordId: data.targetRecordId,
        baseId: data.baseId,
      };
    case "end":
      return { ...base, kind: data.kind, outcome: data.outcome };
  }
};

interface GraphEditorProps {
  document: WorkflowDocument;
  node: NodeVO;
  orpc: BusabaseQueryUtils;
}

function GraphEditor({ document: workflowDocument, node, orpc }: GraphEditorProps) {
  const messages = useCoreI18n();
  const isAnonymous = useIsAnonymousVisitor();
  const fullscreenState = usePreviewFullscreen({ syncWithUrl: true });
  const initialNodes = useMemo<WorkflowFlowNode[]>(
    () =>
      workflowDocument.nodes.map((workflowNode) => ({
        id: workflowNode.id,
        type: "workflowStep" as const,
        position: workflowNode.position,
        data: workflowNodeData(workflowNode),
      })),
    [workflowDocument.nodes],
  );
  const initialEdges = useMemo(
    () => toWorkflowEdges(workflowDocument.edges),
    [workflowDocument.edges],
  );
  const [nodes, setNodes, applyNodeChanges] = useNodesState<WorkflowFlowNode>(initialNodes);
  const [edges, setEdges, applyEdgeChanges] = useEdgesState(initialEdges);
  const [selectedId, setSelectedId] = useState<string | null>(nodes[0]?.id ?? null);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [workflowSettings, setWorkflowSettings] = useState<WorkflowSettings>(
    workflowDocument.settings,
  );
  const [asideTab, setAsideTab] = useState<"configure" | "runs">("configure");
  // A notification about a run links here with a fragment: open on the Runs tab.
  useEffect(() => {
    const follow = () => {
      if (parseWorkflowRunLink(window.location.hash).openRuns) setAsideTab("runs");
    };
    follow();
    window.addEventListener("hashchange", follow);
    return () => window.removeEventListener("hashchange", follow);
  }, []);
  // Step states of the run picked in the Runs panel. Kept out of React Flow
  // node data on purpose: node data is what gets saved as `graph.json`.
  const [runHighlight, setRunHighlight] = useState<ReadonlyMap<
    string,
    WorkflowRunStepState
  > | null>(null);
  // Runs execute the saved graph, so name their steps from it too.
  const savedSteps = useMemo(
    () => workflowDocument.nodes.map((entry) => ({ id: entry.id, label: entry.label })),
    [workflowDocument.nodes],
  );
  const { error, markDirty, reviewRequestId, save, status } = useNodeContentSave(
    orpc,
    node,
    "workflow",
  );
  // React Flow's `useNodesState`/`useEdgesState` (and `workflowSettings`) are
  // seeded from the server document only at mount, so a workflow edited
  // elsewhere — another tab, an agent's OpenAPI write — used to stay stale on
  // screen until a full page reload.
  useServerDocumentSync({
    apply: (document: WorkflowDocument) => {
      setNodes(
        document.nodes.map((workflowNode) => ({
          id: workflowNode.id,
          type: "workflowStep" as const,
          position: workflowNode.position,
          data: workflowNodeData(workflowNode),
        })),
      );
      setEdges(toWorkflowEdges(document.edges));
      setWorkflowSettings(document.settings);
      // Selections can point at steps/edges the incoming document dropped.
      setSelectedId(document.nodes[0]?.id ?? null);
      setSelectedEdgeId(null);
    },
    getLocalDocument: () => ({
      version: 2 as const,
      nodes: nodes.map((entry) => persistedWorkflowNode(entry, messages)),
      edges: persistedWorkflowEdges(edges),
      settings: workflowSettings,
    }),
    node,
    serverDocument: workflowDocument,
    status,
  });
  const selectedNode = nodes.find((entry) => entry.id === selectedId) ?? null;
  const selectedEdge = edges.find((entry) => entry.id === selectedEdgeId) ?? null;
  // A trigger's event name that is neither Manual nor a record event (demo
  // graphs use e.g. `lead.submitted`) stays a selectable option — both the
  // current value and the saved one, so switching away and back loses nothing.
  const savedSelectedNode = workflowDocument.nodes.find((entry) => entry.id === selectedId);
  const customTriggerEvent =
    selectedNode?.data.kind === "trigger"
      ? ([
          selectedNode.data.eventName,
          savedSelectedNode?.kind === "trigger" ? savedSelectedNode.eventName : "",
        ].find((name) => name !== "" && name !== "manual" && !isWorkflowRecordEvent(name)) ?? null)
      : null;

  const onNodesChange = useCallback(
    (changes: NodeChange<WorkflowFlowNode>[]) => {
      applyNodeChanges(changes);
      if (changes.some((change) => change.type === "position" || change.type === "remove"))
        markDirty();
    },
    [applyNodeChanges, markDirty],
  );

  const onEdgesChange = useCallback(
    (changes: EdgeChange<Edge>[]) => {
      applyEdgeChanges(changes);
      if (changes.some((change) => change.type === "add" || change.type === "remove")) markDirty();
    },
    [applyEdgeChanges, markDirty],
  );

  const addNode = () => {
    // Short, because people write this id in formulas.
    let id = newId("step").slice(0, 13);
    while (nodes.some((node) => node.id === id)) id = newId("step").slice(0, 13);
    const position = { x: nodes.length * 56, y: nodes.length * 72 };
    const next: WorkflowFlowNode = {
      id,
      type: "workflowStep",
      position,
      data: {
        kind: "webhook",
        label: fmt(messages.richNodes.stepNumber, { number: nodes.length + 1 }),
        description: "",
        eventName: "manual",
        baseId: "",
        method: "POST",
        url: "",
        webhookRuleId: "",
        functionName: "",
        expression: "",
        duration: 1,
        unit: "hours",
        approver: "",
        allowAgents: false,
        actionName: "",
        fields: {},
        targetRecordId: "",
        outcome: "completed",
      },
    };
    setNodes((current) => [...current, next]);
    setSelectedId(id);
    setSelectedEdgeId(null);
    markDirty();
  };

  const deleteSelected = () => {
    if (selectedEdgeId) {
      setEdges((current) => current.filter((edge) => edge.id !== selectedEdgeId));
      setSelectedEdgeId(null);
    } else if (selectedId) {
      setNodes((current) => current.filter((entry) => entry.id !== selectedId));
      setEdges((current) =>
        current.filter((edge) => edge.source !== selectedId && edge.target !== selectedId),
      );
      setSelectedId(null);
    } else {
      return;
    }
    markDirty();
  };

  const updateSelected = (patch: WorkflowNodePatch) => {
    if (!selectedId) return;
    setNodes((current) =>
      current.map((entry) => {
        if (entry.id !== selectedId) return entry;
        const kind =
          patch.kind && WORKFLOW_NODE_KINDS.includes(patch.kind) ? patch.kind : entry.data.kind;
        const method = ["GET", "POST", "PUT", "PATCH", "DELETE"].includes(patch.method ?? "")
          ? (patch.method as WorkflowNodeData["method"])
          : entry.data.method;
        return {
          ...entry,
          data: {
            ...entry.data,
            kind,
            method,
            label: patch.label ?? entry.data.label,
            description: patch.description ?? entry.data.description,
            eventName: patch.eventName ?? entry.data.eventName,
            baseId: patch.baseId ?? entry.data.baseId,
            url: patch.url ?? entry.data.url,
            webhookRuleId: patch.webhookRuleId ?? entry.data.webhookRuleId,
            functionName: patch.functionName ?? entry.data.functionName,
            expression: patch.expression ?? entry.data.expression,
            duration: typeof patch.duration === "number" ? patch.duration : entry.data.duration,
            unit:
              patch.unit === "minutes" || patch.unit === "hours" || patch.unit === "days"
                ? patch.unit
                : entry.data.unit,
            approver: patch.approver ?? entry.data.approver,
            allowAgents: patch.allowAgents ?? entry.data.allowAgents,
            actionName: patch.actionName ?? entry.data.actionName,
            fields: patch.fields ?? entry.data.fields,
            targetRecordId: patch.targetRecordId ?? entry.data.targetRecordId,
            outcome: patch.outcome ?? entry.data.outcome,
          },
        };
      }),
    );
    markDirty();
  };

  const updateSelectedEdge = (patch: { label?: string; outcome?: string }) => {
    if (!selectedEdgeId) return;
    setEdges((current) =>
      current.map((edge) =>
        edge.id === selectedEdgeId
          ? {
              ...edge,
              label: patch.label ?? edge.label,
              data: { ...edge.data, outcome: patch.outcome ?? edge.data?.outcome ?? "default" },
            }
          : edge,
      ),
    );
    markDirty();
  };

  const updateWorkflowSettings = (patch: Partial<WorkflowSettings>) => {
    setWorkflowSettings((current) => ({ ...current, ...patch }));
    markDirty();
  };

  const openRuns = () => {
    if (fullscreenState.fullscreen) fullscreenState.setFullscreen(false);
    setAsideTab("runs");
  };

  const saveGraph = () => {
    const document: WorkflowDocument = {
      version: 2,
      nodes: nodes.map((entry) => persistedWorkflowNode(entry, messages)),
      edges: persistedWorkflowEdges(edges),
      settings: workflowSettings,
    };
    save(document);
  };

  return (
    <RichNodeShell
      reviewRequestId={reviewRequestId}
      actions={
        <>
          {/* Icon-only, like the rest of this cluster. A visible label used to
              sit inside this fixed-size square and spill over the save status
              and the delete button; giving it real width instead squeezes the
              breadcrumb out whenever the side panel is open. */}
          {isAnonymous ? null : (
            <Button
              aria-label={messages.workflowRuns.runWorkflow}
              className="size-7 sm:size-8"
              data-workflow-run-open=""
              onClick={openRuns}
              size="icon"
              title={messages.workflowRuns.runWorkflow}
              type="button"
              variant="outline"
            >
              <Play className="size-3.5" />
            </Button>
          )}
          <Button
            aria-label={messages.richNodes.addStep}
            className="size-7 sm:size-8"
            onClick={addNode}
            size="icon"
            title={messages.richNodes.addStep}
            type="button"
            variant="outline"
          >
            <Plus className="size-3.5" />
          </Button>
          <Button
            aria-label={messages.richNodes.deleteSelection}
            className="size-7 sm:size-8"
            disabled={!selectedId && !selectedEdgeId}
            onClick={deleteSelected}
            size="icon"
            title={messages.richNodes.deleteSelection}
            type="button"
            variant="ghost"
          >
            <Trash2 className="size-3.5" />
          </Button>
        </>
      }
      error={error}
      fullscreenState={fullscreenState}
      node={node}
      nodeType="workflow"
      onSave={saveGraph}
      orpc={orpc}
      status={status}
    >
      <div
        className={
          isAnonymous || fullscreenState.fullscreen
            ? "grid h-full min-h-0 grid-cols-1"
            : "grid h-full min-h-0 grid-cols-[minmax(0,1fr)_17rem] max-md:grid-cols-1 max-md:grid-rows-[minmax(18rem,1fr)_auto]"
        }
      >
        <div className="flex min-h-0 flex-col">
          <p
            className="flex shrink-0 items-center gap-1.5 border-border/60 border-b bg-muted/30 px-3 py-1.5 text-muted-foreground text-xs"
            data-workflow-freshness-note=""
            role="note"
          >
            <Info aria-hidden="true" className="size-3.5 shrink-0" />
            <span>{messages.richNodes.notExecutedNote}</span>
          </p>
          <div className="min-h-0 flex-1">
            <WorkflowRunHighlightContext.Provider value={runHighlight ?? EMPTY_RUN_HIGHLIGHT}>
              <WorkflowCanvas
                edges={edges}
                nodes={nodes}
                onConnect={(connection) => {
                  setEdges((current) =>
                    addEdge(
                      { ...connection, type: "smoothstep", data: { outcome: "default" } },
                      current,
                    ),
                  );
                  markDirty();
                }}
                onEdgeClick={(_, selected) => {
                  setSelectedEdgeId(selected.id);
                  setSelectedId(null);
                }}
                onEdgesChange={onEdgesChange}
                onNodeClick={(_, selected) => {
                  setSelectedId(selected.id);
                  setSelectedEdgeId(null);
                }}
                onNodesChange={onNodesChange}
                onPaneClick={() => {
                  setSelectedId(null);
                  setSelectedEdgeId(null);
                }}
                readOnly={isAnonymous}
              />
            </WorkflowRunHighlightContext.Provider>
          </div>
        </div>
        <aside
          aria-label={messages.richNodes.configuration}
          data-workflow-configuration=""
          className={
            isAnonymous || fullscreenState.fullscreen
              ? "hidden"
              : "min-h-0 overflow-y-auto border-border/60 border-l bg-background p-3 max-md:max-h-64 max-md:border-l-0 max-md:border-t"
          }
        >
          <Tabs
            onValueChange={(value) => setAsideTab(value === "runs" ? "runs" : "configure")}
            value={isAnonymous ? "configure" : asideTab}
          >
            {isAnonymous ? null : (
              <TabsList className={`${PREVIEW_DETAIL_TAB_LIST_CLASS} mb-3`}>
                <TabsTrigger
                  className={PREVIEW_DETAIL_TAB_TRIGGER_CLASS}
                  data-workflow-aside-tab="configure"
                  value="configure"
                >
                  {messages.richNodes.configureTab}
                </TabsTrigger>
                <TabsTrigger
                  className={PREVIEW_DETAIL_TAB_TRIGGER_CLASS}
                  data-workflow-aside-tab="runs"
                  value="runs"
                >
                  {messages.richNodes.runsTab}
                </TabsTrigger>
              </TabsList>
            )}
            <TabsContent className="m-0" value="configure">
              {selectedEdge ? (
                <div className="grid gap-3">
                  <label
                    className="grid gap-1.5 text-muted-foreground text-xs"
                    htmlFor="rich-edge-label"
                  >
                    {messages.richNodes.edgeLabel}
                    <Input
                      id="rich-edge-label"
                      onChange={(event) => updateSelectedEdge({ label: event.target.value })}
                      value={typeof selectedEdge.label === "string" ? selectedEdge.label : ""}
                    />
                  </label>
                  <label
                    className="grid gap-1.5 text-muted-foreground text-xs"
                    htmlFor="rich-edge-outcome"
                  >
                    {messages.richNodes.edgeOutcome}
                    <Input
                      id="rich-edge-outcome"
                      onChange={(event) =>
                        updateSelectedEdge({ outcome: event.target.value || "default" })
                      }
                      placeholder={messages.richNodes.defaultOutcome}
                      value={
                        selectedEdge.data?.outcome === "default"
                          ? ""
                          : String(selectedEdge.data?.outcome ?? "")
                      }
                    />
                  </label>
                </div>
              ) : selectedNode ? (
                <div className="grid gap-3">
                  <label
                    className="grid gap-1.5 text-muted-foreground text-xs"
                    htmlFor="rich-node-label"
                  >
                    {messages.richNodes.label}
                    <Input
                      id="rich-node-label"
                      onChange={(event) => updateSelected({ label: event.target.value })}
                      value={String(selectedNode.data.label)}
                    />
                  </label>
                  <WorkflowStepReference stepId={selectedNode.id} />
                  <label className="grid gap-1.5 text-muted-foreground text-xs">
                    {messages.richNodes.type}
                    <select
                      className="h-9 border border-input bg-card px-3 text-foreground text-sm"
                      onChange={(event) =>
                        updateSelected({ kind: event.target.value as WorkflowNodeKind })
                      }
                      value={String(selectedNode.data.kind)}
                    >
                      <option value="trigger">{messages.richNodes.trigger}</option>
                      <option value="webhook">{messages.richNodes.webhook}</option>
                      <option value="function">{messages.richNodes.function}</option>
                      <option value="condition">{messages.richNodes.condition}</option>
                      <option value="wait">{messages.richNodes.wait}</option>
                      <option value="approval">{messages.richNodes.approval}</option>
                      <option value="action">{messages.richNodes.action}</option>
                      <option value="end">{messages.richNodes.end}</option>
                    </select>
                  </label>
                  <label
                    className="grid gap-1.5 text-muted-foreground text-xs"
                    htmlFor="rich-node-description"
                  >
                    {messages.richNodes.description}
                    <Textarea
                      id="rich-node-description"
                      onChange={(event) => updateSelected({ description: event.target.value })}
                      rows={3}
                      value={String(selectedNode.data.description)}
                    />
                  </label>
                  {selectedNode.data.kind === "webhook" ? (
                    <>
                      <label className="grid gap-1.5 text-muted-foreground text-xs">
                        {messages.richNodes.method}
                        <select
                          className="h-9 border border-input bg-card px-3 text-foreground text-sm"
                          onChange={(event) =>
                            updateSelected({
                              method: event.target.value as WorkflowNodeFields["method"],
                            })
                          }
                          value={String(selectedNode.data.method)}
                        >
                          {(["GET", "POST", "PUT", "PATCH", "DELETE"] as const).map((method) => (
                            <option key={method} value={method}>
                              {method}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label
                        className="grid gap-1.5 text-muted-foreground text-xs"
                        htmlFor="rich-node-webhook-url"
                      >
                        {messages.richNodes.url}
                        <Input
                          id="rich-node-webhook-url"
                          onChange={(event) => updateSelected({ url: event.target.value })}
                          placeholder="https://example.com/webhook"
                          type="url"
                          value={String(selectedNode.data.url)}
                        />
                      </label>
                      <p
                        className="text-[11px] leading-snug text-muted-foreground/80"
                        data-workflow-webhook-hint=""
                      >
                        {messages.richNodes.webhookHint}
                      </p>
                    </>
                  ) : null}
                  {selectedNode.data.kind === "trigger" ? (
                    <>
                      <label
                        className="grid gap-1.5 text-muted-foreground text-xs"
                        htmlFor="rich-node-event-name"
                      >
                        {messages.richNodes.eventName}
                        <select
                          aria-describedby="rich-node-event-hint"
                          className="h-9 border border-input bg-card px-3 text-foreground text-sm"
                          data-workflow-trigger-event=""
                          id="rich-node-event-name"
                          onChange={(event) => updateSelected({ eventName: event.target.value })}
                          value={selectedNode.data.eventName || "manual"}
                        >
                          <option value="manual">{messages.richNodes.manual}</option>
                          <option value="record.created">
                            {messages.richNodes.eventRecordCreated}
                          </option>
                          <option value="record.updated">
                            {messages.richNodes.eventRecordUpdated}
                          </option>
                          {customTriggerEvent ? (
                            <option value={customTriggerEvent}>
                              {fmt(messages.richNodes.customEventOption, {
                                name: customTriggerEvent,
                              })}
                            </option>
                          ) : null}
                        </select>
                        <span
                          className="text-[11px] leading-snug text-muted-foreground/80"
                          id="rich-node-event-hint"
                        >
                          {messages.richNodes.triggerEventHint}
                        </span>
                      </label>
                      {isWorkflowRecordEvent(selectedNode.data.eventName) ? (
                        <WorkflowTriggerBasePicker
                          id="rich-node-trigger-base"
                          onChange={(baseId) => updateSelected({ baseId })}
                          orpc={orpc}
                          value={selectedNode.data.baseId}
                        />
                      ) : null}
                    </>
                  ) : null}
                  {selectedNode.data.kind === "function" ? (
                    <>
                      <label
                        className="grid gap-1.5 text-muted-foreground text-xs"
                        htmlFor="rich-node-webhook-rule-id"
                      >
                        {messages.richNodes.webhookRuleId}
                        <Input
                          id="rich-node-webhook-rule-id"
                          onChange={(event) =>
                            updateSelected({ webhookRuleId: event.target.value })
                          }
                          placeholder="whr_..."
                          value={String(selectedNode.data.webhookRuleId)}
                        />
                      </label>
                      <label
                        className="grid gap-1.5 text-muted-foreground text-xs"
                        htmlFor="rich-node-function-name"
                      >
                        {messages.richNodes.functionName}
                        <Input
                          id="rich-node-function-name"
                          onChange={(event) => updateSelected({ functionName: event.target.value })}
                          value={String(selectedNode.data.functionName)}
                        />
                      </label>
                      <p
                        className="text-[11px] leading-snug text-muted-foreground/80"
                        data-workflow-function-hint=""
                      >
                        {messages.richNodes.functionHint}
                      </p>
                    </>
                  ) : null}
                  {selectedNode.data.kind === "condition" ? (
                    <label
                      className="grid gap-1.5 text-muted-foreground text-xs"
                      htmlFor="rich-node-expression"
                    >
                      {messages.richNodes.expression}
                      <Textarea
                        id="rich-node-expression"
                        onChange={(event) => updateSelected({ expression: event.target.value })}
                        placeholder="input.score >= 80"
                        rows={3}
                        value={String(selectedNode.data.expression)}
                      />
                    </label>
                  ) : null}
                  {selectedNode.data.kind === "wait" ? (
                    <div className="grid grid-cols-[minmax(0,1fr)_7rem] gap-2">
                      <label
                        className="grid gap-1.5 text-muted-foreground text-xs"
                        htmlFor="rich-node-duration"
                      >
                        {messages.richNodes.duration}
                        <Input
                          id="rich-node-duration"
                          min={0}
                          onChange={(event) =>
                            updateSelected({ duration: Number(event.target.value) || 0 })
                          }
                          type="number"
                          value={Number(selectedNode.data.duration)}
                        />
                      </label>
                      <label className="grid gap-1.5 text-muted-foreground text-xs">
                        {messages.richNodes.unit}
                        <select
                          className="h-9 border border-input bg-card px-2 text-foreground text-sm"
                          onChange={(event) =>
                            updateSelected({
                              unit: event.target.value as WorkflowNodeFields["unit"],
                            })
                          }
                          value={String(selectedNode.data.unit)}
                        >
                          <option value="minutes">{messages.richNodes.minutes}</option>
                          <option value="hours">{messages.richNodes.hours}</option>
                          <option value="days">{messages.richNodes.days}</option>
                        </select>
                      </label>
                    </div>
                  ) : null}
                  {selectedNode.data.kind === "approval" ? (
                    <>
                      <label
                        className="grid gap-1.5 text-muted-foreground text-xs"
                        htmlFor="rich-node-approver"
                      >
                        {messages.richNodes.approver}
                        <Input
                          aria-describedby="rich-node-approver-hint"
                          id="rich-node-approver"
                          onChange={(event) => updateSelected({ approver: event.target.value })}
                          placeholder="lead@example.com"
                          value={String(selectedNode.data.approver)}
                        />
                        <span
                          className="text-[11px] leading-snug text-muted-foreground/80"
                          id="rich-node-approver-hint"
                        >
                          {messages.richNodes.approverHint}
                        </span>
                      </label>
                      <label className="flex items-start gap-2 text-muted-foreground text-xs">
                        <input
                          checked={selectedNode.data.allowAgents}
                          className="mt-0.5"
                          data-workflow-allow-agents=""
                          onChange={(event) =>
                            updateSelected({ allowAgents: event.target.checked })
                          }
                          type="checkbox"
                        />
                        <span className="grid gap-1">
                          {messages.richNodes.allowAgents}
                          <span className="text-[11px] leading-snug text-muted-foreground/80">
                            {messages.richNodes.allowAgentsHint}
                          </span>
                        </span>
                      </label>
                    </>
                  ) : null}
                  {selectedNode.data.kind === "action" ? (
                    <WorkflowActionSettings
                      actionName={selectedNode.data.actionName}
                      baseId={selectedNode.data.baseId}
                      fields={selectedNode.data.fields}
                      onChange={updateSelected}
                      orpc={orpc}
                      stepId={selectedNode.id}
                      targetRecordId={selectedNode.data.targetRecordId}
                    />
                  ) : null}
                  {selectedNode.data.kind === "end" ? (
                    <label
                      className="grid gap-1.5 text-muted-foreground text-xs"
                      htmlFor="rich-node-outcome"
                    >
                      {messages.richNodes.outcome}
                      <Input
                        id="rich-node-outcome"
                        onChange={(event) =>
                          updateSelected({ outcome: event.target.value || "completed" })
                        }
                        placeholder={messages.richNodes.completed}
                        value={
                          selectedNode.data.outcome === "completed"
                            ? ""
                            : String(selectedNode.data.outcome)
                        }
                      />
                    </label>
                  ) : null}
                </div>
              ) : (
                <p className="text-muted-foreground text-xs">
                  {messages.richNodes.selectStepOrEdge}
                </p>
              )}
              <div className="mt-4 grid gap-3 border-border/60 border-t pt-4">
                <h3 className="font-medium text-foreground text-xs">
                  {messages.richNodes.workflowSettings}
                </h3>
                <label className="grid gap-1.5 text-muted-foreground text-xs">
                  {messages.richNodes.executionMode}
                  <select
                    aria-describedby="rich-workflow-execution-mode-hint"
                    className="h-9 border border-input bg-card px-3 text-foreground text-sm"
                    onChange={(event) =>
                      updateWorkflowSettings({
                        executionMode: event.target.value === "event" ? "event" : "manual",
                      })
                    }
                    value={workflowSettings.executionMode}
                  >
                    <option value="manual">{messages.richNodes.manual}</option>
                    <option value="event">{messages.richNodes.event}</option>
                  </select>
                  <span
                    className="text-[11px] leading-snug text-muted-foreground/80"
                    id="rich-workflow-execution-mode-hint"
                  >
                    {messages.richNodes.executionModeHint}
                  </span>
                </label>
                <label className="grid gap-1.5 text-muted-foreground text-xs">
                  {messages.richNodes.errorPolicy}
                  <select
                    className="h-9 border border-input bg-card px-3 text-foreground text-sm"
                    onChange={(event) =>
                      updateWorkflowSettings({
                        errorPolicy: event.target.value === "continue" ? "continue" : "stop",
                      })
                    }
                    value={workflowSettings.errorPolicy}
                  >
                    <option value="stop">{messages.richNodes.stop}</option>
                    <option value="continue">{messages.richNodes.continue}</option>
                  </select>
                </label>
                <label
                  className="grid gap-1.5 text-muted-foreground text-xs"
                  htmlFor="rich-workflow-concurrency"
                >
                  {messages.richNodes.concurrency}
                  <Input
                    aria-describedby="rich-workflow-concurrency-hint"
                    id="rich-workflow-concurrency"
                    max={50}
                    min={1}
                    onChange={(event) =>
                      updateWorkflowSettings({
                        concurrency: Math.max(1, Math.min(50, Number(event.target.value) || 1)),
                      })
                    }
                    type="number"
                    value={workflowSettings.concurrency}
                  />
                  <span
                    className="text-[11px] leading-snug text-muted-foreground/80"
                    id="rich-workflow-concurrency-hint"
                  >
                    {messages.richNodes.concurrencyHint}
                  </span>
                </label>
                <label
                  className="grid gap-1.5 text-muted-foreground text-xs"
                  htmlFor="rich-workflow-timeout"
                >
                  {messages.richNodes.timeoutMs}
                  <Input
                    id="rich-workflow-timeout"
                    max={300000}
                    min={1000}
                    onChange={(event) =>
                      updateWorkflowSettings({
                        timeoutMs: Math.max(
                          1000,
                          Math.min(300000, Number(event.target.value) || 30000),
                        ),
                      })
                    }
                    type="number"
                    value={workflowSettings.timeoutMs}
                  />
                </label>
              </div>
            </TabsContent>
            {isAnonymous ? null : (
              <TabsContent className="m-0" value="runs">
                <WorkflowRunsPanel
                  hasUnsavedChanges={status !== "saved"}
                  onHighlightChange={setRunHighlight}
                  orpc={orpc}
                  steps={savedSteps}
                  workflowNodeId={node.id}
                />
              </TabsContent>
            )}
          </Tabs>
        </aside>
      </div>
    </RichNodeShell>
  );
}

interface GraphDetailViewProps {
  orpc: BusabaseQueryUtils;
  slug: string | null;
  onNodeLoaded?: NodeDetailProps["onNodeLoaded"];
}

export function WorkflowDetailView({ orpc, slug, onNodeLoaded }: GraphDetailViewProps) {
  const messages = useCoreI18n();
  const detailQuery = useQuery({
    ...orpc.nodes.get.queryOptions({ input: { nodeId: slug ?? "", type: "workflow" } }),
    enabled: Boolean(slug),
  });
  const detail = asNodeDetail(detailQuery.isError ? undefined : detailQuery.data, "workflow");
  useReportLoadedNode(detail?.node, onNodeLoaded);
  if (!detail) {
    return detailQuery.isLoading ? (
      <NodeDetailSkeleton />
    ) : (
      <RichNodeNotFound type={messages.nodeDetail.workflow} />
    );
  }
  return (
    <ReactFlowProvider>
      <GraphEditor document={detail.document} key={detail.node.id} node={detail.node} orpc={orpc} />
    </ReactFlowProvider>
  );
}

function WorkflowSidePanelCanvas({
  document,
  fullscreenState,
  name,
}: {
  document: WorkflowDocument;
  fullscreenState: PreviewFullscreenState;
  name: string;
}) {
  const messages = useCoreI18n();
  const { fitView, getViewport, setViewport } = useReactFlow<WorkflowFlowNode, Edge>();
  const splitViewportRef = useRef<Viewport | null>(null);
  const wasFullscreenRef = useRef(false);
  const [nodes, , applyNodeChanges] = useNodesState<WorkflowFlowNode>(
    document.nodes.map((workflowNode) => ({
      id: workflowNode.id,
      type: "workflowStep" as const,
      position: workflowNode.position,
      data: workflowNodeData(workflowNode),
    })),
  );
  const [edges, , applyEdgeChanges] = useEdgesState(toWorkflowEdges(document.edges));

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      if (fullscreenState.fullscreen) {
        splitViewportRef.current = getViewport();
        void fitView({ duration: 0, maxZoom: 1, minZoom: 0.4, padding: 0.12 });
      } else if (wasFullscreenRef.current && splitViewportRef.current) {
        void setViewport(splitViewportRef.current, { duration: 0 });
      }
      wasFullscreenRef.current = fullscreenState.fullscreen;
    });
    return () => cancelAnimationFrame(frame);
  }, [fitView, fullscreenState.fullscreen, getViewport, setViewport]);

  return (
    <FullscreenPreviewSurface
      aria-label={name}
      data-visual-node-preview="workflow"
      exitLabel={messages.airapp.exitFullscreen}
      fullscreenState={fullscreenState}
      toolbar={
        <div className="flex min-h-11 items-center justify-between gap-2 border-border/60 border-b px-4 py-2">
          <span className="font-medium text-muted-foreground text-xs uppercase">
            {messages.nodeDetail.workflow}
          </span>
          <PreviewFullscreenButton
            fullscreenState={fullscreenState}
            label={messages.airapp.enterFullscreen}
          />
        </div>
      }
    >
      <WorkflowCanvas
        edges={edges}
        nodes={nodes}
        onEdgesChange={applyEdgeChanges}
        onNodesChange={applyNodeChanges}
        readOnly
      />
    </FullscreenPreviewSurface>
  );
}

/** Read-only React Flow preview kept mounted by the Side Panel tab host. */
export function WorkflowSidePanelPreview({ orpc, payload }: SidePanelTabProps) {
  const messages = useCoreI18n();
  const { nodeId } = payload as { nodeId: string };
  const fullscreenState = usePreviewFullscreen();
  const detailQuery = useQuery({
    ...orpc.nodes.get.queryOptions({ input: { nodeId, type: "workflow" } }),
    enabled: Boolean(nodeId),
  });
  const detail = asNodeDetail(detailQuery.isError ? undefined : detailQuery.data, "workflow");

  if (!detail) {
    return detailQuery.isLoading ? (
      <NodeDetailSkeleton />
    ) : (
      <RichNodeNotFound type={messages.nodeDetail.workflow} />
    );
  }

  return (
    <ReactFlowProvider>
      <WorkflowSidePanelCanvas
        document={detail.document}
        fullscreenState={fullscreenState}
        key={detail.node.id}
        name={detail.node.name}
      />
    </ReactFlowProvider>
  );
}
