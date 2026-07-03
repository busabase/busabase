import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { CreatableNodeType } from "busabase-contract/domains";
import {
  Command,
  CommanderError,
  InvalidArgumentError,
  Option,
  type OptionValues,
} from "commander";
import { banner } from "./banner.js";
import {
  type BusabaseClient,
  createBusabaseClient,
  DEFAULT_BASE_URL,
  normalizeBaseUrl,
  type ResolvedConfig,
} from "./client.js";
import { render } from "./format.js";

/** Public docs page covering every error below, for both Cloud and local. Linked from each error. */
const DOCS_TROUBLESHOOTING = "https://busabase.com/docs/troubleshooting";

/**
 * Read `~/.busabase/.env` (written by the setup skill) into a record, so the CLI works without the
 * user first `source`-ing it. Returns `{}` if the file is absent or unreadable. Parses simple
 * `KEY=value` lines, ignoring blanks and `#` comments, and stripping surrounding quotes.
 */
function loadDotEnvFile(): Record<string, string> {
  let text: string;
  try {
    text = readFileSync(join(homedir(), ".busabase", ".env"), "utf8");
  } catch {
    return {};
  }
  const out: Record<string, string> = {};
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed
      .slice(eq + 1)
      .trim()
      .replace(/^["']|["']$/g, "");
    if (key) out[key] = value;
  }
  return out;
}

// The field `type` arrives as a free-form CLI string; the typed contract narrows it
// to the field-type union. Server-side zod re-validates, so narrow with a cast here.
type FieldType = NonNullable<
  Parameters<BusabaseClient["bases"]["create"]>[0]["fields"]
>[number]["type"];

/**
 * Precedence: explicit flag > exported env var > ~/.busabase/.env file > default. Reading the
 * file directly means `busabase-cli` works straight after onboarding without a manual `source`,
 * while an exported env var still overrides the file.
 */
function resolveConfig(opts: OptionValues): ResolvedConfig {
  const file = loadDotEnvFile();
  return {
    baseUrl:
      (opts.baseUrl as string | undefined) ??
      process.env.BUSABASE_BASE_URL ??
      file.BUSABASE_BASE_URL ??
      DEFAULT_BASE_URL,
    apiKey:
      (opts.apiKey as string | undefined) ?? process.env.BUSABASE_API_KEY ?? file.BUSABASE_API_KEY,
    spaceId:
      (opts.spaceId as string | undefined) ??
      process.env.BUSABASE_SPACE_ID ??
      file.BUSABASE_SPACE_ID,
    output: (opts.output as "table" | "json" | undefined) ?? "table",
  };
}

/**
 * Config flags accepted anywhere on the line (`busabase-cli --output json bases list` and
 * `busabase-cli bases list --output json` both work): declared on the root program AND on every
 * leaf command, merged via `optsWithGlobals()` (leaf wins). No commander defaults here — a leaf
 * default would shadow a root-provided value, so defaults live in `resolveConfig` instead.
 */
const GLOBAL_LONG_FLAGS = new Set(["--base-url", "--api-key", "--space-id", "--output"]);

function addGlobalFlags(cmd: Command): Command {
  return cmd
    .option(
      "--base-url <url>",
      `server base URL (env BUSABASE_BASE_URL, default ${DEFAULT_BASE_URL})`,
    )
    .option("--api-key <token>", "bearer token for cloud hosts (env BUSABASE_API_KEY)")
    .option("--space-id <id>", "target Busabase space (env BUSABASE_SPACE_ID)")
    .addOption(
      new Option("--output <fmt>", "table | json (default table)").choices(["table", "json"]),
    );
}

const parseNum = (value: string): number => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new InvalidArgumentError("expected a number");
  return parsed;
};

/** `slug:name:type` specs (from repeatable `--field`) → contract field objects. */
function parseFieldSpecs(specs: string[]) {
  return specs.map((spec) => {
    const [slug, name, type] = spec.split(":");
    return {
      slug,
      name: name ?? slug,
      ...(type ? { type: type as FieldType } : {}),
    };
  });
}

function parseJsonValue(raw: string, flagName: string): unknown {
  const text = raw.startsWith("@") ? readFileSync(raw.slice(1), "utf8") : raw;
  try {
    return JSON.parse(text);
  } catch (error) {
    const hint = raw.startsWith("@")
      ? `File ${raw.slice(1)} is not valid JSON.`
      : `Flag --${flagName} must be valid JSON. For complex values, write a file and pass --${flagName} @record.json.`;
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`${hint}\n  JSON parse error: ${reason}`);
  }
}

