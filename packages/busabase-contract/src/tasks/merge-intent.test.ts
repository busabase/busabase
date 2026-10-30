import { describe, expect, it, vi } from "vitest";
import { baseFieldChangeTask } from "./base-field";
import { nodeFilesChangeRequestTask } from "./file-tree";
import { nodeArchiveTask } from "./node-archive";
import { nodeCreateTask } from "./node-create";
import { recordBulkUpdateTask } from "./record-bulk-update";
import { recordChangeTask } from "./record-change";
import { type BusabaseTaskClient, type TaskParam, taskInputSchema } from "./types";
import { viewChangeTask } from "./view-change";

interface TaskCase {
  label: string;
  params: readonly TaskParam[];
  execute: (client: BusabaseTaskClient, input: never) => Promise<unknown>;
  input: Record<string, unknown>;
  endpoint: string;
}

// Exercise dispatch branches, not just the private helper: every endpoint must
// receive the caller's review choice after the shared MCP schema parses it.
const cases: TaskCase[] = [
  ...(["update", "delete", "restore"] as const).map((operation) => ({
    ...recordChangeTask,
    label: `record ${operation}`,
    input: { recordId: "rec_1", operation, fields: { count: 99 } },
    endpoint: "records.changeRequest",
  })),
  {
    ...recordBulkUpdateTask,
    label: "record batch",
    input: { baseId: "bas_1", updates: [{ recordId: "rec_1", fields: { count: 99 } }] },
    endpoint: "bases.createBulkUpdateChangeRequest",
  },
  ...(["create", "update", "delete", "restore"] as const).map((action) => ({
    ...viewChangeTask,
    label: `view ${action}`,
    input: { action, baseId: "bas_1", viewId: "viw_1", name: "Reviewed", position: 0 },
    endpoint: "views.changeRequest",
  })),
  ...(["add", "update", "delete", "convert", "reorder", "restore"] as const).map((operation) => ({
    ...baseFieldChangeTask,
    label: `field ${operation}`,
    input: {
      operation,
      baseId: "bas_1",
      fieldId: "fld_1",
      slug: "count",
      name: "Count",
      patch: { name: "Reviewed count" },
      newType: "text",
      fieldIds: ["fld_1"],
    },
    endpoint: "bases.fieldChangeRequest",
  })),
  ...(["create", "update", "delete", "metadata_update"] as const).map((kind) => ({
    ...nodeFilesChangeRequestTask,
    label: `skill file ${kind}`,
    input: { kind: "skill", nodeId: "nod_1", operations: [{ kind, path: "SKILL.md" }] },
    endpoint: "fileTrees.createChangeRequest",
  })),
  ...(["drive", "airapp"] as const).map((kind) => ({
    ...nodeFilesChangeRequestTask,
    label: `${kind} file update`,
    input: { kind, nodeId: "nod_1", operations: [{ kind: "update", path: "README.md" }] },
    endpoint: "fileTrees.createChangeRequest",
  })),
  ...(
    [
      "folder",
      "form",
      "whiteboard",
      "workflow",
      "html",
      "doc",
      "base",
      "file",
      "skill",
      "drive",
      "airapp",
    ] as const
  ).map((type) => ({
    ...nodeCreateTask,
    label: `create ${type}`,
    input: {
      type,
      slug: "reviewed",
      name: "Reviewed",
      ...(type === "file" ? { assetId: "ast_1" } : {}),
    },
    endpoint:
      type === "doc"
        ? "docs.create"
        : type === "base"
          ? "bases.create"
          : type === "file"
            ? "files.create"
            : ["skill", "drive", "airapp"].includes(type)
              ? "fileTrees.create"
              : "nodes.createChangeRequest",
  })),
  {
    ...nodeArchiveTask,
    label: "archive node",
    input: { nodeId: "nod_1" },
    endpoint: "nodes.createChangeRequest",
  },
];

const intents = [
  { label: "omitted keeps permission-aware default", input: {}, expected: undefined },
  { label: "explicit false requires review", input: { autoMerge: false }, expected: false },
  {
    label: "explicit true reaches server permission check",
    input: { autoMerge: true },
    expected: true,
  },
  { label: "requireReview forces review", input: { requireReview: true }, expected: false },
  {
    label: "requireReview overrides explicit true",
    input: { autoMerge: true, requireReview: true },
    expected: false,
  },
  {
    label: "false requireReview does not erase explicit false",
    input: { autoMerge: false, requireReview: false },
    expected: false,
  },
];

describe.each(cases)("task merge intent: $label", (task) => {
  it.each(intents)("$label", async (intent) => {
    const send = vi.fn(async (_input: unknown) => ({ status: "in_review", materialized: false }));
    const [namespace, method] = task.endpoint.split(".");
    const client = { [namespace]: { [method]: send } } as unknown as BusabaseTaskClient;
    const parsed = taskInputSchema(task.params, { omitCliOnly: true }).parse({
      ...task.input,
      ...intent.input,
    });

    await task.execute(client, parsed as never);

    expect(send).toHaveBeenCalledTimes(1);
    const payload = send.mock.calls[0]?.[0] as unknown as Record<string, unknown>;
    if (intent.expected === undefined) {
      expect(payload).not.toHaveProperty("autoMerge");
    } else {
      expect(payload).toHaveProperty("autoMerge", intent.expected);
    }
  });
});
