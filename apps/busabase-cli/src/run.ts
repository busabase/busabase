import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { basename, extname } from "node:path";
import {
  type BusabaseClient,
  type ResolvedConfig as BusabaseConfig,
  type CreatableNodeType,
  cloudContract,
  createBusabaseClient,
  DEFAULT_BASE_URL,
  normalizeBaseUrl,
} from "busabase-sdk";
import {
  Command,
  CommanderError,
  InvalidArgumentError,
  Option,
  type OptionValues,
} from "commander";
import { banner } from "./banner.js";
import { loadDotEnvFile } from "./config-file.js";
import { render } from "./format.js";
import { maybeAutoRefresh, runLogin, runLogout, runRefresh } from "./login.js";

/**
 * CLI config = the SDK's resolved client config plus the terminal-only `output`
 * mode. `output` never reaches the client factory; it drives {@link render}.
 */
type ResolvedConfig = BusabaseConfig & { output: "table" | "json" };

/** Public docs page covering every error below, for both Cloud and local. Linked from each error. */
const DOCS_TROUBLESHOOTING = "https://busabase.com/docs/troubleshooting";

// The field `type` arrives as a free-form CLI string; the typed contract narrows it
// to the field-type union. Server-side zod re-validates, so narrow with a cast here.
type FieldType = NonNullable<
  Parameters<BusabaseClient["bases"]["create"]>[0]["fields"]
>[number]["type"];
type BaseFieldInput = NonNullable<
  Parameters<BusabaseClient["bases"]["create"]>[0]["fields"]
>[number];

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

const parseLimit = (value: string): number => {
  const parsed = parseNum(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 100) {
    throw new InvalidArgumentError("expected an integer from 1 to 100");
  }
  return parsed;
};

const parsePositiveInt = (value: string): number => {
  const parsed = parseNum(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new InvalidArgumentError("expected a positive integer");
  }
  return parsed;
};

const parseBoolean = (value: string): boolean => {
  if (value === "true") return true;
  if (value === "false") return false;
  throw new InvalidArgumentError("expected true or false");
};

const collectValues = (value: string, previous: string[] = []): string[] => [...previous, value];

const MIME_BY_EXT: Record<string, string> = {
  ".gif": "image/gif",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".md": "text/markdown",
  ".pdf": "application/pdf",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".txt": "text/plain",
  ".webp": "image/webp",
};

const guessMimeType = (filePath: string) =>
  MIME_BY_EXT[extname(filePath).toLowerCase()] ?? "application/octet-stream";

function createAttachmentOptions(opts: OptionValues) {
  const maxFiles = opts.maxFiles as number | undefined;
  const maxFileSize = opts.maxFileSize as number | undefined;
  const allowedMimeTypes = opts.allowedMime as string[] | undefined;
  if (!maxFiles && !maxFileSize && (!allowedMimeTypes || allowedMimeTypes.length === 0)) {
    return undefined;
  }
  return {
    attachment: {
      ...(maxFiles ? { maxFiles } : {}),
      ...(maxFileSize ? { maxFileSize } : {}),
      ...(allowedMimeTypes && allowedMimeTypes.length > 0 ? { allowedMimeTypes } : {}),
    },
  };
}

function mergeFieldOptions(existing: unknown, attachmentOptions: unknown) {
  if (!attachmentOptions) return existing;
  if (!existing || typeof existing !== "object" || Array.isArray(existing))
    return attachmentOptions;
  return { ...existing, ...(attachmentOptions as Record<string, unknown>) };
}

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

