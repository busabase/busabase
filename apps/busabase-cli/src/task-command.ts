import {
  type BUSABASE_TASKS,
  type TaskDefinition,
  type TaskParam,
  taskParamFlag,
} from "busabase-contract/tasks";
import { type Command, InvalidArgumentError, Option, type OptionValues } from "commander";

/**
 * Renders shared task definitions (`busabase-contract/tasks`) into commander
 * commands.
 *
 * The same definitions are rendered into MCP tools on the server side, so a
 * command's flags, help text, and examples are written once and both surfaces
 * stay in step. Before this existed, the CLI's hand-written commands were the
 * only place that knowledge lived and MCP re-derived its catalog straight off
 * the OpenAPI contract, which is why MCP had six ways to create a node and no
 * hint that `nodes purge` needs an already-archived node.
 *
 * `deps` is injected rather than imported so the node-only helpers (`@file`
 * reading, credential resolution) stay in `run.ts` and this module can be
 * reasoned about on its own.
 */

export interface TaskCommandDeps {
  /** Attaches --base-url/--api-key/--space-id/--output etc. */
  readonly addGlobalFlags: (cmd: Command) => Command;
  /** Wraps a handler with config resolution, auth, and output rendering. */
  readonly runAction: (
    handler: (client: unknown, opts: OptionValues) => Promise<unknown>,
  ) => (opts: OptionValues, cmd: Command) => Promise<void>;
  /** Parses inline JSON or `@file`. */
  readonly parseJsonValue: (raw: string, flagName: string) => unknown;
  /** Parses `slug:name:type` field shorthand. */
  readonly parseFieldSpecs: (specs: string[]) => unknown[];
}

const collect = (value: string, previous: string[] = []): string[] => [...previous, value];

/** Range-checks before the request goes out, so a cap surfaces as a usage error. */
const numericParser =
  (param: TaskParam) =>
  (value: string): number => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed))
      throw new InvalidArgumentError(`expected a number, got "${value}"`);
    if (param.min !== undefined && parsed < param.min) {
      throw new InvalidArgumentError(`expected a number >= ${param.min}`);
    }
    if (param.max !== undefined && parsed > param.max) {
      throw new InvalidArgumentError(`expected a number <= ${param.max}`);
    }
    return parsed;
  };

/** `fields` -> `--fields-json`, the flag that takes the full JSON value. */
const jsonFlagFor = (param: TaskParam): string => `${taskParamFlag(param)}-json`;

/** commander stores `--fields-json` as `opts.fieldsJson`. */
const optionKey = (flag: string): string =>
  flag.replace(/^--/, "").replace(/-([a-z0-9])/g, (_, char: string) => char.toUpperCase());

const applyParam = (cmd: Command, param: TaskParam): void => {
  const flag = taskParamFlag(param);
  const description = param.description;

  switch (param.kind) {
    case "boolean":
      cmd.option(flag, description);
      return;
    case "number": {
      const parse = numericParser(param);
      if (param.required) cmd.requiredOption(`${flag} <value>`, description, parse);
      else cmd.option(`${flag} <value>`, description, parse);
      return;
    }
    case "enum": {
      const choices = [...(param.choices ?? [])];
      // Spell the choices into the placeholder, not just into commander's
      // `.choices()` validation: the root help renders usage lines only, so
      // `--type <value>` would leave a reader guessing at the 11 node types.
      const placeholder = choices.length > 0 ? `<${choices.join("|")}>` : "<value>";
      const option = new Option(`${flag} ${placeholder}`, description).choices(choices);
      if (param.required) option.makeOptionMandatory();
      cmd.addOption(option);
      return;
    }
    case "stringArray":
      cmd.option(`${flag} <value>`, `${description} (repeatable)`, collect);
      return;
    case "json": {
      const jsonOption = `${jsonFlagFor(param)} <json|@file>`;
      if (param.required) cmd.requiredOption(jsonOption, description);
      else cmd.option(jsonOption, description);
      if (param.cliShorthand) {
        cmd.option(
          `${param.cliShorthand.flag} ${param.cliShorthand.placeholder}`,
          param.cliShorthand.description,
          collect,
        );
      }
      return;
    }
    default:
      if (param.required) cmd.requiredOption(`${flag} <value>`, description);
      else cmd.option(`${flag} <value>`, description);
  }
};

const readParam = (param: TaskParam, opts: OptionValues, deps: TaskCommandDeps): unknown => {
  // Read by the FLAG's derived key, not by the parameter name. They differ
  // whenever `cliFlag` overrides the default — `changeRequestIds` is typed as a
  // repeated `--change-request-id`, which commander stores as
  // `opts.changeRequestId`. Reading by parameter name silently returned
  // undefined, so the task saw no ids at all.
  if (param.kind !== "json") return opts[optionKey(taskParamFlag(param))];

  const jsonFlag = jsonFlagFor(param);
  const raw = opts[optionKey(jsonFlag)] as string | undefined;
  const shorthandValues = param.cliShorthand
    ? (opts[optionKey(param.cliShorthand.flag)] as string[] | undefined)
    : undefined;

  // Both spellings set the same task parameter, so accepting both at once would
  // mean silently honouring one and dropping the other.
  if (raw && shorthandValues && shorthandValues.length > 0) {
    throw new Error(`Pass either ${param.cliShorthand?.flag} or ${jsonFlag}, not both.`);
  }
  if (raw) return deps.parseJsonValue(raw, jsonFlag.replace(/^--/, ""));
  if (shorthandValues && shorthandValues.length > 0) {
    return param.cliShorthand?.parser === "fieldSpecs"
      ? deps.parseFieldSpecs(shorthandValues)
      : shorthandValues;
  }
  return undefined;
};

