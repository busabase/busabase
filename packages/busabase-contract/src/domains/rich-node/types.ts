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

/**
 * When a `schedule` trigger starts runs. Minutes and hours repeat on a fixed
 * grid (every 15 minutes is :00, :15, :30, :45 in UTC); days and weeks run at
 * the `at` time in `timezone`. Minutes run at most every 15.
 */
export const WorkflowScheduleSchema = z.object({
  unit: z.enum(["minutes", "hours", "days", "weeks"]).default("days"),
  /** For minutes and hours: every this many. */
  every: z.number().int().min(1).max(1_000).default(1),
  /** For days and weeks: the time of day, 24-hour "HH:MM". */
  at: z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
    .default("09:00"),
  /** For weeks: 0 is Sunday, 6 is Saturday. */
  weekday: z.number().int().min(0).max(6).default(1),
  /** The IANA time zone `at` is in, such as "Asia/Shanghai". */
  timezone: z.string().min(1).max(64).default("UTC"),
});
export type WorkflowSchedule = z.infer<typeof WorkflowScheduleSchema>;

export const WorkflowWebhookHeaderSchema = z.object({
  name: z.string().max(200),
  value: z.string().max(4_000),
});
export type WorkflowWebhookHeader = z.infer<typeof WorkflowWebhookHeaderSchema>;

export const WorkflowNodeSchema = z.discriminatedUnion("kind", [
  z.object({
    ...workflowNodeBase,
    kind: z.literal("trigger"),
    eventName: z.string().max(160).default("manual"),
    /**
     * For `record.created` / `record.updated` in event mode: only records in
     * this Base start a run. Empty means any Base in the space.
     */
    baseId: z.string().max(160).default(""),
    /**
     * For record events: start a run only when this field (by slug) gets a
     * different value. Empty means any change. A new record counts as changing
     * every field it fills.
     */
    fieldSlug: z.string().max(160).optional(),
    /**
     * With `fieldSlug`: only when the field changes to this value, so editing a
     * record that already has it starts nothing. A select field's value is the
     * choice id. Empty means any new value.
     */
    toValue: z.string().max(500).optional(),
    /** For the `schedule` event in event mode. */
    schedule: WorkflowScheduleSchema.optional(),
    /**
     * For the `webhook` event: the secret part of this trigger's URL,
     * `/api/workflow-hooks/<workflow id>/<hookToken>`. Anyone who has the URL
     * can start a run, so it is long and random; change it to revoke the URL.
     */
    hookToken: z.string().min(16).max(100).optional(),
  }),
  z.object({
    ...workflowNodeBase,
    kind: z.literal("webhook"),
    method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]).default("POST"),
    url: z.string().max(2_000).default(""),
    /**
     * Sent with the request, such as `Authorization`. Stored in the workflow,
     * so anyone who can open it can read them.
     */
    headers: z.array(WorkflowWebhookHeaderSchema).max(20).optional(),
    /**
     * When set, every request carries `X-Busabase-Signature:
     * t=<unix seconds>,v1=<hex HMAC-SHA256 of "<t>.<body>" with this secret>`,
     * so the receiver can tell the request came from this step. Stored in the
     * workflow, so anyone who can open it can read it; change it to retire the
     * old one.
     */
    signingSecret: z.string().min(16).max(100).optional(),
  }),
  z.object({
    ...workflowNodeBase,
    kind: z.literal("function"),
    webhookRuleId: z.string().max(160).default(""),
    functionName: z.string().max(160).default(""),
    /**
     * JavaScript written in the step itself. When present it runs instead of a
     * saved rule: `input` is the run's data, `fetch` reaches public URLs, and
     * the returned value is the step's output.
     */
    code: z.string().max(50_000).optional(),
    /**
     * Where `code` runs. `server` (the default) is the app's own sandbox: fast,
     * JavaScript only, no packages. `sandbox` is a machine provisioned for the
     * run: JavaScript or Python, packages installed first, minutes of time, and
     * the run waits for it like a Wait.
     */
    runIn: z.enum(["server", "sandbox"]).optional(),
    /** For `runIn: "sandbox"`: the language `code` is written in. Default JavaScript. */
    language: z.enum(["javascript", "python"]).optional(),
    /** For `runIn: "sandbox"`: npm or pip packages to install first, separated by spaces or commas. */
    packages: z.string().max(1_000).optional(),
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
    /**
     * Off by default: an approval is a checkpoint for a person. On, an agent
     * (API key, MCP, CLI) that also meets the step's approver rule may decide.
     */
    allowAgents: z.boolean().default(false),
  }),
  z.object({
    ...workflowNodeBase,
    kind: z.literal("action"),
    actionName: z.string().max(160).default(""),
    /**
     * For `update_record`: the fields to set on the run's record. A string value
     * starting with `=` is a formula over earlier steps (`=steps.score.score`);
     * `==` stores a literal that starts with `=`. Also the new record's fields
     * for `create_record`. Ignored by other actions.
     */
    fields: z.record(z.string().min(1).max(160), z.unknown()).default({}),
    /**
     * For `update_record` and `delete_record`: which record. Empty means the
     * run's own record; otherwise a record id or an `=formula` that gives one.
     */
    targetRecordId: z.string().max(500).default(""),
    /** For `create_record`: the Base the new record goes in. For `find_records`: the Base to search. */
    baseId: z.string().max(160).default(""),
    /** For `find_records`: only the records this View shows, in its order. Empty means every record. */
    viewId: z.string().max(160).optional(),
    /** For `find_records`: the most records it returns. Default 50. */
    limit: z.number().int().min(1).max(200).optional(),
    /**
     * For `find_records`: run the steps after it once per record found, each in
     * its own run about that record, instead of once with the whole list.
     */
    forEach: z.boolean().optional(),
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
      baseId: "",
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
