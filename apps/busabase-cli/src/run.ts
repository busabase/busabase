import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { basename, extname } from "node:path";
import {
  type BusabaseClient,
  type ResolvedConfig as BusabaseConfig,
  CREATABLE_NODE_TYPES,
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
import { type OutputFormat, render } from "./format.js";
import { maybeAutoRefresh, runLogin, runLogout, runRefresh } from "./login.js";
import { runInstall, runPublish } from "./package/commands.js";

/**
 * CLI config = the SDK's resolved client config plus the terminal-only `output`
 * mode. `output` never reaches the client factory; it drives {@link render}.
 */
type ResolvedConfig = BusabaseConfig & { output: OutputFormat };

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
type NodeCreateOperation = Extract<
  Parameters<BusabaseClient["nodes"]["createChangeRequest"]>[0]["operations"][number],
  { kind: "create" }
>;

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
    output: (opts.output as OutputFormat | undefined) ?? "text",
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
      new Option("--output <fmt>", "text | table | json (default text)").choices([
        "text",
        "table",
        "json",
      ]),
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

function parseFileNodeMetadata(opts: OptionValues): NodeCreateOperation["metadata"] {
  const assetId = opts.assetId as string | undefined;
  if (!assetId) {
    throw new Error("--asset-id is required with --type file.");
  }
  return { assetId };
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

/**
 * Format a non-OK raw-fetch response body into a readable error message. The
 * server's JSON error shape is `{ error, code, data }` (see `encodeOpenApiError`
 * in apps/busabase/src/app/api/v1/[[...rest]]/route.ts) — when the body parses
 * as that shape, surface `error` (and, if present, each `data.issues` entry as
 * `path: message`) instead of the raw JSON blob. Falls back to the raw text for
 * any non-JSON / unrecognized body so nothing is ever silently dropped.
 */
function formatRawErrorBody(status: number, statusText: string, text: string): string {
  try {
    const parsed = JSON.parse(text) as { error?: unknown; data?: unknown };
    if (typeof parsed.error === "string") {
      const issues = (parsed.data as { issues?: unknown } | undefined)?.issues;
      let message = parsed.error;
      if (Array.isArray(issues) && issues.length > 0) {
        const details = issues
          .map((issue) => {
            if (!issue || typeof issue !== "object") return String(issue);
            const { path, message: issueMessage } = issue as { path?: unknown; message?: unknown };
            const pathLabel = Array.isArray(path) ? path.join(".") : undefined;
            return pathLabel ? `${pathLabel}: ${issueMessage}` : String(issueMessage ?? issue);
          })
          .join("; ");
        message = `${message} — ${details}`;
      }
      return `HTTP ${status} ${statusText}: ${message}`;
    }
  } catch {
    // Not JSON (or not the expected shape) — fall through to the raw text below.
  }
  return `HTTP ${status} ${statusText}: ${text}`;
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
    throw new Error(formatRawErrorBody(res.status, res.statusText, text));
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

/** Mirrors the server's INLINE_TEXT_MAX_BYTES cap (1MB) — asset-texts-logic.ts. */
const INLINE_TEXT_MAX_BYTES = 1024 * 1024;

/**
 * Drive Grep Retrieval `putText` — one call for callers, picking inline vs
 * presigned by size (mirrors `Busabase.putText` in the SDK).
 */
async function putTextCommand(client: BusabaseClient, opts: OptionValues) {
  const assetId = opts.assetId as string;
  const text = opts.file ? readFileSync(opts.file as string, "utf8") : (opts.text as string);
  if (opts.none) {
    return client.assets.putText({ assetId, none: true });
  }
  if (text === undefined) {
    throw new Error("Provide --text <string>, --file <path>, or --none.");
  }
  const sizeBytes = Buffer.byteLength(text, "utf8");
  if (sizeBytes <= INLINE_TEXT_MAX_BYTES) {
    return client.assets.putText({ assetId, text });
  }
  const upload = await client.assets.createTextUploadUrl({ assetId, sizeBytes });
  const uploadResponse = await fetch(upload.uploadUrl, {
    method: "PUT",
    headers: { "content-type": "text/plain; charset=utf-8" },
    body: text,
  });
  if (!uploadResponse.ok) {
    const body = await uploadResponse.text();
    throw new Error(
      `Text byte upload failed (${uploadResponse.status} ${uploadResponse.statusText})${body ? `: ${body}` : ""}`,
    );
  }
  return client.assets.putText({ assetId, storageKey: upload.storageKey });
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

type ArgHandler = (
  arg: string,
  client: BusabaseClient,
  opts: OptionValues,
  config: ResolvedConfig,
) => Promise<unknown>;

/**
 * {@link runAction} for a command with one positional argument. Commander passes
 * `(arg, opts, cmd)` to such an action, so the arity differs from a flags-only leaf.
 */
function runArgAction(state: CliState, handler: ArgHandler) {
  return async (arg: string, _opts: OptionValues, cmd: Command): Promise<void> => {
    const opts = cmd.optsWithGlobals();
    const config = resolveConfig(opts);
    state.config = config;
    await maybeAutoRefresh(config.baseUrl, config.apiKey);
    const client = createBusabaseClient(config);
    const result = await handler(arg, client, opts, config);
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
  /** This is the sole field and its JSON value IS the whole input, not a single property of it. */
  root?: boolean;
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

/**
 * Derive the flag set for a procedure from its input object schema (empty when it takes no
 * input). A schema whose top level isn't a plain object — e.g. a discriminated union like the
 * webhook rule input (`WebhookRuleInputSchema`) — has no per-field shape to introspect, so this
 * falls back to a single `--input-json` flag for the whole payload instead of silently
 * generating a flag-less, unusable command.
 */
function inputFields(inputSchema: unknown): GenField[] {
  if (inputSchema === undefined) return [];
  const { inner } = unwrapSchema(inputSchema);
  const shape = inner?.shape ?? (inner?.def?.type === "object" ? inner.def.shape : undefined);
  if (!shape || typeof shape !== "object") {
    return [{ key: "input", kind: "json", required: true, root: true }];
  }
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
  "airapps.listFiles", // `airapps files`
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
        let input: unknown = {};
        for (const f of fields) {
          if (GLOBAL_LONG_FLAGS.has(`--${kebab(f.key)}`)) continue;
          const optKey = f.kind === "json" ? `${f.key}Json` : f.key;
          const value = (opts as Record<string, unknown>)[optKey];
          if (value === undefined) continue;
          const parsed =
            f.kind === "json" ? parseJsonValue(value as string, `${kebab(f.key)}-json`) : value;
          if (f.root) input = parsed;
          else (input as Record<string, unknown>)[f.key] = parsed;
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
Busabase is an approval-first database and knowledge base for AI agents: agents
propose changes, humans review and merge what becomes trusted data.

Run interactively, login explains the connection choices and writes the selected
Busabase instance to ~/.busabase/.env:
  1. Local/Desktop on this computer — no account, no login
  2. Busabase Cloud — browser sign-in (recommended)
  3. Busabase Cloud — paste an API key
  4. Self-hosted Busabase — browser sign-in
  5. Self-hosted Busabase — paste an API key
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
      new Option(`--type <${CREATABLE_NODE_TYPES.join("|")}>`, "node type")
        .choices(CREATABLE_NODE_TYPES)
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
    .option("--asset-id <id>", "backing Asset id (required for --type file)")
    .addHelpText(
      "after",
      `
Examples:
  busabase-cli nodes create-change-request --type folder --slug cms --name "内容管理 CMS"
  busabase-cli nodes create-change-request --type base --slug blog --name "博客文章 Blog Posts" --field title:Title:text --field body:Body:markdown
  busabase-cli nodes create-change-request --type base --slug products --name "产品目录 Products" --fields-json @fields.json
  busabase-cli nodes create-change-request --type file --slug board-plan --name "Board Plan" --asset-id ast_123`,
    )
    .action(
      runAction(state, (client, opts) => {
        const nodeType = opts.type as CreatableNodeType;
        const name = opts.name as string;
        if (nodeType !== "base" && (opts.field || opts.fieldsJson)) {
          throw new Error("--field and --fields-json are only valid with --type base.");
        }
        if (nodeType !== "file" && opts.assetId) {
          throw new Error("--asset-id is only valid with --type file.");
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
              ...(nodeType === "file" ? { metadata: parseFileNodeMetadata(opts) } : {}),
            },
          ],
        });
      }),
    );

  addGlobalFlags(nodes.command("archive"))
    .description(
      "Propose archiving a node via a Change Request (review-first by default) — the only way to move a node into the archived state; DELETE /nodes/{nodeId} (`nodes purge`) only permanently removes a node that is ALREADY archived",
    )
    .requiredOption("--node-id <id>", "node id to archive")
    .option("--message <text>", "reviewer-facing Change Request message")
    .option("--submitted-by <name>", "producer label")
    .option(
      "--auto-merge",
      "skip review and archive immediately (default: propose a pending Change Request)",
    )
    .addHelpText(
      "after",
      `
Examples:
  busabase-cli nodes archive --node-id nod_123
  busabase-cli nodes archive --node-id nod_123 --auto-merge   # skip review, archive immediately`,
    )
    .action(
      runAction(state, (client, opts) =>
        client.nodes.createChangeRequest({
          message: (opts.message as string | undefined) ?? "Archive node",
          submittedBy: opts.submittedBy as string | undefined,
          autoMerge: Boolean(opts.autoMerge),
          operations: [{ kind: "delete", nodeId: opts.nodeId as string }],
        }),
      ),
    );

  addGlobalFlags(nodes.command("list-archived"))
    .description(
      "List archived (soft-deleted) nodes — folders, Docs, Skills, etc. (the Trash view)",
    )
    .action(runAction(state, (client) => client.nodes.listArchived()));

  addGlobalFlags(nodes.command("purge"))
    .description(
      "Permanently delete an ALREADY-archived node and its subtree (irreversible). Archive it first with `nodes archive` if it isn't archived yet.",
    )
    .requiredOption("--node-id <id>", "archived node id to purge")
    .action(
      runAction(state, (client, opts) => client.nodes.purge({ nodeId: opts.nodeId as string })),
    );

  addGlobalFlags(nodes.command("move"))
    .description("Move or reorder a node (applied immediately, no review needed)")
    .requiredOption("--node-id <id>", "node id to move")
    .option("--parent-node-id <id>", "new parent folder node id; omit to keep the current parent")
    .option("--position <n>", "new position among the target parent's children", (v) =>
      Number.parseInt(v, 10),
    )
    .option("--message <text>", "Change Request message")
    .option("--submitted-by <name>", "producer label")
    .addHelpText(
      "after",
      `
Examples:
  busabase-cli nodes move --node-id nod_123 --position 0
  busabase-cli nodes move --node-id nod_123 --parent-node-id nod_456 --position 2`,
    )
    .action(
      runAction(state, (client, opts) =>
        client.nodes.move({
          nodeId: opts.nodeId as string,
          parentNodeId: opts.parentNodeId as string | undefined,
          position: opts.position as number | undefined,
          message: opts.message as string | undefined,
          submittedBy: opts.submittedBy as string | undefined,
        }),
      ),
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
    .description("Create a Base — review-first by default: returns a pending Change Request")
    .requiredOption("--slug <slug>", "Base slug")
    .requiredOption("--name <name>", "Base name")
    .option("--field <slug:name:type...>", "field definition, repeatable")
    .option("--fields-json <json|@file>", "field definitions as JSON array")
    .option("--description <text>", "optional description")
    .option("--parent-node-id <id>", "parent folder node id; omit for root")
    .option(
      "--auto-merge",
      "skip review and create the Base immediately (default: propose a pending Change Request)",
    )
    .addHelpText(
      "after",
      `
Examples:
  busabase-cli bases create --slug products --name "产品目录 Products" --field product_name:"Product Name":text
  busabase-cli bases create --slug products --name "产品目录 Products" --fields-json @fields.json
  busabase-cli bases create --slug products --name "Products" --auto-merge   # skip review, create immediately`,
    )
    .action(
      runAction(state, (client, opts) =>
        client.bases.create({
          slug: opts.slug as string,
          name: opts.name as string,
          description: opts.description as string | undefined,
          parentNodeId: opts.parentNodeId as string | undefined,
          fields: parseFieldDefinitions(opts),
          ...(opts.autoMerge ? { autoMerge: true } : {}),
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
    .description("Propose a new record via a Change Request — review-first by default")
    .requiredOption("--base-id <id>", "target Base id")
    .requiredOption("--fields-json <json|@file>", "record fields as JSON, or @file.json")
    .option("--message <text>", "reviewer-facing Change Request message")
    .option("--submitted-by <name>", "producer label")
    .option(
      "--auto-merge",
      "skip review and create the record immediately (default: propose a pending Change Request)",
    )
    .addHelpText(
      "after",
      `
Examples:
  busabase-cli bases create-change-request --base-id bse_123 --fields-json '{"title":"Hello","status":"draft"}'
  busabase-cli bases create-change-request --base-id bse_123 --fields-json @record.json
  busabase-cli bases create-change-request --base-id bse_123 --fields-json '{"title":"Hello"}' --auto-merge   # skip review, create immediately`,
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
          ...(opts.autoMerge ? { autoMerge: true } : {}),
        }),
      ),
    );

  const airapps = program.command("airapps").description("AirApps (sandboxed mini-apps)");
  addGlobalFlags(airapps.command("list"))
    .description("List AirApps in the active space")
    .action(runAction(state, (client) => client.airapps.list()));
  addGlobalFlags(airapps.command("get"))
    .description("Get one AirApp by node id")
    .requiredOption("--node-id <id>", "AirApp node id")
    .action(
      runAction(state, (client, opts) => client.airapps.get({ nodeId: opts.nodeId as string })),
    );
  addGlobalFlags(airapps.command("create"))
    .description("Create an AirApp — review-first by default: returns a pending Change Request")
    .requiredOption("--slug <slug>", "AirApp slug")
    .requiredOption("--name <name>", "AirApp name")
    .option("--description <text>", "optional description")
    .option("--parent-node-id <id>", "parent folder node id; omit for root")
    .addOption(
      new Option(
        "--visibility <private|workspace|public>",
        "AirApp visibility (default private)",
      ).choices(["private", "workspace", "public"]),
    )
    .option("--version <semver>", "AirApp version (default 0.1.0)")
    .option(
      "--files-json <json|@file>",
      'files as a JSON array, or @file.json — text files {"path","content","mimeType?"} or asset-backed files {"path","assetId","displayName?","mimeType?"}',
    )
    .addOption(
      new Option(
        "--merge-mode <merge|replace>",
        "how --files-json combines with the default scaffold (default merge)",
      ).choices(["merge", "replace"]),
    )
    .option(
      "--auto-merge",
      "skip review and create the AirApp immediately (default: propose a pending Change Request)",
    )
    .addHelpText(
      "after",
      `
mergeMode explains how --files-json combines with the AirApp's default scaffold:
  merge (default) — your files are layered on top of the default Hono-template
                     scaffold by path; supply just a few files (e.g. one custom
                     route) and still get the rest of the scaffold for any path
                     you didn't provide yourself.
  replace          — your files replace the scaffold entirely; use this when
                     handing over a complete, self-contained project (e.g. a Vite
                     app) so you don't end up with stray unrelated default files
                     mixed in.

Examples:
  busabase-cli airapps create --slug hello-app --name "Hello App" --files-json @files.json
  busabase-cli airapps create --slug vite-app --name "Vite App" --files-json @files.json --merge-mode replace
  busabase-cli airapps create --slug hello-app --name "Hello App" --files-json @files.json --auto-merge   # skip review, create immediately`,
    )
    .action(
      runAction(state, (client, opts) =>
        client.airapps.create({
          slug: opts.slug as string,
          name: opts.name as string,
          description: opts.description as string | undefined,
          parentNodeId: opts.parentNodeId as string | undefined,
          visibility: opts.visibility as "private" | "workspace" | "public" | undefined,
          version: opts.version as string | undefined,
          files: opts.filesJson
            ? (parseJsonValue(opts.filesJson as string, "files-json") as Parameters<
                BusabaseClient["airapps"]["create"]
              >[0]["files"])
            : undefined,
          mergeMode: opts.mergeMode as "merge" | "replace" | undefined,
          ...(opts.autoMerge ? { autoMerge: true } : {}),
        }),
      ),
    );
  addGlobalFlags(airapps.command("files"))
    .description("List an AirApp's files")
    .requiredOption("--node-id <id>", "AirApp node id")
    .action(
      runAction(state, (client, opts) =>
        client.airapps.listFiles({ nodeId: opts.nodeId as string }),
      ),
    );
  addGlobalFlags(airapps.command("read-file"))
    .description("Read one AirApp file's content")
    .requiredOption("--node-id <id>", "AirApp node id")
    .requiredOption("--path <path>", "file path within the AirApp")
    .action(
      runAction(state, (client, opts) =>
        client.airapps.readFile({ nodeId: opts.nodeId as string, filePath: opts.path as string }),
      ),
    );
  addGlobalFlags(airapps.command("create-change-request"))
    .description("Propose file changes to an existing AirApp via a Change Request")
    .requiredOption("--node-id <id>", "AirApp node id")
    .requiredOption(
      "--operations-json <json|@file>",
      'file operations as a JSON array, or @file.json — "create"/"update" (text {"kind","path","content","mimeType?"} or asset-backed {"kind","path","assetId","displayName?","mimeType?"}), "delete" {"kind","path"}, or "metadata_update" {"kind","metadata":{"entryFile?","visibility?","version?"}}',
    )
    .option("--message <text>", "reviewer-facing Change Request message")
    .option("--submitted-by <name>", "producer label")
    .addHelpText(
      "after",
      `
Examples:
  busabase-cli airapps create-change-request --node-id nod_123 --operations-json @operations.json
  busabase-cli airapps create-change-request --node-id nod_123 --operations-json '[{"kind":"update","path":"index.js","content":"..."}]' --message "Fix handler bug"`,
    )
    .action(
      runAction(state, (client, opts) =>
        client.airapps.createChangeRequest({
          nodeId: opts.nodeId as string,
          message: opts.message as string | undefined,
          submittedBy: opts.submittedBy as string | undefined,
          operations: parseJsonValue(
            opts.operationsJson as string,
            "operations-json",
          ) as Parameters<BusabaseClient["airapps"]["createChangeRequest"]>[0]["operations"],
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
    .option(
      "--sources <sources...>",
      'restrict which content to search: "records", "files", and/or "names" (default: all three)',
    )
    .action(
      runAction(state, (client, opts) =>
        client.search({
          query: opts.query as string,
          limit: opts.limit as number | undefined,
          offset: opts.offset as number | undefined,
          sources: opts.sources as ("records" | "files" | "names")[] | undefined,
        }),
      ),
    );

  addGlobalFlags(program.command("grep"))
    .description(
      "Search files, Docs, and Base records with one pattern (unified grep; use `assets grep` for files-only)",
    )
    .requiredOption("--pattern <regex>", "literal or regex pattern")
    .option("--flags <flags>", 'RegExp flags, e.g. "i" for case-insensitive')
    .option(
      "--sources <sources...>",
      'sources to scan: "files", "docs", and/or "records" (default: all three)',
    )
    .option("--asset-ids <ids...>", "files scope: specific asset ids")
    .option("--drive-path <path>", "files scope: Drive/Skill mounted path prefix")
    .option("--mime-types <types...>", "files scope: MIME types")
    .option("--node-ids <ids...>", "docs scope: specific Doc node ids")
    .option("--base-ids <ids...>", "records scope: specific Base ids")
    .option("--base-slugs <slugs...>", "records scope: specific Base slugs")
    .option(
      "--max-matches <n>",
      "max matches, shared across sources (default 100, cap 1000)",
      parsePositiveInt,
    )
    .option("--context-lines <n>", "lines of before/after context (default 0, cap 10)", parseNum)
    .action(
      runAction(state, (client, opts) => {
        const filesScope =
          opts.assetIds || opts.drivePath || opts.mimeTypes
            ? {
                assetIds: opts.assetIds as string[] | undefined,
                drivePath: opts.drivePath as string | undefined,
                mimeTypes: opts.mimeTypes as string[] | undefined,
              }
            : undefined;
        const docsScope = opts.nodeIds ? { nodeIds: opts.nodeIds as string[] } : undefined;
        const recordsScope =
          opts.baseIds || opts.baseSlugs
            ? {
                baseIds: opts.baseIds as string[] | undefined,
                baseSlugs: opts.baseSlugs as string[] | undefined,
              }
            : undefined;
        return client.grep({
          pattern: opts.pattern as string,
          flags: opts.flags as string | undefined,
          sources: opts.sources as ("files" | "docs" | "records")[] | undefined,
          scope:
            filesScope || docsScope || recordsScope
              ? { files: filesScope, docs: docsScope, records: recordsScope }
              : undefined,
          maxMatches: opts.maxMatches as number | undefined,
          contextLines: opts.contextLines as number | undefined,
        });
      }),
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

  const assetsCommand = program.command("assets").description("Assets");
  addUploadCommand(assetsCommand);

  addGlobalFlags(assetsCommand.command("put-text"))
    .description("Write (or mark none) an asset's Drive Grep Retrieval text slot")
    .requiredOption("--asset-id <id>", "asset id")
    .option("--text <string>", "inline text (≤1MB)")
    .option("--file <path>", "read text from a local file instead of --text")
    .option("--none", "mark as having no extractable text (e.g. a scanned, image-only PDF)")
    .addHelpText(
      "after",
      `
Examples:
  busabase-cli assets put-text --asset-id ast_123 --file ./extracted.txt
  busabase-cli assets put-text --asset-id ast_123 --text "plain text"
  busabase-cli assets put-text --asset-id ast_123 --none`,
    )
    .action(runAction(state, (client, opts) => putTextCommand(client, opts)));

  addGlobalFlags(assetsCommand.command("grep"))
    .description("Search every text-bearing asset in scope")
    .requiredOption("--pattern <regex>", "literal or regex pattern")
    .option("--flags <flags>", 'RegExp flags, e.g. "i" for case-insensitive')
    .option("--asset-ids <ids...>", "scope: specific asset ids")
    .option("--drive-path <path>", "scope: Drive/Skill mounted path prefix")
    .option("--mime-types <types...>", "scope: MIME types")
    .option("--max-matches <n>", "max matches (default 100, cap 1000)", parsePositiveInt)
    .option("--context-lines <n>", "lines of before/after context (default 0, cap 10)", parseNum)
    .action(
      runAction(state, (client, opts) =>
        client.assets.grep({
          pattern: opts.pattern as string,
          flags: opts.flags as string | undefined,
          scope:
            opts.assetIds || opts.drivePath || opts.mimeTypes
              ? {
                  assetIds: opts.assetIds as string[] | undefined,
                  drivePath: opts.drivePath as string | undefined,
                  mimeTypes: opts.mimeTypes as string[] | undefined,
                }
              : undefined,
          maxMatches: opts.maxMatches as number | undefined,
          contextLines: opts.contextLines as number | undefined,
        }),
      ),
    );

  addGlobalFlags(assetsCommand.command("read-lines"))
    .description("Read an exact line range from an asset's text (range capped at 2000 lines)")
    .requiredOption("--asset-id <id>", "asset id")
    .requiredOption("--start-line <n>", "first line (1-based)", parsePositiveInt)
    .requiredOption("--end-line <n>", "last line (1-based)", parsePositiveInt)
    .action(
      runAction(state, (client, opts) =>
        client.assets.readTextLines({
          assetId: opts.assetId as string,
          startLine: opts.startLine as number,
          endLine: opts.endLine as number,
        }),
      ),
    );

  addGlobalFlags(program.command("install"))
    .description("Install a Busabase package from a GitHub repo into this space")
    .argument("<github-url>", "GitHub repo URL, optionally /tree/<ref>[/<subdir>]")
    .option("--into-folder <name>", "target folder slug (default: the package's manifest name)")
    .option("--dry-run", "print the plan (tree, record counts, collisions) and create nothing")
    .option(
      "--auto-merge",
      "merge the package's records and docs on the spot instead of leaving them as change requests to review — this TRUSTS THE PACKAGE AUTHOR, since skills and AirApps carry code your agents will run (default: review first)",
    )
    .option(
      "--rename",
      "install colliding items under suffixed slugs (-2, -3, …) instead of failing",
    )
    .addHelpText(
      "after",
      `
The URL's git ref is the version pin — a tag installs that tag's content forever,
even after the branch moves on. GITHUB_TOKEN is honored for private repos.

Examples:
  busabase-cli install https://github.com/acme/support-kb-template
  busabase-cli install https://github.com/acme/packages/tree/v1.2.0/skills/pdf-summarizer
  busabase-cli install https://github.com/acme/support-kb-template --dry-run
  busabase-cli install https://github.com/acme/support-kb-template --into-folder support --auto-merge

Folders, Bases, their fields and their views are structure and are always created
immediately. Records are content: by default they land as change requests for you
to review, and --auto-merge merges them on the spot instead.

A package whose records carry relation values requires --auto-merge — a relation
stores the ids of the records it points at, and those exist only once the records
are merged, so review-first would install every relation empty. Defining a relation
field with nothing linked yet does not trigger this.`,
    )
    .action(
      runArgAction(state, (repoUrl, client, opts, config) =>
        runInstall(client, repoUrl, {
          intoFolder: opts.intoFolder as string | undefined,
          dryRun: Boolean(opts.dryRun),
          autoMerge: Boolean(opts.autoMerge),
          rename: Boolean(opts.rename),
          json: config.output === "json",
          githubToken: process.env.GITHUB_TOKEN,
        }),
      ),
    );

  addGlobalFlags(program.command("publish"))
    .description("Export a node subtree as a Busabase package directory you can push to GitHub")
    .argument("<node-slug-or-id>", "the folder/node to publish")
    .requiredOption("-o, --out-dir <dir>", "output directory for the package")
    .option("--name <name>", "package name (default: reuse busabase.json, else the node slug)")
    .option("--dry-run", "list the files that would be written and write nothing")
    .addHelpText(
      "after",
      `
Output is deterministic: publishing twice from an unchanged space produces
byte-identical files, so a GitHub diff shows exactly what changed.

Examples:
  busabase-cli publish support-kb -o ./support-kb-template
  busabase-cli publish support-kb -o ./support-kb-template --name "Support KB" --dry-run`,
    )
    .action(
      runArgAction(state, (nodeSlugOrId, client, opts, config) =>
        runPublish(client, nodeSlugOrId, {
          outDir: opts.outDir as string,
          name: opts.name as string | undefined,
          dryRun: Boolean(opts.dryRun),
          json: config.output === "json",
          baseUrl: config.baseUrl,
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