/** Raw fetch for endpoints outside the typed contract (health / openapi / api passthrough). */
async function rawFetch(
  config: ResolvedConfig,
  method: string,
  path: string,
  body?: unknown,
): Promise<unknown> {
  const url = `${normalizeBaseUrl(config.baseUrl)}${path}`;
  const res = await fetch(url, {
    method: method.toUpperCase(),
    headers: {
      ...(body !== undefined ? { "content-type": "application/json" } : {}),
      ...(config.apiKey ? { authorization: `Bearer ${config.apiKey}` } : {}),
      ...(config.spaceId ? { "x-busabase-space": config.spaceId } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  const parsed = text ? JSON.parse(text) : null;
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} ${res.statusText}: ${text}`);
  }
  return parsed;
}

interface CliState {
  /** Last config a command resolved — lets `runCli` explain transport errors with the real target. */
  config?: ResolvedConfig;
}

type Handler = (
  client: BusabaseClient,
  opts: OptionValues,
  config: ResolvedConfig,
) => Promise<unknown>;

/** Wrap a leaf-command handler: resolve config, build the client, render the result. */
function runAction(state: CliState, handler: Handler) {
  return async (_opts: OptionValues, cmd: Command): Promise<void> => {
    const opts = cmd.optsWithGlobals();
    const config = resolveConfig(opts);
    state.config = config;
    const client = createBusabaseClient(config);
    const result = await handler(client, opts, config);
    console.log(render(result, config.output));
  };
}

function pkgVersion(): string {
  try {
    const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as {
      version?: string;
    };
    return pkg.version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}

/**
 * Per-command flag signature derived from the actual option definitions, e.g.
 * `--slug <slug> --name <name> [--description <text>]`. Used for both the root command
 * tree and each leaf's usage line, so help can never drift from the real surface.
 */
function flagSignature(cmd: Command): string {
  const parts: string[] = [];
  for (const option of cmd.options) {
    if (option.name() === "help" || GLOBAL_LONG_FLAGS.has(option.long ?? "")) continue;
    parts.push(option.mandatory ? option.flags : `[${option.flags}]`);
  }
  return parts.join(" ");
}

/**
 * Root help "Commands:" section: every leaf with its full flag signature (the flat
 * commander listing would only show group names). Generated from the command tree,
 * never hand-written.
 */
function commandsSection(program: Command): string {
  const lines: string[] = ["Commands:"];
  const entry = (prefix: string, cmd: Command) => {
    const sig = [prefix, flagSignature(cmd)].filter(Boolean).join(" ");
    const desc = cmd.description();
    if (!desc) return `  ${sig}`;
    if (sig.length <= 40) return `  ${sig.padEnd(42)}${desc}`;
    return `  ${sig}\n${" ".repeat(44)}${desc}`;
  };
  for (const cmd of program.commands) {
    if (cmd.name() === "help") continue;
    const leaves = cmd.commands.filter((leaf) => leaf.name() !== "help");
    if (leaves.length > 0) {
      lines.push("");
      for (const leaf of leaves) lines.push(entry(`${cmd.name()} ${leaf.name()}`, leaf));
    } else {
      lines.push(entry(cmd.name(), cmd));
    }
  }
  return lines.join("\n");
}

const HELP_FOOTER = `
Config is read from flags, then env vars, then ~/.busabase/.env (auto-loaded — no
need to source it). An exported env var overrides the file.

Docs: https://busabase.com/docs · Troubleshooting: ${DOCS_TROUBLESHOOTING}`;

function buildProgram(state: CliState = {}): Command {
  const program = new Command("busabase-cli");
  program
    .description("Client for the Busabase OpenAPI REST API — talks to `busabase server` or Cloud.")
    .usage("[global flags] <command> [flags]")
    .version(pkgVersion(), "-v, --version", "print busabase-cli version")
    .exitOverride()
    .showHelpAfterError("(run `busabase-cli --help` for the full command list)")
    .addHelpText("beforeAll", () => banner(resolveConfig(program.opts()).baseUrl));
  addGlobalFlags(program);

  addGlobalFlags(program.command("health"))
    .description("Server health check (GET /api/health)")
    .action(runAction(state, (_client, _opts, config) => rawFetch(config, "GET", "/api/health")));

  addGlobalFlags(program.command("openapi"))
    .description("Fetch the OpenAPI document")
    .action(
      runAction(state, (_client, _opts, config) => rawFetch(config, "GET", "/api/v1/openapi.json")),
    );

  addGlobalFlags(program.command("whoami"))
    .description("Active space, user, and membership")
    .action(runAction(state, (client) => client.auth.verify()));

  const nodes = program.command("nodes").description("Workspace node tree");
  addGlobalFlags(nodes.command("list"))
    .description("Workspace node tree")
    .action(runAction(state, (client) => client.nodes.list()));
  addGlobalFlags(nodes.command("create-change-request"))
    .description("Propose a new node via a Change Request")
    .addOption(
      new Option("--type <folder|base|skill|doc>", "node type")
        .choices(["folder", "base", "skill", "doc"])
        .makeOptionMandatory(),
    )
    .requiredOption("--slug <slug>", "node slug")
    .requiredOption("--name <name>", "node name")
    .option("--description <text>", "optional node description")
    .option("--parent-node-id <id>", "parent folder node id; omit for root")
    .option("--message <text>", "reviewer-facing Change Request message")
    .option("--submitted-by <name>", "producer label")
    .option("--field <slug:name:type...>", "base field, repeatable (for --type base)")
    .addHelpText(
      "after",
      `
Examples:
  busabase-cli nodes create-change-request --type folder --slug cms --name "内容管理 CMS"
  busabase-cli nodes create-change-request --type base --slug blog --name "博客文章 Blog Posts" --field title:Title:text --field body:Body:markdown`,
    )
    .action(
      runAction(state, (client, opts) => {
        const nodeType = opts.type as CreatableNodeType;
        const name = opts.name as string;
        return client.nodes.createChangeRequest({
          message: (opts.message as string | undefined) ?? `Create ${nodeType} ${name}`,
          submittedBy: opts.submittedBy as string | undefined,
          operations: [
            {
              kind: "create",
              nodeType,
              slug: opts.slug as string,
              name,
              description: opts.description as string | undefined,
              parentNodeId: opts.parentNodeId as string | undefined,
              ...(nodeType === "base"
                ? { fields: parseFieldSpecs((opts.field as string[] | undefined) ?? []) }
                : {}),
            },
          ],
        });
      }),
    );

  const bases = program.command("bases").description("Bases (structured tables)");
  addGlobalFlags(bases.command("list"))
    .description("List Bases in the active space")
    .action(runAction(state, (client) => client.bases.list()));
  addGlobalFlags(bases.command("get"))
    .description("Get one Base by slug")
    .requiredOption("--slug <slug>", "Base slug")
    .action(
      runAction(state, async (client, opts) => {
        const slug = opts.slug as string;
        const found = (await client.bases.list()).find((base) => base.slug === slug);
        if (!found) throw new Error(`no Base with slug "${slug}"`);
        return found;
      }),
    );
  addGlobalFlags(bases.command("create"))
    .description("Create a Base")
    .requiredOption("--slug <slug>", "Base slug")
    .requiredOption("--name <name>", "Base name")
    .requiredOption("--field <slug:name:type...>", "field definition, repeatable")
    .option("--description <text>", "optional description")
    .option("--parent-node-id <id>", "parent folder node id; omit for root")
    .action(
      runAction(state, (client, opts) =>
        client.bases.create({
          slug: opts.slug as string,
          name: opts.name as string,
          description: opts.description as string | undefined,
          parentNodeId: opts.parentNodeId as string | undefined,
          fields: parseFieldSpecs(opts.field as string[]),
        }),
      ),
    );
  addGlobalFlags(bases.command("create-field"))
    .description("Add a field to a Base")
    .requiredOption("--base-id <id>", "Base id")
    .requiredOption("--slug <slug>", "field slug")
    .requiredOption("--name <name>", "field name")
    .option("--field-type <type>", "field type (default text)")
    .option("--required", "mark the field as required")
    .action(
      runAction(state, (client, opts) =>
        client.bases.createField({
          baseId: opts.baseId as string,
          slug: opts.slug as string,
          name: opts.name as string,
          ...(opts.fieldType ? { type: opts.fieldType as FieldType } : {}),
          required: Boolean(opts.required),
        }),
      ),
    );
  addGlobalFlags(bases.command("create-change-request"))
    .description("Propose a new record via a Change Request")
    .requiredOption("--base-id <id>", "target Base id")
    .requiredOption("--fields-json <json|@file>", "record fields as JSON, or @file.json")
    .option("--message <text>", "reviewer-facing Change Request message")
    .option("--submitted-by <name>", "producer label")
    .addHelpText(
      "after",
      `
Examples:
  busabase-cli bases create-change-request --base-id bse_123 --fields-json '{"title":"Hello","status":"draft"}'
  busabase-cli bases create-change-request --base-id bse_123 --fields-json @record.json`,
    )
    .action(
      runAction(state, (client, opts) =>
        client.bases.createChangeRequest({
          baseId: opts.baseId as string,
          fields: parseJsonValue(opts.fieldsJson as string, "fields-json") as Record<
            string,
            unknown
          >,
          message: opts.message as string | undefined,
          submittedBy: opts.submittedBy as string | undefined,
        }),
      ),
    );

  const records = program.command("records").description("Records");
  addGlobalFlags(records.command("list"))
    .description("List records")
    .option("--limit <n>", "max results", parseNum)
    .action(
      runAction(state, (client, opts) =>
        client.records.list({ limit: opts.limit as number | undefined }),
      ),
    );
  addGlobalFlags(records.command("get"))
    .description("Get one record")
    .requiredOption("--record-id <id>", "record id")
    .action(
      runAction(state, (client, opts) => client.records.get({ recordId: opts.recordId as string })),
    );
  addGlobalFlags(records.command("by-field-text"))
    .description("Find records by text field value")
    .requiredOption("--field-slug <slug>", "field slug to match")
    .requiredOption("--value-text <text>", "text value to match")
    .option("--base-id <id>", "restrict to one Base")
    .option("--limit <n>", "max results", parseNum)
    .action(
      runAction(state, (client, opts) =>
        client.records.search({
          fieldSlug: opts.fieldSlug as string,
          valueText: opts.valueText as string,
          baseId: opts.baseId as string | undefined,
          limit: opts.limit as number | undefined,
        }),
      ),
    );
  addGlobalFlags(records.command("change-requests"))
    .description("Change Requests for a record")
    .requiredOption("--record-id <id>", "record id")
    .action(
      runAction(state, (client, opts) =>
        client.records.listChangeRequests({ recordId: opts.recordId as string }),
      ),
    );

  const changeRequests = program.command("change-requests").description("Change Requests");
  addGlobalFlags(changeRequests.command("list"))
    .description("List Change Requests")
    .option("--limit <n>", "max results", parseNum)
    .action(
      runAction(state, (client, opts) =>
        client.changeRequests.list({ limit: opts.limit as number | undefined }),
      ),
    );
  addGlobalFlags(changeRequests.command("get"))
    .description("Get a Change Request")
    .requiredOption("--change-request-id <id>", "Change Request id")
    .action(
      runAction(state, (client, opts) =>
        client.changeRequests.get({ changeRequestId: opts.changeRequestId as string }),
      ),
    );
  addGlobalFlags(changeRequests.command("review"))
    .description("Review a Change Request (rejected = request changes, not terminal)")
    .requiredOption("--change-request-id <id>", "Change Request id")
    .addOption(
      new Option("--verdict <approved|rejected>", "review verdict")
        .choices(["approved", "rejected"])
        .makeOptionMandatory(),
    )
    .option("--reason <text>", "review reason")
    .action(
      runAction(state, (client, opts) =>
        client.changeRequests.review({
          changeRequestId: opts.changeRequestId as string,
          verdict: opts.verdict as "approved" | "rejected",
          reason: opts.reason as string | undefined,
        }),
      ),
    );
  addGlobalFlags(changeRequests.command("close"))
    .description("Terminally abandon/reject a Change Request")
    .requiredOption("--change-request-id <id>", "Change Request id")
    .option("--reason <text>", "close reason")
    .action(
      runAction(state, (client, opts) =>
        client.changeRequests.close({
          changeRequestId: opts.changeRequestId as string,
          reason: opts.reason as string | undefined,
        }),
      ),
    );
  addGlobalFlags(changeRequests.command("merge"))
    .description("Merge a Change Request into its Base")
    .requiredOption("--change-request-id <id>", "Change Request id")
    .action(
      runAction(state, (client, opts) =>
        client.changeRequests.merge({ changeRequestId: opts.changeRequestId as string }),
      ),
    );

  addGlobalFlags(program.command("search"))
    .description("Full-text search")
    .requiredOption("--query <q>", "search query")
    .option("--limit <n>", "max results", parseNum)
    .option("--offset <n>", "results offset", parseNum)
    .action(
      runAction(state, (client, opts) =>
        client.search({
          query: opts.query as string,
          limit: opts.limit as number | undefined,
          offset: opts.offset as number | undefined,
        }),
      ),
    );

  addGlobalFlags(program.command("api"))
    .description("Raw request to any /api/v1 endpoint")
    .addOption(
      new Option("--method <get|post|put|delete>", "HTTP method")
        .choices(["get", "post", "put", "delete"])
        .makeOptionMandatory(),
    )
    .requiredOption("--path <p>", "path under /api/v1, e.g. /bases")
    .option("--query <k=v...>", "query-string param, repeatable")
    .option("--body-json <json>", "JSON request body")
    .action(
      runAction(state, (_client, opts, config) => {
        const query = new URLSearchParams();
        for (const pair of (opts.query as string[] | undefined) ?? []) {
          const [key, ...rest] = pair.split("=");
          query.set(key, rest.join("="));
        }
        const qs = query.toString();
        const path = `/api/v1${opts.path as string}${qs ? `?${qs}` : ""}`;
        const bodyJson = opts.bodyJson as string | undefined;
        return rawFetch(
          config,
          opts.method as string,
          path,
          bodyJson ? parseJsonValue(bodyJson, "body-json") : undefined,
        );
      }),
    );

  // Derived help — every leaf's usage line comes from its own option definitions,
  // and the root "Commands:" tree replaces commander's flat group list. Set AFTER
  // the tree is built so subcommands keep the default (per-leaf) help layout.
  for (const group of program.commands) {
    const leaves = group.commands.length > 0 ? group.commands : [group];
    for (const leaf of leaves) {
      const sig = flagSignature(leaf);
      leaf.usage(`${sig ? `${sig} ` : ""}[global flags]`);
    }
  }
  program.addHelpText("after", () => `\n${commandsSection(program)}\n${HELP_FOOTER}`);
  program.configureHelp({ visibleCommands: () => [] });
  return program;
}

/**
 * Run the client CLI. Returns a process exit code (0 ok, 1 error). Reused by the
 * `busabase` bin, which delegates every non-`server` command here.
 */
export async function runCli(argv: string[]): Promise<number> {
  const state: CliState = {};
  const program = buildProgram(state);
  if (argv.length === 0) {
    program.outputHelp();
    return 0;
  }
  try {
    await program.parseAsync(argv, { from: "user" });
    return 0;
  } catch (error) {
    if (error instanceof CommanderError) {
      // commander already wrote the help text or usage error to the right stream.
      return error.exitCode === 0 ? 0 : 1;
    }
    console.error(explainError(error, state.config ?? resolveConfig({})));
    return 1;
  }
}

function renderedHelp(): string {
  let out = "";
  const program = buildProgram();
  program.configureOutput({
    writeOut: (str) => {
      out += str;
    },
    writeErr: () => {},
  });
  program.outputHelp();
  return out;
}

/** Full root help text (what `busabase-cli --help` prints). Generated from the command tree. */
export const HELP = renderedHelp();

/**
 * Turn a low-level transport/HTTP error into an actionable message: which host was tried, the
 * concrete next step (set a key for Cloud, point at a local server, or check connectivity), and a
 * link to the troubleshooting docs.
 */
function explainError(error: unknown, config: ResolvedConfig): string {
  const base = config.baseUrl;
  const msg = error instanceof Error ? error.message : String(error);
  const status = (error as { status?: number }).status;
  const lower = msg.toLowerCase();

  let body: string;
  if (status === 401 || lower.includes("401") || lower.includes("unauthorized")) {
    body = [
      `Unauthorized (401) from ${base}.`,
      config.apiKey
        ? "  The API key was rejected — check it is current (Dashboard → Settings → API Keys)."
        : "  This host needs an API key. Pass --api-key <token> or export BUSABASE_API_KEY=… (Dashboard → Settings → API Keys).",
      "  Meant to hit a local server? Add --base-url http://localhost:15419 (or export BUSABASE_BASE_URL=…).",
    ].join("\n");
  } else if (
    lower.includes("fetch failed") ||
    lower.includes("econnrefused") ||
    lower.includes("enotfound") ||
    lower.includes("getaddrinfo") ||
    lower.includes("network")
  ) {
    body = [
      `Could not reach ${base}.`,
      "  • Cloud: check your internet connection and that the URL is correct.",
      "  • Local: start it with `npx busabase server` (http://localhost:15419), then add --base-url http://localhost:15419 (or export BUSABASE_BASE_URL=…).",
      `  (underlying error: ${msg})`,
    ].join("\n");
  } else {
    body = `${msg}\n  (base URL: ${base}${config.apiKey ? ", with API key" : ", no API key"})`;
  }
  return `${body}\n  → Docs: ${DOCS_TROUBLESHOOTING}`;
}
