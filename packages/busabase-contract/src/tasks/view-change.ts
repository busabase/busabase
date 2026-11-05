import type { BusabaseTaskClient, TaskDefinition } from "./types";

/**
 * Base views: create / update / delete / restore, as one task.
 *
 * The consolidated contract uses one discriminated endpoint for create, update,
 * delete, and restore. This task keeps the same operation vocabulary while adding
 * agent-oriented guidance and examples above the transport-level union.
 */

const ACTIONS = ["create", "update", "delete", "restore"] as const;
type ViewAction = (typeof ACTIONS)[number];

export interface ViewChangeInput {
  action: ViewAction;
  baseId?: string;
  viewId?: string;
  name?: string;
  slug?: string;
  type?: string;
  description?: string;
  config?: unknown;
  patch?: unknown;
  position?: number;
  message?: string;
  submittedBy?: string;
  autoMerge?: boolean;
  requireReview?: boolean;
}

/** The arguments that change the view, and the actions able to apply each one. */
const CHANGE_PARAMS = [
  "name",
  "slug",
  "type",
  "description",
  "config",
  "patch",
  "position",
] as const;
type ChangeParam = (typeof CHANGE_PARAMS)[number];
const ACCEPTED_BY_ACTION: Record<ViewAction, readonly ChangeParam[]> = {
  create: ["name", "slug", "type", "description", "config"],
  update: ["name", "type", "description", "config", "patch", "position"],
  delete: [],
  restore: [],
};

/** The `update` keys that also have a flag of their own. */
const UPDATE_KEYS = ["name", "type", "description", "config", "position"] as const;
/** Everything else the update endpoint reads; a patch key outside both lists would be stripped. */
const UPDATE_META_KEYS = ["message", "submittedBy", "autoMerge"] as const;
const PATCH_KEYS = new Set<string>([...UPDATE_KEYS, ...UPDATE_META_KEYS]);

const isGiven = (value: unknown): boolean => value !== undefined && value !== null && value !== "";

/**
 * Refuse an argument the action cannot apply, instead of dropping it.
 *
 * `update` used to read only `patch` and `position`, so `--name "…" --config-json
 * '…' --position 4` moved the view and silently kept the old name and config —
 * and without `--position` it claimed nothing had been passed at all. Every
 * argument that reaches an action is now either sent or refused by name, the same
 * contract `node_create` and `base_field_change_request` keep.
 */
const assertApplicable = (input: ViewChangeInput): void => {
  const accepted = ACCEPTED_BY_ACTION[input.action];
  const refused = CHANGE_PARAMS.filter((key) => isGiven(input[key]) && !accepted.includes(key));
  if (refused.length === 0) return;
  const hint =
    input.action === "create"
      ? " Create the view first, then send an `update` (with `position` to move it)."
      : input.action === "update"
        ? " A view's slug is fixed once it exists."
        : "";
  throw new Error(`action "${input.action}" does not take: ${refused.join(", ")}.${hint}`);
};

/**
 * `update`'s payload: `patch` plus the same keys passed one by one. A key given
 * both ways with different values is refused rather than letting one of them
 * win silently.
 */
const buildUpdatePatch = (input: ViewChangeInput): Record<string, unknown> => {
  if (
    input.patch !== undefined &&
    (input.patch === null || typeof input.patch !== "object" || Array.isArray(input.patch))
  ) {
    throw new Error('action "update": patch must be a JSON object, e.g. {"name":"Open tasks"}.');
  }
  const patch = { ...((input.patch ?? {}) as Record<string, unknown>) };
  const unknownKeys = Object.keys(patch).filter((key) => !PATCH_KEYS.has(key));
  if (unknownKeys.length > 0) {
    throw new Error(
      `action "update": patch does not take ${unknownKeys.join(", ")} — a view update changes ${UPDATE_KEYS.join(", ")}.`,
    );
  }
  for (const key of UPDATE_KEYS) {
    const value = input[key];
    if (value === undefined) continue;
    if (key in patch && JSON.stringify(patch[key]) !== JSON.stringify(value)) {
      throw new Error(
        `action "update": ${key} was passed both on its own and inside patch with different values — pass it once.`,
      );
    }
    patch[key] = value;
  }
  if (!UPDATE_KEYS.some((key) => key in patch)) {
    throw new Error(
      'action "update" requires a change: name, type, description, config, position, or patch.',
    );
  }
  return patch;
};

/**
 * `autoMerge` is tri-state — unset (permission-aware default), forced on, forced
 * off — but a CLI boolean flag is presence-only, so `--auto-merge` alone could
 * never express "forced off". Same two-flag shape as `node_create`.
 */
const mergeIntent = (input: ViewChangeInput): { autoMerge?: boolean } => {
  if (input.requireReview) return { autoMerge: false };
  if (input.autoMerge !== undefined) return { autoMerge: input.autoMerge };
  return {};
};

