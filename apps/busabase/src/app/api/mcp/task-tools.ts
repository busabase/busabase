import {
  BUSABASE_TASKS,
  type BusabaseTaskClient,
  type TaskDefinition,
  taskInputSchema,
} from "busabase-contract/tasks";
import type { McpCustomTool } from "openlib/mcp";

/**
 * Task-level MCP tools for the self-hosted server.
 *
 * Same shared definitions the CLI renders into commands and cloud renders into
 * its own tools. The only difference from cloud's adapter is the client shape:
 * this server mounts the Busabase contract at the root, so `client.nodes.*`
 * works directly with no `workbench` level to unwrap.
 */

const describeTask = (task: TaskDefinition<Record<string, unknown>>): string =>
  [task.summary, task.guidance].filter(Boolean).join("\n\n");

const toCustomTool = (
  task: TaskDefinition<Record<string, unknown>>,
): McpCustomTool<BusabaseTaskClient> => ({
  name: task.name,
  title: task.summary,
  description: describeTask(task),
  inputSchema: taskInputSchema(task.params, { omitCliOnly: true }),
  keyPath: ["tasks", task.name],
  annotations: {
    readOnlyHint: task.annotations.readOnly,
    destructiveHint: task.annotations.destructive,
    openWorldHint: false,
  },
  execute: async (client, input) => task.execute(client, (input ?? {}) as Record<string, unknown>),
});

export const busabaseLocalMcpTaskTools = (): McpCustomTool<BusabaseTaskClient>[] =>
  BUSABASE_TASKS.map(toCustomTool);
