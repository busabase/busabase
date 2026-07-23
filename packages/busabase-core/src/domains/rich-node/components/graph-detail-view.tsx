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
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import type { BusabaseQueryUtils } from "busabase-contract/api-client/react-query";
import {
  parseWorkflowDocument,
  type WorkflowDocument,
  type WorkflowEdge,
  type WorkflowNode,
  type WorkflowSettings,
} from "busabase-contract/domains/rich-node/types";
import type { NodeVO } from "busabase-contract/types";
import { Button } from "kui/button";
import { Input } from "kui/input";
import { Textarea } from "kui/textarea";
import {
  Braces,
  CircleDot,
  CircleStop,
  Clock3,
  GitBranch,
  Plus,
  Trash2,
  UserCheck,
  Webhook,
  Workflow,
  Zap,
} from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { useCoreI18n } from "../../../i18n";
import { useReportLoadedNode } from "../../dashboard/hooks/use-report-loaded-node";
import type { NodeDetailProps } from "../../dashboard/node-detail-registry";
import { findNode, RichNodeNotFound, RichNodeShell, useNodeMetadataSave } from "./rich-node-shell";

type WorkflowNodeKind = WorkflowNode["kind"];
interface WorkflowNodeFields {
  kind: WorkflowNodeKind;
  label: string;
  description: string;
  eventName: string;
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  url: string;
  webhookRuleId: string;
  functionName: string;
  expression: string;
  duration: number;
  unit: "minutes" | "hours" | "days";
  approver: string;
  actionName: string;
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

const workflowNodeSummary = (data: WorkflowNodeData): string => {
  switch (data.kind) {
    case "trigger":
      return data.eventName || "Manual";
    case "webhook":
      return `${data.method} ${data.url || "Webhook"}`;
    case "function":
      return data.functionName || data.webhookRuleId || "Function";
    case "condition":
      return data.expression || data.description || "Condition";
    case "wait":
      return `${data.duration} ${data.unit}`;
    case "approval":
      return data.approver || "Approval";
    case "action":
      return data.actionName || data.description || "Action";
    case "end":
      return data.outcome || "Completed";
  }
};

function WorkflowStepNode({ data, selected }: NodeProps<WorkflowFlowNode>) {
  const Icon = workflowIcon[data.kind];
  return (
    <div
      className={`w-56 border bg-card shadow-sm ${
        selected ? "border-primary ring-2 ring-primary/15" : "border-border"
      }`}
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
        <span className="text-[10px] text-muted-foreground uppercase">{data.kind}</span>
      </div>
      <div className="min-h-9 truncate px-3 py-2 text-muted-foreground text-xs">
        {workflowNodeSummary(data)}
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
  method: node.kind === "webhook" ? node.method : "POST",
  url: node.kind === "webhook" ? node.url : "",
  webhookRuleId: node.kind === "function" ? node.webhookRuleId : "",
  functionName: node.kind === "function" ? node.functionName : "",
  expression: node.kind === "condition" ? node.expression : "",
  duration: node.kind === "wait" ? node.duration : 1,
  unit: node.kind === "wait" ? node.unit : "hours",
  approver: node.kind === "approval" ? node.approver : "",
  actionName: node.kind === "action" ? node.actionName : "",
  outcome: node.kind === "end" ? node.outcome : "completed",
});

const persistedWorkflowNode = (entry: WorkflowFlowNode): WorkflowNode => {
  const data = entry.data;
  const base = {
    id: entry.id,
    position: entry.position,
    label: data.label.trim() || "Untitled step",
    description: data.description,
  };
  switch (data.kind) {
    case "trigger":
      return { ...base, kind: data.kind, eventName: data.eventName };
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
      return { ...base, kind: data.kind, approver: data.approver };
    case "action":
      return { ...base, kind: data.kind, actionName: data.actionName };
    case "end":
      return { ...base, kind: data.kind, outcome: data.outcome };
  }
};

interface GraphEditorProps {
  node: NodeVO;
  orpc: BusabaseQueryUtils;
}

function GraphEditor({ node, orpc }: GraphEditorProps) {
  const messages = useCoreI18n();
  const workflowDocument = useMemo(
    () => parseWorkflowDocument(node.metadata.workflowDocument),
    [node.metadata.workflowDocument],
  );
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
  const { error, markDirty, save, status } = useNodeMetadataSave(orpc, node, "workflowDocument");
  const selectedNode = nodes.find((entry) => entry.id === selectedId) ?? null;
  const selectedEdge = edges.find((entry) => entry.id === selectedEdgeId) ?? null;

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
    const id = newId("step");
    const position = { x: nodes.length * 56, y: nodes.length * 72 };
    const next: WorkflowFlowNode = {
      id,
      type: "workflowStep",
      position,
      data: {
        kind: "webhook",
        label: `Step ${nodes.length + 1}`,
        description: "",
        eventName: "manual",
        method: "POST",
        url: "",
        webhookRuleId: "",
        functionName: "",
        expression: "",
        duration: 1,
        unit: "hours",
        approver: "",
        actionName: "",
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
            actionName: patch.actionName ?? entry.data.actionName,
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

  const saveGraph = () => {
    const document: WorkflowDocument = {
      version: 2,
      nodes: nodes.map(persistedWorkflowNode),
      edges: persistedWorkflowEdges(edges),
      settings: workflowSettings,
    };
    save(document);
  };

  return (
    <RichNodeShell
      actions={
        <>
          <Button
            aria-label={messages.richNodes.addStep}
            className="gap-1.5"
            onClick={addNode}
            size="sm"
            title={messages.richNodes.addStep}
            type="button"
            variant="outline"
          >
            <Plus className="size-3.5" />
            <span className="max-sm:hidden">{messages.richNodes.addStep}</span>
          </Button>
          <Button
            aria-label={messages.richNodes.deleteSelection}
            disabled={!selectedId && !selectedEdgeId}
            onClick={deleteSelected}
            size="icon-sm"
            title={messages.richNodes.deleteSelection}
            type="button"
            variant="ghost"
          >
            <Trash2 className="size-3.5" />
          </Button>
        </>
      }
      error={error}
      icon={Workflow}
      node={node}
      nodeType="workflow"
      onSave={saveGraph}
      orpc={orpc}
      status={status}
    >
      <div className="grid h-full min-h-0 grid-cols-[minmax(0,1fr)_17rem] max-md:grid-cols-1 max-md:grid-rows-[minmax(18rem,1fr)_auto]">
        <div className="min-h-0 bg-muted/20">
          <ReactFlow
            colorMode="system"
            edges={edges}
            fitView
            maxZoom={1.8}
            minZoom={0.2}
            nodeTypes={nodeTypes}
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
            proOptions={{ hideAttribution: true }}
          >
            <Background gap={20} size={1} variant={BackgroundVariant.Dots} />
            <Controls showInteractive={false} />
          </ReactFlow>
        </div>
        <aside className="min-h-0 overflow-y-auto border-border/60 border-l bg-background p-3 max-md:max-h-64 max-md:border-l-0 max-md:border-t">
          <h2 className="mb-3 font-medium text-foreground text-xs">
            {messages.richNodes.configuration}
          </h2>
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
                  onChange={(event) => updateSelectedEdge({ outcome: event.target.value })}
                  value={String(selectedEdge.data?.outcome ?? "default")}
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
              <label className="grid gap-1.5 text-muted-foreground text-xs">
                {messages.richNodes.type}
                <select
                  className="h-9 border border-input bg-background px-3 text-foreground text-sm"
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
                      className="h-9 border border-input bg-background px-3 text-foreground text-sm"
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
                </>
              ) : null}
              {selectedNode.data.kind === "trigger" ? (
                <label
                  className="grid gap-1.5 text-muted-foreground text-xs"
                  htmlFor="rich-node-event-name"
                >
                  {messages.richNodes.eventName}
                  <Input
                    id="rich-node-event-name"
                    onChange={(event) => updateSelected({ eventName: event.target.value })}
                    placeholder="record.created"
                    value={String(selectedNode.data.eventName)}
                  />
                </label>
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
                      onChange={(event) => updateSelected({ webhookRuleId: event.target.value })}
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
                      className="h-9 border border-input bg-background px-2 text-foreground text-sm"
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
                <label
                  className="grid gap-1.5 text-muted-foreground text-xs"
                  htmlFor="rich-node-approver"
                >
                  {messages.richNodes.approver}
                  <Input
                    id="rich-node-approver"
                    onChange={(event) => updateSelected({ approver: event.target.value })}
                    placeholder="space-admin"
                    value={String(selectedNode.data.approver)}
                  />
                </label>
              ) : null}
              {selectedNode.data.kind === "action" ? (
                <label
                  className="grid gap-1.5 text-muted-foreground text-xs"
                  htmlFor="rich-node-action-name"
                >
                  {messages.richNodes.actionName}
                  <Input
                    id="rich-node-action-name"
                    onChange={(event) => updateSelected({ actionName: event.target.value })}
                    value={String(selectedNode.data.actionName)}
                  />
                </label>
              ) : null}
              {selectedNode.data.kind === "end" ? (
                <label
                  className="grid gap-1.5 text-muted-foreground text-xs"
                  htmlFor="rich-node-outcome"
                >
                  {messages.richNodes.outcome}
                  <Input
                    id="rich-node-outcome"
                    onChange={(event) => updateSelected({ outcome: event.target.value })}
                    value={String(selectedNode.data.outcome)}
                  />
                </label>
              ) : null}
            </div>
          ) : (
            <p className="text-muted-foreground text-xs">{messages.richNodes.selectStepOrEdge}</p>
          )}
          <div className="mt-4 grid gap-3 border-border/60 border-t pt-4">
            <h3 className="font-medium text-foreground text-xs">
              {messages.richNodes.workflowSettings}
            </h3>
            <label className="grid gap-1.5 text-muted-foreground text-xs">
              {messages.richNodes.executionMode}
              <select
                className="h-9 border border-input bg-background px-3 text-foreground text-sm"
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
            </label>
            <label className="grid gap-1.5 text-muted-foreground text-xs">
              {messages.richNodes.errorPolicy}
              <select
                className="h-9 border border-input bg-background px-3 text-foreground text-sm"
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
        </aside>
      </div>
    </RichNodeShell>
  );
}

interface GraphDetailViewProps {
  nodes?: NodeVO[];
  orpc: BusabaseQueryUtils;
  slug: string | null;
  onNodeLoaded?: NodeDetailProps["onNodeLoaded"];
}

export function WorkflowDetailView({ nodes, orpc, slug, onNodeLoaded }: GraphDetailViewProps) {
  const node = useMemo(() => findNode(nodes ?? [], "workflow", slug), [nodes, slug]);
  useReportLoadedNode(node, onNodeLoaded);
  if (!node) return <RichNodeNotFound type="Workflow" />;
  return (
    <ReactFlowProvider>
      <GraphEditor key={node.id} node={node} orpc={orpc} />
    </ReactFlowProvider>
  );
}