function parseFieldDefinitions(opts: OptionValues): BaseFieldInput[] {
  const specs = (opts.field as string[] | undefined) ?? [];
  const fieldsJson = opts.fieldsJson as string | undefined;
  if (specs.length > 0 && fieldsJson) {
    throw new Error("Pass either --field or --fields-json, not both.");
  }
  if (fieldsJson) {
    const parsed = parseJsonValue(fieldsJson, "fields-json");
    if (!Array.isArray(parsed)) {
      throw new Error(
        '--fields-json must be a JSON array of field definitions. Example: [{"slug":"status","name":"Status","type":"select","options":{"choices":[{"id":"live","name":"Live"}]}}]',
      );
    }
    return parsed as BaseFieldInput[];
  }
  if (specs.length === 0) {
    throw new Error("Pass at least one --field or provide --fields-json @fields.json.");
  }
  return parseFieldSpecs(specs);
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
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} ${res.statusText}: ${text}`);
  }
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

async function rawRequest(
  config: ResolvedConfig,
  method: string,
  path: string,
  body?: unknown,
): Promise<unknown> {
  return rawFetch(config, method, path, body);
}

async function uploadAsset(config: ResolvedConfig, opts: OptionValues) {
  const filePath = opts.file as string;
  const file = readFileSync(filePath);
  const fileName = (opts.fileName as string | undefined) ?? basename(filePath);
  const mimeType = (opts.mimeType as string | undefined) ?? guessMimeType(filePath);
  const context = (opts.context as string | undefined) ?? "record-field";
  const contentHash = `sha256:${createHash("sha256").update(file).digest("hex")}`;
  const requested = (await rawRequest(config, "POST", "/api/v1/assets/upload-urls", {
    fileName,
    mimeType,
    sizeBytes: file.byteLength,
    context,
    contentHash,
  })) as {
    assetId?: string;
    attachmentId?: string;
    duplicate?: boolean;
    publicUrl: string;
    storageKey: string;
    uploadUrl: string;
  };

  if (requested.duplicate) {
    return {
      id: requested.assetId ?? requested.attachmentId,
      assetId: requested.assetId,
      attachmentId: requested.attachmentId,
      url: requested.publicUrl,
      fileName,
      mimeType,
      size: file.byteLength,
    };
  }

  if (requested.uploadUrl.startsWith("/")) {
    throw new Error(
      `Server returned a browser-relative upload URL (${requested.uploadUrl}). Use the Busabase UI for local/dev uploads or a cloud host with a presigned absolute upload URL.`,
    );
  }

  const uploadResponse = await fetch(requested.uploadUrl, {
    body: new Uint8Array(file),
    headers: { "content-type": mimeType },
    method: "PUT",
  });
  if (!uploadResponse.ok) {
    const text = await uploadResponse.text();
    throw new Error(
      `Asset byte upload failed (${uploadResponse.status} ${uploadResponse.statusText})${text ? `: ${text}` : ""}`,
    );
  }

  const confirmed = (await rawRequest(config, "POST", "/api/v1/assets/confirmations", {
    storageKey: requested.storageKey,
    fileName,
    mimeType,
    sizeBytes: file.byteLength,
    context,
    contentHash,
  })) as { assetId?: string; attachmentId: string; publicUrl: string };

  return {
    id: confirmed.assetId ?? confirmed.attachmentId,
    assetId: confirmed.assetId,
    attachmentId: confirmed.attachmentId,
    url: confirmed.publicUrl,
    fileName,
    mimeType,
    size: file.byteLength,
  };
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
    // Built-in auto-refresh: keep an actively-used OAuth login alive. No-op unless the
    // saved session token is near expiry; keeps the same token, so `config` stays valid.
    await maybeAutoRefresh(config.baseUrl, config.apiKey);
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

// ── OpenAPI-contract-driven command generation ───────────────────────────────
// The typed client already covers EVERY contract procedure; this walks the same
// `cloudContract` the client is built from and emits one commander leaf per
// procedure (`<group> <proc>`), deriving flags from each procedure's input Zod
// schema. So the CLI stays aligned with the full `/api/v1` surface with ZERO
// drift — a new contract endpoint becomes a CLI command for free. The curated
// hand-written commands above always win: a generated command is skipped when
// its group already has a same-named command, or when it is a nicer-named alias
// of a curated one (GENERATED_SKIP).

/** camelCase → kebab-case for flag and command names (createChangeRequest → create-change-request). */
const kebab = (value: string): string => value.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();

type ContractProcedure = {
  "~orpc": {
    route: { method: string; path: string; summary?: string; tags?: string[] };
    inputSchema?: unknown;
  };
};

const isProcedure = (node: unknown): node is ContractProcedure =>
  typeof node === "object" &&
  node !== null &&
  typeof (node as { "~orpc"?: { route?: { method?: unknown } } })["~orpc"]?.route?.method ===
    "string";

type GenFlagKind = "string" | "number" | "boolean" | "enum" | "json";
interface GenField {
  key: string;
  kind: GenFlagKind;
  required: boolean;
  choices?: string[];
}

/** Peel ZodOptional/ZodDefault/ZodNullable wrappers; a default or optional wrapper means not-required. */
// Zod v4's internal `.def` shape has no public types, so these introspection helpers use `any`.
function unwrapSchema(schema: any): { inner: any; optional: boolean } {
  let inner = schema;
  let optional = false;
  for (let i = 0; i < 6 && inner?.def; i++) {
    const type = inner.def.type;
    if (type === "optional" || type === "default") {
      optional = true;
      inner = inner.def.innerType;
    } else if (type === "nullable") {
      inner = inner.def.innerType;
    } else break;
  }
  return { inner, optional };
}

/** Map an (unwrapped) Zod type to a CLI flag kind. Complex types (object/array/record/union) → JSON flag. */
function classifyKind(inner: any): { kind: GenFlagKind; choices?: string[] } {
  const type = inner?.def?.type;
  if (type === "string") return { kind: "string" };
  if (type === "number") return { kind: "number" };
  if (type === "boolean") return { kind: "boolean" };
  if (type === "literal") return { kind: "string" };
  if (type === "enum") {
    const choices = Array.isArray(inner.options)
      ? inner.options
      : Object.values(inner.def?.entries ?? {});
    // Fall back to a free-form string when the enum members can't be read.
    return choices.length ? { kind: "enum", choices: choices as string[] } : { kind: "string" };
  }
  return { kind: "json" };
}

/** Derive the flag set for a procedure from its input object schema (empty when it takes no input). */
function inputFields(inputSchema: unknown): GenField[] {
  const { inner } = unwrapSchema(inputSchema);
  const shape = inner?.shape ?? (inner?.def?.type === "object" ? inner.def.shape : undefined);
  if (!shape || typeof shape !== "object") return [];
  const fields: GenField[] = [];
  for (const [key, sub] of Object.entries(shape as Record<string, any>)) {
    const { inner: unwrapped, optional } = unwrapSchema(sub);
    const { kind, choices } = classifyKind(unwrapped);
    fields.push({ key, kind, required: !optional, choices });
  }
  return fields;
}

/**
 * Procedures a curated command already exposes under a DIFFERENT name (so the
 * name-collision guard wouldn't catch them). Keyed `group.procKey`.
 */
const GENERATED_SKIP = new Set<string>([
  "search", // top-level `search`
  "auth.verify", // `whoami`
  "records.search", // `records by-field-text`
  "records.listChangeRequests", // `records change-requests`
]);

/** Walk `cloudContract` and register a leaf command per procedure not already covered by hand. */
function registerGeneratedCommands(program: Command, state: CliState): void {
  const getGroup = (displayName: string, tag?: string): Command =>
    program.commands.find((c) => c.name() === displayName) ??
    program.command(displayName).description(tag ?? `${displayName} endpoints`);

  const addLeaf = (
    parent: Command,
    navPath: string[],
    procKey: string,
    proc: ContractProcedure,
  ) => {
    const { route, inputSchema } = proc["~orpc"];
    const name = kebab(procKey);
    if (parent.commands.some((c) => c.name() === name)) return; // curated command (or dup) wins
    const fields = inputFields(inputSchema);
    const leaf = parent.command(name).description(route.summary ?? `${route.method} ${route.path}`);
    for (const f of fields) {
      const flag = `--${kebab(f.key)}`;
      // A body field named like a global flag (e.g. spaceId) is served by the global flag/header.
      if (GLOBAL_LONG_FLAGS.has(flag)) continue;
      if (f.kind === "boolean") {
        leaf.option(flag, `${f.key} (boolean)`);
      } else if (f.kind === "json") {
        const jsonFlag = `${flag}-json <json|@file>`;
        const desc = `${f.key} as JSON${f.required ? "" : " (optional)"}`;
        if (f.required) leaf.requiredOption(jsonFlag, desc);
        else leaf.option(jsonFlag, desc);
      } else if (f.kind === "enum") {
        const opt = new Option(`${flag} <value>`, f.key).choices(f.choices ?? []);
        if (f.required) opt.makeOptionMandatory();
        leaf.addOption(opt);
      } else if (f.kind === "number") {
        const label = `${flag} <value>`;
        const desc = `${f.key}${f.required ? "" : " (optional)"}`;
        if (f.required) leaf.requiredOption(label, desc, parseNum);
        else leaf.option(label, desc, parseNum);
      } else {
        const label = `${flag} <value>`;
        const desc = `${f.key}${f.required ? "" : " (optional)"}`;
        if (f.required) leaf.requiredOption(label, desc);
        else leaf.option(label, desc);
      }
    }
    addGlobalFlags(leaf);
    leaf.addHelpText("after", `\nOpenAPI: ${route.method} ${route.path}`);
    leaf.action(
      runAction(state, (client, opts) => {
        const input: Record<string, unknown> = {};
        for (const f of fields) {
          if (GLOBAL_LONG_FLAGS.has(`--${kebab(f.key)}`)) continue;
          const optKey = f.kind === "json" ? `${f.key}Json` : f.key;
          const value = (opts as Record<string, unknown>)[optKey];
          if (value === undefined) continue;
          input[f.key] =
            f.kind === "json" ? parseJsonValue(value as string, `${kebab(f.key)}-json`) : value;
        }
        // The oRPC client is a Proxy: `.call`/`.bind` are intercepted as route
        // segments, so the method must be invoked directly (target[procKey](input)).
        // Dynamic navigation of the typed client requires `any`.
        let target: any = client;
        for (const segment of navPath) target = target[segment];
        return fields.length > 0 ? target[procKey](input) : target[procKey]();
      }),
    );
  };

  const walk = (node: Record<string, unknown>, navPath: string[]): void => {
    for (const key of Object.keys(node)) {
      if (key === "~orpc") continue;
      const child = node[key];
      const id = [...navPath, key].join(".");
      if (isProcedure(child)) {
        if (GENERATED_SKIP.has(id)) continue;
        // Only single-level groups exist in the contract; guard against deeper nesting.
        if (navPath.length > 1) continue;
        const parent = navPath.length
          ? getGroup(kebab(navPath[0]), child["~orpc"].route.tags?.[0])
          : program;
        addLeaf(parent, navPath, key, child);
      } else if (child && typeof child === "object") {
        walk(child as Record<string, unknown>, [...navPath, key]);
      }
    }
  };

  walk(cloudContract as unknown as Record<string, unknown>, []);
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

const isHelpHidden = (cmd: Command): boolean => Boolean((cmd as { _noHelp?: boolean })._noHelp);

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
    if (cmd.name() === "help" || isHelpHidden(cmd)) continue;
    const leaves = cmd.commands.filter((leaf) => leaf.name() !== "help" && !isHelpHidden(leaf));
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

  addGlobalFlags(program.command("login"))
    .description("Connect the CLI to Busabase — Personal/local, Cloud, or self-hosted")
    .option("--oauth", "force browser OAuth and skip the method prompt")
    .option("--no-browser", "OAuth: print the sign-in URL instead of opening a browser")
    .option("--refresh", "slide the saved OAuth session forward (no browser, no re-login)")
    .addHelpText(
      "after",
      `
