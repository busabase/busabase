import type { ContractRouterClient } from "@orpc/contract";
import { z } from "zod";
import type { BusabaseContract } from "../contract/busabase";

/**
 * The task layer: a transport-neutral description of what a *user* (human at a
 * terminal, or an agent over MCP) is trying to accomplish, as opposed to which
 * HTTP endpoint serves it.
 *
 * Why this exists: the OpenAPI contract is endpoint-shaped, and both surfaces
 * that sit on top of it used to derive their command/tool list from it directly.
 * That is right for an SDK — one function per endpoint — and wrong for a human
 * or an agent, who thinks "create a Skill with these files", not "POST /file-trees
 * (but POST /nodes/change-requests if it's a Doc, and also POST /bases if it's a
 * Base)". `busabase-cli` had already hand-written that translation for 51
 * commands; every one of them was invisible to MCP, which re-derived a 137-tool
 * catalog straight off the contract.
 *
 * A `TaskDefinition` is that translation, written once:
 *   - `busabase-cli` renders it into a commander command (see `task-command.ts`)
 *   - the MCP servers render it into a tool (see `mcp/logic/task-tools.ts`)
 *
 * Deliberately NOT in scope here: the OpenAPI contract itself. Tasks compose the
 * existing endpoints through the generated client; they never bypass it, and
 * removing this whole directory would leave the REST surface untouched.
 */

/**
 * The typed oRPC client both adapters hand to `execute`. Pure type — inferred
 * from the contract, so this module still drags no server code into a bundle.
 *
 * Narrowed to the namespaces tasks actually call, rather than the whole client,
 * because the hosts do not all serve the whole contract: cloud drops `live` and
 * `vault` from its public surface, so requiring the full client here would make
 * cloud's own client structurally incompatible with its own tasks. Widen this
 * list when a task needs a namespace it does not have.
 */
type FullBusabaseClient = ContractRouterClient<BusabaseContract>;

export type BusabaseTaskClient = {
  readonly nodes: Pick<
    FullBusabaseClient["nodes"],
    "createChangeRequest" | "list" | "principals" | "share"
  >;
  readonly views: Pick<FullBusabaseClient["views"], "changeRequest">;
  /** Skills, Drives, and AirApps all read and write through this one surface. */
  readonly fileTrees: Pick<
    FullBusabaseClient["fileTrees"],
    "create" | "list" | "get" | "listFiles" | "readFile" | "createChangeRequest"
  >;
  readonly docs: Pick<FullBusabaseClient["docs"], "create">;
  readonly bases: Pick<
    FullBusabaseClient["bases"],
    "create" | "fieldChangeRequest" | "list" | "listDeletedFields" | "listViews"
  >;
  readonly files: Pick<FullBusabaseClient["files"], "create">;
  readonly records: Pick<
    FullBusabaseClient["records"],
    "search" | "list" | "count" | "changeRequest"
  >;
  readonly changeRequests: Pick<
    FullBusabaseClient["changeRequests"],
    "list" | "counts" | "review" | "merge"
  >;
};

export type TaskParamKind = "string" | "number" | "boolean" | "enum" | "stringArray" | "json";

export interface TaskParam {
  /** Key in the task's input object, camelCase. Also the MCP JSON-Schema property name. */
  readonly name: string;
  readonly kind: TaskParamKind;
  readonly required?: boolean;
  /** Allowed values when `kind` is `"enum"`. */
  readonly choices?: readonly string[];
  /**
   * Inclusive bounds for a `number` param. Enforced in the generated schema AND
   * by the CLI before a request goes out — a server-side cap that only surfaces
   * as an HTTP error costs a round trip and reads like a server fault.
   */
  readonly min?: number;
  readonly max?: number;
  /** Shown in CLI `--help` and as the MCP parameter description. Write it for
   *  whoever reads it cold — an agent has no other source of context. */
  readonly description: string;
  /** Override the derived `--kebab-case` flag (e.g. `type` -> `--type`). */
  readonly cliFlag?: string;
  /** CLI-only: flag may be repeated, values collected into an array. */
  readonly repeatable?: boolean;
  /**
   * Reachable from the CLI but not over MCP — for parameters that only mean
   * something on the caller's own machine (a local file path, say). The MCP
   * adapter drops these from the tool's input schema entirely rather than
   * advertising a parameter no remote agent could ever satisfy.
   */
  readonly cliOnly?: boolean;
  /**
   * An extra, terser CLI spelling for a `json` param — `--field title:Title:text`
   * repeated, instead of hand-writing a JSON array. Purely a CLI affordance; MCP
   * ignores it, since an agent emitting structured arguments gains nothing from
   * a string DSL.
   *
   * `parser` is a KEY, not a function: the actual parsing needs `node:fs` (for
   * `@file`) and belongs in the CLI, so this layer only names which parser to
   * use and stays pure data.
   */
  readonly cliShorthand?: {
    readonly flag: string;
    readonly placeholder: string;
    readonly description: string;
    readonly parser: TaskShorthandParser;
  };
  /**
   * This parameter only means something when another parameter holds one of
   * these values — `fields` only applies to `type: "base"`, `body` only to
   * `type: "doc"`.
   *
   * A CLI variant that pins that other parameter (`bases create`, which fixes
   * `type: "base"`) uses this to hide the parameters that cannot apply, instead
   * of listing `--body` under a command where passing it is always an error.
   * MCP still advertises every parameter, since one tool covers every type
   * there; `execute` rejects mismatched combinations either way.
   */
  readonly appliesWhen?: {
    readonly param: string;
    readonly values: readonly string[];
  };
}