export const viewChangeTask: TaskDefinition<ViewChangeInput> = {
  name: "view_change_request",
  cliPath: ["views", "change-request"],
  summary: "Propose a Base view change (create / update / delete / restore)",
  guidance:
    "Review is permission-aware, decided server-side: the change merges immediately when your key " +
    "has write access on the Base's node and lands as a pending ChangeRequest otherwise — check the " +
    "response's `materialized` field to see which happened. Pass requireReview to always propose " +
    "instead of merging. Views are structure, not content — when you are building starter structure " +
    "(a Base plus the views that make it usable) let it merge so the workspace is not left half-built " +
    "behind a review queue, exactly as you would for `node_create` and `POST /bases`. " +
    "`create` needs the BASE id; update / delete / restore need the VIEW id — the endpoint split " +
    "follows whichever id identifies the target, which this task handles for you. " +
    "View order is shared by everyone: a new view joins the end, `update` with `position` moves one " +
    "(0 = leftmost), and the leftmost view is what the Base opens on. Every Base keeps at least one " +
    "view, so deleting its last one is rejected — create the replacement first. A new Base already " +
    'starts with a default "Grid view" (every record and field): when you are about to add your own ' +
    "views, create the Base with `node_create` `skipDefaultView` (REST `defaultView: false`) so your " +
    "first view is the one it opens on.",
  annotations: { readOnly: false, destructive: false },
  params: [
    {
      name: "action",
      kind: "enum",
      required: true,
      choices: ACTIONS,
      description: "What to do. Choose this before the other arguments.",
    },
    {
      name: "baseId",
      kind: "string",
      appliesWhen: { param: "action", values: ["create"] },
      description: "Base the view belongs to (create only).",
    },
    {
      name: "viewId",
      kind: "string",
      appliesWhen: { param: "action", values: ["update", "delete", "restore"] },
      description: "Target view id.",
    },
    {
      name: "name",
      kind: "string",
      appliesWhen: { param: "action", values: ["create", "update"] },
      description: "View name (create; or update, to rename it).",
    },
    {
      name: "slug",
      kind: "string",
      appliesWhen: { param: "action", values: ["create"] },
      description:
        "URL slug for the new view, lowercase `a-z`, `0-9` and `-` (create only; fixed afterwards). " +
        "Omit it to have one derived from the name — `view-<hash>` when the name has no ASCII " +
        "letters, with `-2`, `-3`… appended if that one is taken.",
    },
    {
      name: "type",
      kind: "string",
      appliesWhen: { param: "action", values: ["create", "update"] },
      description: "View type: `table`, `gallery`, `kanban`, `calendar` or `gantt`.",
    },
    {
      name: "description",
      kind: "string",
      appliesWhen: { param: "action", values: ["create", "update"] },
      description: "What the view is for (create or update).",
    },
    {
      name: "config",
      kind: "json",
      appliesWhen: { param: "action", values: ["create", "update"] },
      description:
        "View configuration — filters, sorts, visible fields. On update only the keys you pass " +
        "change; `sorts: []` clears the sort.",
    },
    {
      name: "patch",
      kind: "json",
      appliesWhen: { param: "action", values: ["update"] },
      description:
        "The update as one object (`name`, `type`, `description`, `config`, `position`) — the same " +
        "keys the separate arguments set. Pass each key one way, not both (update only).",
    },
    {
      name: "position",
      kind: "number",
      min: 0,
      appliesWhen: { param: "action", values: ["update"] },
      description:
        "Move the view to this 0-based index among the Base's views (update only); the others shift to make room. 0 makes it the view the Base opens on.",
    },
    { name: "message", kind: "string", description: "Explanation for the reviewer." },
    { name: "submittedBy", kind: "string", description: "Producer label recorded on the change." },
    {
      name: "autoMerge",
      kind: "boolean",
      description:
        "Skip review and apply the change immediately if you have write access. Not a permission override — a changeRequest-level key still gets a pending CR. Default is permission-aware: merge when you can, otherwise propose.",
    },
    {
      name: "requireReview",
      kind: "boolean",
      description: "Always propose a pending ChangeRequest, even with write access.",
    },
  ],
  examples: [
    'busabase-cli views change-request --action create --base-id bas_1 --name "Published" --type table',
    'busabase-cli views change-request --action create --base-id bas_1 --name "Published" --require-review',
    'busabase-cli views change-request --action create --base-id bas_1 --name "看板 · 按状态" --slug board-by-status --type kanban',
    "busabase-cli views change-request --action update --view-id viw_1 --position 0",
    'busabase-cli views change-request --action update --view-id viw_1 --name "Open tasks" --config-json \'{"sorts":[{"fieldSlug":"due","direction":"asc"}]}\'',
    "busabase-cli views change-request --action delete --view-id viw_1",
  ],
  execute: async (client: BusabaseTaskClient, input: ViewChangeInput) => {
    // `views.changeRequest` is itself an `operation` union now — `create` still
    // addresses by baseId and the rest by viewId, exactly the split this task
    // used to paper over across two route prefixes.
    type ViewInput = Parameters<BusabaseTaskClient["views"]["changeRequest"]>[0];
    const meta = {
      ...(input.message ? { message: input.message } : {}),
      ...(input.submittedBy ? { submittedBy: input.submittedBy } : {}),
      // Tri-state, like node_create's: omitted keeps the endpoint's
      // permission-aware default, explicit true/false forces the branch.
      ...mergeIntent(input),
    };

    assertApplicable(input);

    if (input.action === "create") {
      if (!input.baseId || !input.name) {
        throw new Error('action "create" requires baseId and name.');
      }
      return client.views.changeRequest({
        operation: "create",
        baseId: input.baseId,
        name: input.name,
        ...(input.slug ? { slug: input.slug } : {}),
        ...(input.type ? { type: input.type } : {}),
        ...(input.description !== undefined ? { description: input.description } : {}),
        ...(input.config ? { config: input.config } : {}),
        ...meta,
      } as ViewInput);
    }

    if (!input.viewId) throw new Error(`action "${input.action}" requires viewId.`);
    const target = { viewId: input.viewId, ...meta };

    if (input.action === "update") {
      // The patch goes first so nothing inside it can retarget the request.
      return client.views.changeRequest({
        ...buildUpdatePatch(input),
        operation: "update",
        ...target,
      } as ViewInput);
    }
    if (input.action === "delete") {
      return client.views.changeRequest({ operation: "delete", ...target } as ViewInput);
    }
    return client.views.changeRequest({ operation: "restore", ...target } as ViewInput);
  },
};
