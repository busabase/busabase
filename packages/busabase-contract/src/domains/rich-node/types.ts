import { z } from "zod";

const positionSchema = z.object({
  x: z.number().finite(),
  y: z.number().finite(),
});

export const WhiteboardDocumentSchema = z.object({
  version: z.literal(1),
  elements: z.array(z.unknown()).default([]),
  appState: z.record(z.string(), z.unknown()).default({}),
});
export type WhiteboardDocument = z.infer<typeof WhiteboardDocumentSchema>;

const workflowNodeBase = {
  id: z.string().min(1),
  position: positionSchema,
  label: z.string().min(1).max(120),
  description: z.string().max(500).default(""),
};

export const WorkflowNodeSchema = z.discriminatedUnion("kind", [
  z.object({
    ...workflowNodeBase,
    kind: z.literal("trigger"),
    eventName: z.string().max(160).default("manual"),
  }),
  z.object({
    ...workflowNodeBase,
    kind: z.literal("webhook"),
    method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]).default("POST"),
    url: z.string().max(2_000).default(""),
  }),
  z.object({
    ...workflowNodeBase,
    kind: z.literal("function"),
    webhookRuleId: z.string().max(160).default(""),
    functionName: z.string().max(160).default(""),
  }),
  z.object({
    ...workflowNodeBase,
    kind: z.literal("condition"),
    expression: z.string().max(2_000).default(""),
  }),
  z.object({
    ...workflowNodeBase,
    kind: z.literal("wait"),
    duration: z.number().int().min(0).max(525_600).default(1),
    unit: z.enum(["minutes", "hours", "days"]).default("hours"),
  }),
  z.object({
    ...workflowNodeBase,
    kind: z.literal("approval"),
    approver: z.string().max(160).default(""),
  }),
  z.object({
    ...workflowNodeBase,
    kind: z.literal("action"),
    actionName: z.string().max(160).default(""),
  }),
  z.object({
    ...workflowNodeBase,
    kind: z.literal("end"),
    outcome: z.string().max(160).default("completed"),
  }),
]);
export type WorkflowNode = z.infer<typeof WorkflowNodeSchema>;

export const GraphEdgeSchema = z.object({
  id: z.string().min(1),
  source: z.string().min(1),
  target: z.string().min(1),
});
export type GraphEdge = z.infer<typeof GraphEdgeSchema>;

export const WorkflowEdgeSchema = GraphEdgeSchema.extend({
  label: z.string().max(120).default(""),
  outcome: z.string().max(120).default("default"),
});
export type WorkflowEdge = z.infer<typeof WorkflowEdgeSchema>;

export const WorkflowSettingsSchema = z.object({
  executionMode: z.enum(["manual", "event"]).default("manual"),
  concurrency: z.number().int().min(1).max(50).default(1),
  timeoutMs: z.number().int().min(1_000).max(300_000).default(30_000),
  errorPolicy: z.enum(["stop", "continue"]).default("stop"),
});
export type WorkflowSettings = z.infer<typeof WorkflowSettingsSchema>;

export const WorkflowDocumentSchema = z.object({
  version: z.literal(2),
  nodes: z.array(WorkflowNodeSchema).default([]),
  edges: z.array(WorkflowEdgeSchema).default([]),
  settings: WorkflowSettingsSchema.default({
    executionMode: "manual",
    concurrency: 1,
    timeoutMs: 30_000,
    errorPolicy: "stop",
  }),
});
export type WorkflowDocument = z.infer<typeof WorkflowDocumentSchema>;

export const HtmlDocumentSchema = z.object({
  version: z.literal(1),
  source: z.string().max(500_000),
});
export type HtmlDocument = z.infer<typeof HtmlDocumentSchema>;

export const EMPTY_WHITEBOARD_DOCUMENT: WhiteboardDocument = {
  version: 1,
  elements: [],
  appState: {},
};

export const EMPTY_WORKFLOW_DOCUMENT: WorkflowDocument = {
  version: 2,
  nodes: [
    {
      id: "trigger",
      kind: "trigger",
      position: { x: 0, y: 0 },
      label: "Manual trigger",
      description: "",
      eventName: "manual",
    },
  ],
  edges: [],
  settings: {
    executionMode: "manual",
    concurrency: 1,
    timeoutMs: 30_000,
    errorPolicy: "stop",
  },
};

export const DEFAULT_HTML_DOCUMENT: HtmlDocument = {
  version: 1,
  source:
    '<!doctype html>\n<html lang="en">\n<head>\n  <meta charset="utf-8">\n  <meta name="viewport" content="width=device-width, initial-scale=1">\n  <title>Untitled</title>\n</head>\n<body>\n  <h1>Hello, Busabase</h1>\n</body>\n</html>',
};

const clone = <T>(value: T): T => structuredClone(value);

export const parseWhiteboardDocument = (value: unknown): WhiteboardDocument => {
  const parsed = WhiteboardDocumentSchema.safeParse(value);
  return parsed.success ? parsed.data : clone(EMPTY_WHITEBOARD_DOCUMENT);
};

const normalizeEdges = <T extends { id: string }, E extends GraphEdge>(
  nodes: T[],
  edges: E[],
): E[] => {
  const nodeIds = new Set(nodes.map((node) => node.id));
  return edges.filter((edge) => nodeIds.has(edge.source) && nodeIds.has(edge.target));
};

export const parseWorkflowDocument = (value: unknown): WorkflowDocument => {
  const parsed = WorkflowDocumentSchema.safeParse(value);
  if (!parsed.success) return clone(EMPTY_WORKFLOW_DOCUMENT);
  return { ...parsed.data, edges: normalizeEdges(parsed.data.nodes, parsed.data.edges) };
};

export const parseHtmlDocument = (value: unknown): HtmlDocument => {
  const parsed = HtmlDocumentSchema.safeParse(value);
  return parsed.success ? parsed.data : clone(DEFAULT_HTML_DOCUMENT);
};