const buildInput = (
  task: TaskDefinition<Record<string, unknown>>,
  opts: OptionValues,
  deps: TaskCommandDeps,
): Record<string, unknown> => {
  const input: Record<string, unknown> = {};
  for (const param of task.params) {
    const value = readParam(param, opts, deps);
    if (value !== undefined) input[param.name] = value;
  }
  return input;
};

/** Finds an existing top-level group (`nodes`, `records`, …) or creates it. */
const resolveGroup = (program: Command, name: string): Command =>
  program.commands.find((command) => command.name() === name) ??
  program.command(name).description(`${name} commands`);

/**
 * Registers one command for a task at `path`, with `preset` parameters hidden
 * and merged in at call time.
 *
 * The preset is applied AFTER the parsed flags, so a variant's fixed value wins
 * over anything a user could type — `airapps files --kind skill` must not become
 * a Skill lookup just because the flag exists on the underlying task.
 */
const registerOne = (
  program: Command,
  task: TaskDefinition<Record<string, unknown>>,
  deps: TaskCommandDeps,
  path: readonly string[],
  preset: Readonly<Record<string, unknown>> = {},
  summaryOverride?: string,
): void => {
  const [groupName, ...rest] = path;
  const parent = rest.length > 0 ? resolveGroup(program, groupName) : program;
  const leafName = rest.length > 0 ? rest.join("-") : groupName;

  // Aliases belong to the task's primary entry point only. A variant lives in a
  // different command group, where the alias would be both meaningless and
  // actively harmful: `node_create`'s `create-change-request` alias would make
  // the `bases create` variant collide with the unrelated hand-written
  // `bases create-change-request` and get silently skipped.
  const isVariant = Object.keys(preset).length > 0;
  const aliases = isVariant ? [] : (task.cliAliases ?? []);
  const taken = [leafName, ...aliases];
  if (
    parent.commands.some(
      (command) =>
        taken.includes(command.name()) || command.aliases().some((alias) => taken.includes(alias)),
    )
  ) {
    return;
  }

  const cmd = deps
    .addGlobalFlags(parent.command(leafName))
    .description(summaryOverride ?? task.summary);
  for (const alias of aliases) cmd.alias(alias);
  for (const param of task.params) {
    if (param.name in preset) continue; // fixed by the variant, not a user choice
    // A variant that pins `type: "airapp"` should not advertise `--body`, which
    // only applies to Docs and would always be rejected here.
    const gate = param.appliesWhen;
    if (gate && gate.param in preset) {
      const pinned = preset[gate.param];
      if (typeof pinned === "string" && !gate.values.includes(pinned)) continue;
    }
    applyParam(cmd, param);
  }

  // A task may call several endpoints, so it has no single HTTP method — but it
  // does declare whether it reads. Offering `--dry-run` only on the ones that
  // write keeps the flag meaningful everywhere it appears.
  if (!task.annotations.readOnly) {
    cmd.option("--dry-run", "print the request this would send and send nothing");
  }

  // `guidance` is the paragraph that tells a caller how to USE the command —
  // that `nextCursor` non-null means keep paging rather than raise `limit`, that
  // finding a record by field value is a different task. The MCP adapter has
  // always delivered it; the CLI rendered params and examples and dropped it, so
  // an agent driving the CLI was told strictly less than the same agent over MCP.
  if (task.guidance) {
    cmd.addHelpText("after", `\n${wrapGuidance(rewriteTaskNames(task.guidance))}`);
  }

  if (task.examples && task.examples.length > 0 && Object.keys(preset).length === 0) {
    cmd.addHelpText("after", `\nExamples:\n  ${task.examples.join("\n  ")}`);
  }

  cmd.action(
    deps.runAction(async (client, opts) =>
      task.execute(client as Parameters<typeof task.execute>[0], {
        ...buildInput(task, opts, deps),
        ...preset,
      }),
    ),
  );
};

export const registerTaskCommands = (
  program: Command,
  tasks: typeof BUSABASE_TASKS,
  deps: TaskCommandDeps,
): void => {
  for (const task of tasks) {
    cliPathByTaskName.set(task.name, `busabase-cli ${task.cliPath.join(" ")}`);
  }
  for (const task of tasks) {
    registerOne(program, task, deps, task.cliPath);
    for (const variant of task.cliVariants ?? []) {
      registerOne(program, task, deps, variant.path, variant.preset, variant.summary);
    }
  }
};

/**
 * Guidance is written once and read by two surfaces, so it names sibling tasks
 * by their MCP tool name (`record_find_by_field`). That is not something a CLI
 * caller can type — the command is `records by-field-text` — so the shared text
 * is rewritten to this surface's vocabulary rather than forked.
 */
const rewriteTaskNames = (text: string): string =>
  text.replace(/`([a-z][a-z0-9_]*)`/g, (match, name: string) => {
    const path = cliPathByTaskName.get(name);
    return path ? `\`${path}\`` : match;
  });

/** Filled by {@link registerTaskCommands}; empty until the surface is built. */
const cliPathByTaskName = new Map<string, string>();

/** Reflow guidance to the width commander uses for the rest of the help screen. */
const wrapGuidance = (text: string, width = 78): string => {
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(/\s+/).filter(Boolean)) {
    if (line && `${line} ${word}`.length > width) {
      lines.push(line);
      line = word;
    } else {
      line = line ? `${line} ${word}` : word;
    }
  }
  if (line) lines.push(line);
  return lines.join("\n");
};
