import type { BusabaseTaskClient, TaskDefinition } from "./types";

/**
 * Changing a Base's schema, as one task with an `operation` instead of six
 * near-identically-named tools.
 *
 * The six endpoints (`bases_create_field_change_request`,
 * `bases_update_field_change_request`, `bases_delete_field_change_request`,
 * `bases_convert_field_change_request`, `bases_reorder_fields_change_request`,
 * `bases_restore_field_change_request`) differ only in the verb buried in the
 * middle of the name. An agent scanning a flat list has to read all six to find
 * the one it wants, and they sort next to each other so the wrong one is always
 * adjacent to the right one.
 *
 * The trade-off is honest: a discriminated input is more for a model to get
 * right than a fixed one. It is mitigated by naming the operation FIRST (so the
 * choice is made before any operation-specific argument), by listing each
 * operation's required arguments in the parameter descriptions, and by
 * validating the combination here with a message that names what is missing —
 * rather than letting the server reject a half-formed payload.
 */

const OPERATIONS = ["add", "update", "delete", "convert", "reorder", "restore"] as const;
type FieldOperation = (typeof OPERATIONS)[number];

export interface BaseFieldChangeInput {
  baseId: string;
  operation: FieldOperation;
  fieldId?: string;
  slug?: string;
  name?: string;
  fieldType?: string;
  required?: boolean;
  options?: unknown;
  patch?: unknown;
  newType?: string;
  selectChoiceMode?: string;
  fieldIds?: string[];
  message?: string;
  submittedBy?: string;
  autoMerge?: boolean;
  requireReview?: boolean;
}

/**
 * `autoMerge` is tri-state — unset (permission-aware default), forced on, forced
 * off — but a CLI boolean flag is presence-only, so `--auto-merge` alone could
 * never express "forced off". Same two-flag shape as `node_create`.
 *
 * Forwarded for EVERY operation, including `delete` and `convert` which do not
 * accept it. That is deliberate: those two branches reject the flag server-side
 * with a message saying why and what to do instead, and a caller who passed it
 * needs to see that. Filtering it out here would make the task quietly swallow
 * the flag — reproducing, for the CLI and MCP callers who are this layer's whole
 * audience, the exact silent-drop failure the server-side rejection exists to
 * end. `params.appliesWhen` still documents which operations accept it.
 */
const mergeIntent = (input: BaseFieldChangeInput): { autoMerge?: boolean } => {
  if (input.requireReview) return { autoMerge: false };
  if (input.autoMerge) return { autoMerge: true };
  return {};
};

/** Which arguments each operation cannot work without. */
const REQUIRED_BY_OPERATION: Record<FieldOperation, readonly string[]> = {
  add: ["slug", "name"],
  update: ["fieldId", "patch"],
  delete: ["fieldId"],
  convert: ["fieldId", "newType"],
  reorder: ["fieldIds"],
  restore: ["fieldId"],
};

const assertRequired = (input: BaseFieldChangeInput): void => {
  const missing = REQUIRED_BY_OPERATION[input.operation].filter((key) => {
    const value = (input as unknown as Record<string, unknown>)[key];
    return value === undefined || value === null || (Array.isArray(value) && value.length === 0);
  });
  if (missing.length > 0) {
    throw new Error(`operation "${input.operation}" requires: ${missing.join(", ")}.`);
  }
};

