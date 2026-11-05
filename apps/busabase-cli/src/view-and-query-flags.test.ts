import { BUSABASE_TASKS } from "busabase-contract/tasks";
import { Command } from "commander";
import { describe, expect, it, vi } from "vitest";
import { registerTaskCommands } from "./task-command";

/**
 * Flags must reach the request or be refused — never dropped.
 *
 * `views change-request --action update --name … --config-json … --position 4`
 * applied only the position, and without `--position` it claimed nothing had
 * been passed. `--action create` had no `--slug`, so a CJK-named view could not
 * be given one. `records query --view-id` listed the whole Base as if it were
 * the View. These run the real Commander adapter over the shared task, so the
 * flag spelling a user types is what is under test.
 */
const run = async (taskName: string, args: string[]) => {
  const calls: { endpoint: string; input: Record<string, unknown> }[] = [];
  const endpoint =
    (name: string) =>
    async (input: unknown): Promise<unknown> => {
      calls.push({ endpoint: name, input: input as Record<string, unknown> });
      return { ok: true };
    };
  const client = {
    views: { changeRequest: vi.fn(endpoint("views.changeRequest")) },
    records: {
      list: vi.fn(endpoint("records.list")),
      count: vi.fn(endpoint("records.count")),
    },
  };
  const program = new Command().exitOverride();
  registerTaskCommands(
    program,
    BUSABASE_TASKS.filter((task) => task.name === taskName),
    {
      addGlobalFlags: (cmd) => cmd,
      runAction: (handler) => async (opts) => {
        await handler(client, opts);
      },
      parseJsonValue: (raw) => JSON.parse(raw),
      parseFieldSpecs: () => [],
    },
  );
  await program.parseAsync(args, { from: "user" });
  return calls;
};

const views = (...args: string[]) =>
  run("view_change_request", ["views", "change-request", ...args]);

describe("views change-request flags", () => {
  it("create sends --slug and --description", async () => {
    const [call] = await views(
      "--action",
      "create",
      "--base-id",
      "bas_1",
      "--name",
      "看板 · 按状态",
      "--slug",
      "board-by-status",
      "--type",
      "kanban",
      "--description",
      "Open work by status",
    );
    expect(call?.input).toMatchObject({
      operation: "create",
      baseId: "bas_1",
      name: "看板 · 按状态",
      slug: "board-by-status",
      type: "kanban",
      description: "Open work by status",
    });
  });

  it("update sends --name and --config-json alongside --position", async () => {
    const config = { sorts: [{ fieldSlug: "due", direction: "asc" }] };
    const [call] = await views(
      "--action",
      "update",
      "--view-id",
      "viw_1",
      "--name",
      "全部待办",
      "--config-json",
      JSON.stringify(config),
      "--position",
      "4",
    );
    expect(call?.input).toMatchObject({
      operation: "update",
      viewId: "viw_1",
      name: "全部待办",
      config,
      position: 4,
    });
  });

  it("update accepts --name / --config-json / --type / --description without --position or --patch-json", async () => {
    const [renamed] = await views("--action", "update", "--view-id", "viw_1", "--name", "全部待办");
    expect(renamed?.input).toMatchObject({ operation: "update", name: "全部待办" });
    expect(renamed?.input).not.toHaveProperty("position");

    const [configured] = await views(
      "--action",
      "update",
      "--view-id",
      "viw_1",
      "--config-json",
      '{"sorts":[]}',
      "--type",
      "gallery",
      "--description",
      "Cards",
    );
    expect(configured?.input).toMatchObject({
      config: { sorts: [] },
      type: "gallery",
      description: "Cards",
    });
  });

  it("update still takes --patch-json, merged with the separate flags", async () => {
    const [call] = await views(
      "--action",
      "update",
      "--view-id",
      "viw_1",
      "--patch-json",
      '{"config":{"visibleFieldSlugs":["title"]}}',
      "--name",
      "Titles",
    );
    expect(call?.input).toMatchObject({
      name: "Titles",
      config: { visibleFieldSlugs: ["title"] },
    });
  });

  it("update with nothing to change is refused, naming the flags that would count", async () => {
    await expect(views("--action", "update", "--view-id", "viw_1")).rejects.toThrow(
      /requires a change: name, type, description, config, position, or patch/,
    );
  });

  it("refuses flags the action cannot apply instead of dropping them", async () => {
    await expect(
      views("--action", "update", "--view-id", "viw_1", "--slug", "renamed"),
    ).rejects.toThrow(/does not take: slug/);
    await expect(
      views("--action", "delete", "--view-id", "viw_1", "--name", "Gone"),
    ).rejects.toThrow(/does not take: name/);
    await expect(
      views("--action", "create", "--base-id", "bas_1", "--name", "New", "--position", "0"),
    ).rejects.toThrow(/does not take: position/);
  });

  it("refuses a key given both on its own and inside --patch-json with different values", async () => {
    await expect(
      views(
        "--action",
        "update",
        "--view-id",
        "viw_1",
        "--name",
        "A",
        "--patch-json",
        '{"name":"B"}',
      ),
    ).rejects.toThrow(/name was passed both/);
    await expect(
      views("--action", "update", "--view-id", "viw_1", "--patch-json", '{"slug":"x"}'),
    ).rejects.toThrow(/patch does not take slug/);
  });
});

describe("records query --view-id", () => {
  it("is refused when listing, and points at records list-page", async () => {
    await expect(
      run("record_query", ["records", "query", "--base-id", "bas_1", "--view-id", "viw_1"]),
    ).rejects.toThrow(/records list-page --base-id <base> --view-id <view>/);
  });

  it("still scopes records count", async () => {
    const [call] = await run("record_query", [
      "records",
      "count",
      "--base-id",
      "bas_1",
      "--view-id",
      "viw_1",
    ]);
    expect(call).toEqual({
      endpoint: "records.count",
      input: { baseId: "bas_1", viewId: "viw_1" },
    });
  });
});
