import { BUSABASE_TASKS } from "busabase-contract/tasks";
import { Command } from "commander";
import { describe, expect, it, vi } from "vitest";
import { registerTaskCommands } from "./task-command";

const commands = [
  {
    name: "record_change_request",
    args: [
      "records",
      "change-request",
      "--record-id",
      "rec_1",
      "--operation",
      "update",
      "--fields-json",
      '{"count":99}',
    ],
    endpoint: "records.changeRequest",
  },
  {
    name: "record_bulk_update_change_request",
    args: [
      "records",
      "bulk-update-change-request",
      "--base-id",
      "bas_1",
      "--updates-json",
      '[{"recordId":"rec_1","fields":{"count":99}}]',
    ],
    endpoint: "bases.createBulkUpdateChangeRequest",
  },
  {
    name: "view_change_request",
    args: [
      "views",
      "change-request",
      "--action",
      "create",
      "--base-id",
      "bas_1",
      "--name",
      "Reviewed",
    ],
    endpoint: "views.changeRequest",
  },
  {
    name: "base_field_change_request",
    args: [
      "bases",
      "field-change-request",
      "--operation",
      "delete",
      "--base-id",
      "bas_1",
      "--field-id",
      "fld_1",
    ],
    endpoint: "bases.fieldChangeRequest",
  },
  {
    name: "node_files_change_request",
    args: [
      "nodes",
      "files-change-request",
      "--kind",
      "skill",
      "--node-id",
      "nod_1",
      "--operations-json",
      '[{"kind":"delete","path":"SKILL.md"}]',
    ],
    endpoint: "fileTrees.createChangeRequest",
  },
  {
    name: "node_create",
    args: ["nodes", "create", "--type", "folder", "--slug", "reviewed", "--name", "Reviewed"],
    endpoint: "nodes.createChangeRequest",
  },
  {
    name: "node_archive",
    args: ["nodes", "archive", "--node-id", "nod_1"],
    endpoint: "nodes.createChangeRequest",
  },
];

const flags = [
  { label: "absent boolean flags stay omitted", args: [], expected: undefined },
  { label: "--auto-merge opts in", args: ["--auto-merge"], expected: true },
  { label: "--require-review forces review", args: ["--require-review"], expected: false },
  {
    label: "review takes precedence when both flags are present",
    args: ["--auto-merge", "--require-review"],
    expected: false,
  },
];

// Run the real Commander adapter and shared task dispatch. Absent boolean
// options must remain undefined, rather than becoming an unintended false.
// This protects normal CLI writes while MCP can pass an explicit false.

describe.each(commands)("CLI review intent: $name", (command) => {
  it.each(flags)("$label", async (flag) => {
    const send = vi.fn(async (_input: unknown) => ({ status: "in_review", materialized: false }));
    const [namespace, method] = command.endpoint.split(".");
    const client = { [namespace]: { [method]: send } };
    const program = new Command().exitOverride();
    const tasks = BUSABASE_TASKS.filter((task) => task.name === command.name);
    expect(tasks).toHaveLength(1);
    registerTaskCommands(program, tasks, {
      addGlobalFlags: (cmd) => cmd,
      runAction: (handler) => async (opts) => {
        await handler(client, opts);
      },
      parseJsonValue: (raw) => JSON.parse(raw),
      parseFieldSpecs: () => [],
    });

    await program.parseAsync([...command.args, ...flag.args], { from: "user" });

    expect(send).toHaveBeenCalledTimes(1);
    const payload = send.mock.calls[0]?.[0] as Record<string, unknown>;
    if (flag.expected === undefined) {
      expect(payload).not.toHaveProperty("autoMerge");
    } else {
      expect(payload).toHaveProperty("autoMerge", flag.expected);
    }
  });
});