export const baseFieldChangeTask: TaskDefinition<BaseFieldChangeInput> = {
  name: "base_field_change_request",
  cliPath: ["bases", "field-change-request"],
  summary: "Propose a Base schema change (add / update / delete / convert / reorder / restore)",
  guidance:
    "Review is permission-aware for every operation, decided server-side: the " +
    "change merges immediately when your key has write access on the Base's node and lands as a " +
    "pending ChangeRequest otherwise — check the response's `status`. Pass requireReview to always " +
    "propose instead. Worth doing on `delete` and `convert` when the data matters: delete " +
    "soft-deletes the field's stored values with it (restore brings both back), and convert can " +
    "drop values that do not fit the new type. " +
    "Pick `operation` first, then supply only that operation's arguments — " +
    "add needs slug+name; update needs fieldId+patch; delete/restore need fieldId; " +
    "convert needs fieldId+newType; reorder needs the complete fieldIds order. " +
    "Before a convert, `bases_preview_field_conversion` shows what the data would become.",
  annotations: { readOnly: false, destructive: false },
  params: [
    { name: "baseId", kind: "string", required: true, description: "Base to change." },
    {
      name: "operation",
      kind: "enum",
      required: true,
      choices: OPERATIONS,
      description: "What to do to the schema. Choose this before the other arguments.",
    },
    {
      name: "fieldId",
      kind: "string",
      appliesWhen: { param: "operation", values: ["update", "delete", "convert", "restore"] },
      description: "Target field id.",
    },
    {
      name: "slug",
      kind: "string",
      appliesWhen: { param: "operation", values: ["add"] },
      description: "New field slug (add only).",
    },
    {
      name: "name",
      kind: "string",
      appliesWhen: { param: "operation", values: ["add"] },
      description: "New field display name (add only).",
    },
    {
      name: "fieldType",
      kind: "string",
      appliesWhen: { param: "operation", values: ["add"] },
      description: "New field type, defaults to text (add only).",
    },
    {
      name: "required",
      kind: "boolean",
      appliesWhen: { param: "operation", values: ["add"] },
      description: "Mark the new field required (add only).",
    },
    {
      name: "options",
      kind: "json",
      appliesWhen: { param: "operation", values: ["add"] },
      description: 'Field type options, e.g. {"choices":[{"id":"live","name":"Live"}]} (add only).',
    },
    {
      name: "patch",
      kind: "json",
      appliesWhen: { param: "operation", values: ["update"] },
      description: 'Changes to apply, e.g. {"name":"Status","required":true} (update only).',
    },
    {
      name: "newType",
      kind: "string",
      appliesWhen: { param: "operation", values: ["convert"] },
      description: "Field type to convert to (convert only).",
    },
    {
      name: "selectChoiceMode",
      kind: "enum",
      choices: ["auto_create", "null_on_missing"],
      appliesWhen: { param: "operation", values: ["convert"] },
      description:
        "Converting into a select: create missing choices, or null the value out. Defaults to null_on_missing.",
    },
    {
      name: "fieldIds",
      kind: "stringArray",
      appliesWhen: { param: "operation", values: ["reorder"] },
      description: "Complete field order (reorder only). Repeat the flag per field.",
    },
    { name: "message", kind: "string", description: "Explanation for the reviewer." },
    { name: "submittedBy", kind: "string", description: "Producer label recorded on the change." },
    {
      name: "autoMerge",
      kind: "boolean",
      description:
        "Skip review and apply the schema change immediately if you have write access. Not a permission override — a changeRequest-level key still gets a pending CR. Default is permission-aware: merge when you can, otherwise propose.",
    },
    {
      name: "requireReview",
      kind: "boolean",
      description:
        "Always propose a pending ChangeRequest, even with write access. Worth passing on delete and convert when the field holds data you would not want dropped without a second look.",
    },
  ],
  examples: [
    "busabase-cli bases field-change-request --base-id bas_1 --operation add --slug status --name Status --field-type select",
    "busabase-cli bases field-change-request --base-id bas_1 --operation update --field-id fld_1 --patch-json '{\"required\":true}'",
    "busabase-cli bases field-change-request --base-id bas_1 --operation reorder --field-ids fld_2 --field-ids fld_1",
  ],
  execute: async (client: BusabaseTaskClient, input: BaseFieldChangeInput) => {
    assertRequired(input);
    // The contract endpoint is itself an `operation` discriminated union now, so
    // this is a straight pass-through: the task's job here is the vocabulary
    // ("add" reads better than "create" for a field) and the guidance, not the
    // fan-out it used to do across six endpoints.
    const common = {
      baseId: input.baseId,
      ...(input.message ? { message: input.message } : {}),
      ...(input.submittedBy ? { submittedBy: input.submittedBy } : {}),
      ...mergeIntent(input),
    };
    type FieldInput = Parameters<BusabaseTaskClient["bases"]["fieldChangeRequest"]>[0];

    switch (input.operation) {
      case "add":
        return client.bases.fieldChangeRequest({
          ...common,
          operation: "create",
          slug: input.slug,
          name: input.name,
          ...(input.fieldType ? { type: input.fieldType } : {}),
          ...(input.required !== undefined ? { required: input.required } : {}),
          ...(input.options ? { options: input.options } : {}),
        } as FieldInput);
      case "update":
        return client.bases.fieldChangeRequest({
          ...common,
          operation: "update",
          fieldId: input.fieldId,
          patch: input.patch,
        } as FieldInput);
      case "delete":
        return client.bases.fieldChangeRequest({
          ...common,
          operation: "delete",
          fieldId: input.fieldId,
        } as FieldInput);
      case "convert":
        return client.bases.fieldChangeRequest({
          ...common,
          operation: "convert",
          fieldId: input.fieldId,
          newType: input.newType,
          ...(input.selectChoiceMode ? { selectChoiceMode: input.selectChoiceMode } : {}),
        } as FieldInput);
      case "reorder":
        return client.bases.fieldChangeRequest({
          ...common,
          operation: "reorder",
          fieldIds: input.fieldIds,
        } as FieldInput);
      default:
        return client.bases.fieldChangeRequest({
          ...common,
          operation: "restore",
          fieldId: input.fieldId,
        } as FieldInput);
    }
  },
};