Run interactively, login asks where your Busabase is and writes the connection to
~/.busabase/.env:
  1. Personal Desktop / local server — no login
  2. Busabase Cloud — browser sign-in (OAuth)
  3. Busabase Cloud — paste an API key
  4. Self-hosted — browser sign-in (OAuth)
  5. Self-hosted — paste an API key
The flags below skip the menu (handy for scripts / CI):

  busabase-cli login                                   # pick from the menu
  busabase-cli login --oauth                           # Cloud browser sign-in
  busabase-cli login --api-key sk_…                    # Cloud API key (headless/CI)
  busabase-cli login --base-url http://localhost:15419 # connect to a local server (no auth)
  busabase-cli login --refresh                         # extend the current session (auto-runs too)`,
    )
    .action(async (_opts: OptionValues, cmd: Command) => {
      const opts = cmd.optsWithGlobals();
      const config = resolveConfig(opts);
      state.config = config;
      const summary = opts.refresh
        ? await runRefresh({ baseUrl: config.baseUrl, apiKey: config.apiKey })
        : await runLogin({
            baseUrl: config.baseUrl,
            apiKey: opts.apiKey as string | undefined,
            spaceId: config.spaceId,
            oauth: Boolean(opts.oauth),
            browser: opts.browser !== false,
          });
      console.log(render(summary, config.output));
    });

  addGlobalFlags(program.command("logout"))
    .description("Revoke the saved OAuth session (if any) and clear ~/.busabase/.env")
    .action(async (_opts: OptionValues, cmd: Command) => {
      const opts = cmd.optsWithGlobals();
      const config = resolveConfig(opts);
      state.config = config;
      const summary = await runLogout({ baseUrl: config.baseUrl, apiKey: config.apiKey });
      console.log(render(summary, config.output));
    });

  const nodes = program.command("nodes").description("Workspace node tree");
  addGlobalFlags(nodes.command("list"))
    .description("Workspace node tree")
    .action(runAction(state, (client) => client.nodes.list()));
  addGlobalFlags(nodes.command("create-change-request"))
    .description("Propose a new node via a Change Request")
    .addOption(
      new Option("--type <folder|base|skill|drive|doc>", "node type")
        .choices(["folder", "base", "skill", "drive", "doc"])
        .makeOptionMandatory(),
    )
    .requiredOption("--slug <slug>", "node slug")
    .requiredOption("--name <name>", "node name")
    .option("--description <text>", "optional node description")
    .option("--parent-node-id <id>", "parent folder node id; omit for root")
    .option("--message <text>", "reviewer-facing Change Request message")
    .option("--submitted-by <name>", "producer label")
    .option("--field <slug:name:type...>", "base field, repeatable (for --type base)")
    .option("--fields-json <json|@file>", "base fields as JSON array (for --type base)")
    .addHelpText(
      "after",
      `
Examples:
  busabase-cli nodes create-change-request --type folder --slug cms --name "内容管理 CMS"
  busabase-cli nodes create-change-request --type base --slug blog --name "博客文章 Blog Posts" --field title:Title:text --field body:Body:markdown
  busabase-cli nodes create-change-request --type base --slug products --name "产品目录 Products" --fields-json @fields.json`,
    )
    .action(
      runAction(state, (client, opts) => {
        const nodeType = opts.type as CreatableNodeType;
        const name = opts.name as string;
        if (nodeType !== "base" && (opts.field || opts.fieldsJson)) {
          throw new Error("--field and --fields-json are only valid with --type base.");
        }
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
              ...(nodeType === "base" ? { fields: parseFieldDefinitions(opts) } : {}),
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
    .option("--field <slug:name:type...>", "field definition, repeatable")
    .option("--fields-json <json|@file>", "field definitions as JSON array")
    .option("--description <text>", "optional description")
    .option("--parent-node-id <id>", "parent folder node id; omit for root")
    .addHelpText(
      "after",
      `
Examples:
  busabase-cli bases create --slug products --name "产品目录 Products" --field product_name:"Product Name":text
  busabase-cli bases create --slug products --name "产品目录 Products" --fields-json @fields.json`,
    )
    .action(
      runAction(state, (client, opts) =>
        client.bases.create({
          slug: opts.slug as string,
          name: opts.name as string,
          description: opts.description as string | undefined,
          parentNodeId: opts.parentNodeId as string | undefined,
          fields: parseFieldDefinitions(opts),
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
    .option("--max-files <n>", "attachment option: max files", parsePositiveInt)
    .option("--max-file-size <bytes>", "attachment option: max size in bytes", parsePositiveInt)
    .option(
      "--allowed-mime <mime>",
      "attachment option: allowed MIME type, repeatable",
      collectValues,
    )
    .action(
      runAction(state, (client, opts) =>
        client.bases.createField({
          baseId: opts.baseId as string,
          slug: opts.slug as string,
          name: opts.name as string,
          ...(opts.fieldType ? { type: opts.fieldType as FieldType } : {}),
          required: Boolean(opts.required),
          ...(createAttachmentOptions(opts) ? { options: createAttachmentOptions(opts) } : {}),
        }),
      ),
    );
  addGlobalFlags(bases.command("update-field-change-request"))
    .description("Propose updating field metadata/options via a Change Request")
    .requiredOption("--base-id <id>", "Base id")
    .requiredOption("--field-id <id>", "field id")
    .option("--name <name>", "new field name")
    .option("--required <true|false>", "set required flag", parseBoolean)
    .option("--options-json <json|@file>", "full field options JSON, or @file.json")
    .option("--max-files <n>", "attachment option: max files", parsePositiveInt)
    .option("--max-file-size <bytes>", "attachment option: max size in bytes", parsePositiveInt)
    .option(
      "--allowed-mime <mime>",
      "attachment option: allowed MIME type, repeatable",
      collectValues,
    )
    .option("--message <text>", "reviewer-facing Change Request message")
    .option("--submitted-by <name>", "producer label")
    .addHelpText(
      "after",
      `
Examples:
  busabase-cli bases update-field-change-request --base-id bse_123 --field-id bsf_123 --name "封面 Cover Image" --max-files 1 --allowed-mime image/png --allowed-mime image/svg+xml
  busabase-cli bases update-field-change-request --base-id bse_123 --field-id bsf_123 --options-json @field-options.json`,
    )
    .action(
      runAction(state, (client, opts) => {
        const patch: Record<string, unknown> = {};
        if (opts.name) patch.name = opts.name;
        if (opts.required !== undefined) patch.required = opts.required;
        if (opts.optionsJson) {
          patch.options = parseJsonValue(opts.optionsJson as string, "options-json");
        }
        const attachmentOptions = createAttachmentOptions(opts);
        patch.options = mergeFieldOptions(patch.options, attachmentOptions);
        if (Object.keys(patch).length === 0) {
          throw new Error(
            "No field patch supplied. Pass --name, --required, --options-json, or attachment option flags.",
          );
        }
        return client.bases.updateFieldChangeRequest({
          baseId: opts.baseId as string,
          fieldId: opts.fieldId as string,
          patch: patch as Parameters<
            BusabaseClient["bases"]["updateFieldChangeRequest"]
          >[0]["patch"],
          message: opts.message as string | undefined,
          submittedBy: opts.submittedBy as string | undefined,
        });
      }),
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
    .option("--limit <n>", "max results (1-100)", parseLimit)
    .option("--base-id <id>", "restrict to one Base")
    .option("--cursor <cursor>", "opaque nextCursor from a previous page")
    .action(
      runAction(state, (_client, opts, config) => {
        const query = new URLSearchParams();
        if (opts.limit !== undefined) query.set("limit", String(opts.limit));
        if (opts.baseId) query.set("baseId", opts.baseId as string);
        if (opts.cursor) query.set("cursor", opts.cursor as string);
        const qs = query.toString();
        return rawRequest(config, "GET", `/api/v1/records/paged${qs ? `?${qs}` : ""}`);
      }),
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

  const addUploadCommand = (parent: Command, hidden = false) =>
    addGlobalFlags(parent.command("upload", { noHelp: hidden }))
      .description("Upload a file and print an asset ref for record fields")
      .requiredOption("--file <path>", "local file to upload")
      .option("--file-name <name>", "stored file name (default: basename of --file)")
      .option("--mime-type <mime>", "MIME type (default: inferred from extension)")
      .option("--context <value>", "upload context (default record-field)")
      .addHelpText(
        "after",
        `
Example:
  busabase-cli assets upload --file ./cover.png --output json

Use the JSON output directly in an attachment field value, e.g. {"cover_image":[<output>]}.`,
      )
      .action(runAction(state, (_client, opts, config) => uploadAsset(config, opts)));

  addUploadCommand(program.command("assets").description("Assets"));

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

  // Fill in every remaining contract procedure as a generated command, so the CLI
  // covers the full OpenAPI surface. Runs AFTER the curated commands above so those
  // win on name collisions.
  registerGeneratedCommands(program, state);

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
export function explainError(error: unknown, config: ResolvedConfig): string {
  const base = config.baseUrl;
  const msg = error instanceof Error ? error.message : String(error);
  const status = (error as { status?: number }).status;
  const lower = msg.toLowerCase();

  let body: string;
  if (status === 401 || lower.includes("401") || lower.includes("unauthorized")) {
    body = [
      `Unauthorized (401) from ${base}.`,
      config.apiKey
        ? "  The credential was rejected or expired — run `busabase-cli login` to sign in again (browser OAuth or an API key)."
        : "  This host needs sign-in. Run `busabase-cli login` (browser OAuth or an API key), or pass --api-key <token> / export BUSABASE_API_KEY=….",
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