/** Parsers the CLI adapter implements; referenced by key from `cliShorthand`. */
export type TaskShorthandParser = "fieldSpecs";

export interface TaskAnnotations {
  readonly readOnly: boolean;
  readonly destructive: boolean;
}

export interface TaskDefinition<TInput = Record<string, unknown>> {
  /** MCP tool name, snake_case. */
  readonly name: string;
  /** CLI command path, e.g. `["nodes", "create"]`. */
  readonly cliPath: readonly string[];
  /**
   * Previous CLI spellings kept working as aliases. A task that renames a
   * command must list the old leaf name here — scripts and docs in the wild
   * refer to it, and a rename that breaks them is not a clarification.
   */
  readonly cliAliases?: readonly string[];
  /**
   * Extra CLI entry points that pre-fill some parameters.
   *
   * The two surfaces do not want the same granularity. An agent picking from a
   * flat tool list is better served by one `node_files_list` with a `kind`
   * parameter than by three near-identical tools it has to tell apart. A human
   * typing at a terminal is better served by `airapps files` than by
   * `nodes files --kind airapp`. Both are right for their surface.
   *
   * A variant is therefore CLI-only: it renders an additional command with the
   * preset parameters hidden and merged in at call time. The task's logic,
   * validation, and descriptions stay single-source — only the presentation
   * differs, which is the part that legitimately differs.
   */
  readonly cliVariants?: readonly {
    readonly path: readonly string[];
    readonly preset: Readonly<Record<string, unknown>>;
    readonly summary?: string;
  }[];
  /** One line, shown as the CLI description and the first line of the MCP description. */
  readonly summary: string;
  /**
   * Extra context appended to the MCP tool description only. This is where
   * knowledge that lives in CLI `--help` prose — "archive first, purge only
   * works on an already-archived node" — gets carried across to agents, which
   * otherwise see nothing but a bare endpoint summary.
   */
  readonly guidance?: string;
  readonly params: readonly TaskParam[];
  /** CLI `--help` examples. */
  readonly examples?: readonly string[];
  readonly annotations: TaskAnnotations;
  /**
   * Runs the task against the real API. May call more than one endpoint (that is
   * the point — see `node-create.ts`), but must go through `client`, never a raw
   * fetch, so auth/base-url/space headers stay the caller's business.
   */
  readonly execute: (client: BusabaseTaskClient, input: TInput) => Promise<unknown>;
}

const paramSchema = (param: TaskParam): z.ZodTypeAny => {
  switch (param.kind) {
    case "boolean":
      return z.boolean();
    case "number": {
      let schema = z.number();
      if (param.min !== undefined) schema = schema.min(param.min);
      if (param.max !== undefined) schema = schema.max(param.max);
      return schema;
    }
    case "enum":
      // A task with an enum param and no choices is a definition bug, not a
      // runtime condition — fall back to a plain string rather than building a
      // z.enum([]) that rejects everything.
      return param.choices && param.choices.length > 0
        ? z.enum([...param.choices] as [string, ...string[]])
        : z.string();
    case "stringArray":
      return z.array(z.string());
    case "json":
      return z.unknown();
    default:
      return z.string();
  }
};

/**
 * The single input schema for a task, assembled from its params.
 *
 * Both adapters derive from this rather than each hand-writing validation:
 * the CLI gets it via commander option parsing plus a `.parse()`, and the MCP
 * adapter converts it to the tool's JSON Schema. One list of params, one schema,
 * no second copy to drift.
 */
export const taskInputSchema = (
  params: readonly TaskParam[],
  options: { readonly omitCliOnly?: boolean } = {},
): z.ZodObject<Record<string, z.ZodTypeAny>> => {
  const shape: Record<string, z.ZodTypeAny> = {};
  for (const param of params) {
    if (options.omitCliOnly && param.cliOnly) continue;
    const base = paramSchema(param).describe(param.description);
    shape[param.name] = param.required ? base : base.optional();
  }
  return z.object(shape);
};

/** `parentNodeId` -> `--parent-node-id`. */
export const taskParamFlag = (param: TaskParam): string =>
  param.cliFlag ?? `--${param.name.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase()}`;
