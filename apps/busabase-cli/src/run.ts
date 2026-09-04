import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { basename, extname } from "node:path";
import { customAgentPromptsSchema } from "busabase-contract/contract/node-agent-prompt-schemas";
import { BUSABASE_TASKS, TASK_SUPERSEDED_MCP_TOOLS } from "busabase-contract/tasks";
import {
  type BusabaseClient,
  type ResolvedConfig as BusabaseConfig,
  createBusabaseClient,
  DEFAULT_BASE_URL,
  getRecordByField,
  grepAssets,
  normalizeBaseUrl,
} from "busabase-sdk";
import {
  Command,
  CommanderError,
  InvalidArgumentError,
  Option,
  type OptionValues,
} from "commander";
import {
  activateLoggedInProfile,
  runAuthConfigList,
  runAuthConfigSet,
  runAuthRemove,
  runAuthStatus,
  runAuthSwitch,
  runSpaceList,
  runSpaceUse,
} from "./auth.js";
import { runBackup, runRestore } from "./backup/commands.js";
import { banner } from "./banner.js";
import {
  activeCredentialTarget,
  isMultiProfile,
  loadConfigFile,
  loadDotEnvFile,
  resolveCredentialTarget,
  setActiveCredentialTarget,
} from "./config-file.js";
import {
  type ContractProcedure,
  contractProcedures,
  kebab,
  matchRoute,
} from "./contract-catalog.js";
import {
  DRY_RUN_NO_WRITE_NOTE,
  DryRunInterception,
  dryRunFetch,
  observeRequests,
  renderDryRunPlan,
} from "./dry-run.js";
import { CliOutcomeError, classifyError, EXIT_CODES, errorEnvelope, toIssues } from "./errors.js";
import { type OutputFormat, render, slim } from "./format.js";
import {
  assertCredentialNotExpired,
  authRecoveryHint,
  maybeAutoRefresh,
  runLogin,
  runLogout,
  runRefresh,
} from "./login.js";
import { type CheckLayer, runCheck } from "./package/check.js";
import { runExport, runIndex, runInstall } from "./package/commands.js";
import { paginateAll } from "./paginate.js";
import {
  QR_DEFAULT_SIZE,
  QR_DISPLAY_HINT,
  QR_MAX_SIZE,
  QR_MIN_SIZE,
  renderQrAscii,
  safeQrOutputPath,
  writeQrPng,
} from "./qrcode-command.js";
import { withRetry } from "./retry.js";
import {
  describeEndpoint,
  listEndpoints,
  renderEndpoint,
  renderList,
  requiredLevelFor,
  sampleEndpointId,
} from "./schema-command.js";
import { registerTaskCommands } from "./task-command.js";
import { findChangeRequestId, waitForChangeRequest } from "./wait.js";

/**
 * CLI config = the SDK's resolved client config plus the terminal-only `output`
 * mode and the resolved `retries` count. `output` never reaches the client
 * factory; it drives {@link render}. `retries` is already baked into `fetch`,
 * but is carried separately for commands that retry above the fetch layer.
 */
type ResolvedConfig = BusabaseConfig & { output: OutputFormat; retries: number };

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
/** `output` saved in ~/.busabase/config.json, ignored unless it names a real format. */
function configuredOutput(): OutputFormat | undefined {
  const saved = loadConfigFile().output;
  return saved === "text" || saved === "table" || saved === "json" ? saved : undefined;
}

/**
 * Precedence: explicit flag > exported env var > credential file > default. Reading the
 * file directly means `busabase-cli` works straight after onboarding without a manual `source`,
 * while an exported env var still overrides the file.
 *
 * Which credential file that is comes from `--config` / `--profile` (see
 * {@link resolveCredentialTarget}); with neither, it is `~/.busabase/.env` exactly as before.
 * Pinning the target here — ahead of the first {@link loadDotEnvFile} — means every later
 * read *and write* in this process (including login's token rotation) lands on the same file.
 */
function resolveConfig(opts: OptionValues): ResolvedConfig {
  setActiveCredentialTarget(
    resolveCredentialTarget({
      profile: opts.profile as string | undefined,
      config: opts.config as string | undefined,
    }),
  );
  const file = loadDotEnvFile();
  const baseUrl =
    (opts.baseUrl as string | undefined) ??
    process.env.BUSABASE_BASE_URL ??
    file.BUSABASE_BASE_URL ??
    DEFAULT_BASE_URL;
  const retries = (opts.retries as number | undefined) ?? DEFAULT_RETRIES;
  return {
    baseUrl,
    /**
     * The number itself, not just the `fetch` built from it. `backup` retries
     * at a level this wrapper cannot reach — see `FullExportOptions.retries` —
     * and has to honour the same flag, or `--retries` silently means nothing
     * for the one command whose failures cost hours.
     */
    retries,
    // The CLI has no --web-url flag yet; same-origin is the overwhelmingly common
    // case, matching busabase-sdk's own resolveConfig default.
    webUrl: process.env.BUSABASE_WEB_URL ?? file.BUSABASE_WEB_URL ?? baseUrl,
    apiKey:
      (opts.apiKey as string | undefined) ?? process.env.BUSABASE_API_KEY ?? file.BUSABASE_API_KEY,
    spaceId:
      (opts.spaceId as string | undefined) ??
      process.env.BUSABASE_SPACE_ID ??
      file.BUSABASE_SPACE_ID,
    sourceChannel: "cli",
    output: (opts.output as OutputFormat | undefined) ?? configuredOutput() ?? "text",
    // One wrapper serves the typed client (`createBusabaseClient` takes a
    // `fetch`) and `rawFetch`, so health / openapi / `api` retry the same way
    // every contract call does.
    fetch: withRetry(fetch, { retries }),
  };
}

/** Enough to ride out a rate limiter or a proxy blip; not enough to hide a real outage. */
const DEFAULT_RETRIES = 2;

/**
 * Config flags accepted anywhere on the line (`busabase-cli --output json bases list` and
 * `busabase-cli bases list --output json` both work): declared on the root program AND on every
 * leaf command, merged via `optsWithGlobals()` (leaf wins). No commander defaults here — a leaf
 * default would shadow a root-provided value, so defaults live in `resolveConfig` instead.
 */
const GLOBAL_LONG_FLAGS = new Set([
  "--base-url",
  "--api-key",
  "--space-id",
  "--output",
  "--profile",
  "--config",
  "--slim",
  "--retries",
  "--all",
  "--max-items",
  "--wait",
  "--wait-timeout",
]);

function addGlobalFlags(cmd: Command): Command {
  return cmd
    .option(
      "--base-url <url>",
      `server base URL (env BUSABASE_BASE_URL, default ${DEFAULT_BASE_URL})`,
    )
    .option("--api-key <token>", "bearer token for cloud hosts (env BUSABASE_API_KEY)")
    .option("--space-id <id>", "target Busabase space (env BUSABASE_SPACE_ID)")
    .option("--profile <name>", "account to use for this command (env BUSABASE_PROFILE)")
    .option("--config <path>", "read credentials from this file instead (env BUSABASE_CONFIG)")
    .addOption(
      new Option("--output <fmt>", "text | table | json (default text)").choices([
        "text",
        "table",
        "json",
      ]),
    )
    .option(
      "--slim",
      "drop hydrated parents (a record's full `base`, `createdByUser`, `headCommit`) and keep their ids",
    )
    .option(
      "--retries <n>",
      "extra attempts on 429 / 5xx / dropped connections (default 2, 0 disables)",
      parseNonNegativeInt,
    )
    .option("--all", "follow the cursor to the end and stream every row as NDJSON")
    .option("--max-items <n>", "stop --all after this many rows", parsePositiveInt)
    .option(
      "--wait",
      "after submitting a Change Request, block until a reviewer merges or rejects it",
    )
    .option("--wait-timeout <seconds>", "budget for --wait (default 300)", parsePositiveInt);
}

const parseNum = (value: string): number => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new InvalidArgumentError("expected a number");
  return parsed;
};

const parsePositiveInt = (value: string): number => {
  const parsed = parseNum(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new InvalidArgumentError("expected a positive integer");
  }
  return parsed;
};

const parseNonNegativeInt = (value: string): number => {
  const parsed = parseNum(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new InvalidArgumentError("expected a non-negative integer");
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

/**
 * Format a non-OK raw-fetch response body into a readable error message. The
 * server's JSON error shape is `{ error, code, data }` (see `encodeOpenApiError`
 * in apps/busabase/src/app/api/v1/[[...rest]]/route.ts) — when the body parses
 * as that shape, surface `error` (and, if present, each `data.issues` entry as
 * `path: message`) instead of the raw JSON blob. Falls back to the raw text for
 * any non-JSON / unrecognized body so nothing is ever silently dropped.
 */
/**
 * Render a validation error's per-issue detail as `path: message`.
 *
 * Load-bearing, not cosmetic: a schema that refuses a field explains WHY in the
 * issue message (e.g. "deleteMode: Invalid option: expected \"archive\"" — hard
 * delete after retention was never implemented). Without this the caller sees
 * only the generic envelope "Input validation failed" and is no better off than
 * when the field was silently dropped.
 */
function formatIssues(issues: unknown): string | undefined {
  const parsed = toIssues(issues);
  if (!parsed) return undefined;
  return parsed.map(({ path, message }) => (path ? `${path}: ${message}` : message)).join("; ");
}

function formatRawErrorBody(status: number, statusText: string, text: string): string {
  try {
    const parsed = JSON.parse(text) as { error?: unknown; data?: unknown };
    if (typeof parsed.error === "string") {
      const details = formatIssues((parsed.data as { issues?: unknown } | undefined)?.issues);
      const message = details ? `${parsed.error} — ${details}` : parsed.error;
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
  const res = await (config.fetch ?? fetch)(url, {
    method: method.toUpperCase(),
    headers: {
      ...(body !== undefined ? { "content-type": "application/json" } : {}),
      ...(config.apiKey ? { authorization: `Bearer ${config.apiKey}` } : {}),
      ...(config.spaceId ? { "x-busabase-space": config.spaceId } : {}),
      "x-busabase-channel": "cli",
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
  /**
   * Contract id of the endpoint the running command calls (`records.changeRequest`),
   * when it maps to exactly one. Set by the generated leaves; lets a `403` name the
   * permission level this specific call needed instead of giving generic advice.
   */
  procedureId?: string;
  /** Method + path of the last request sent — resolves the endpoint behind a task command. */
  lastRequest?: { method: string; pathname: string };
}

type Handler = (
  client: BusabaseClient,
  opts: OptionValues,
  config: ResolvedConfig,
) => Promise<unknown>;

/** Wrap a leaf-command handler: resolve config, build the client, render the result. */
/**
 * Is this a 404 — either "this server has no such route" or "no such node"?
 *
 * Duck-typed rather than an `instanceof ORPCError` check, because this package
 * deliberately depends on no `@orpc/*` package; the SDK builds the error and
 * only its `status` is needed here.
 *
 * Not distinguishing the two 404s is safe for the one thing this gates: a
 * version fallback whose other branch targets the SAME node. An old server
 * answers 404 because the route is missing and the fallback then succeeds; a
 * current server answers 404 because the node does not exist, the fallback
 * asks about the same missing node and 404s too, and the caller still sees a
 * "not found" error. The cost of guessing wrong is one extra request, not a
 * write landing somewhere unintended.
 */
function isNotFound(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "status" in error &&
    (error as { status?: unknown }).status === 404
  );
}

function runAction(state: CliState, handler: Handler) {
  return async (_opts: OptionValues, cmd: Command): Promise<void> => {
    const opts = cmd.optsWithGlobals();
    const config = resolveConfig(opts);
    const refreshedToken = await maybeAutoRefresh(config.baseUrl, config.apiKey);
    if (refreshedToken) config.apiKey = refreshedToken;
    state.config = config;
    assertCredentialNotExpired(config.apiKey);
    // Outermost wrapper, so an interception never reaches `withRetry` and can
    // never be mistaken for a transient failure worth repeating.
    const dryRun = Boolean(opts.dryRun);
    config.fetch = observeRequests(config.fetch ?? fetch, (seen) => {
      state.lastRequest = seen;
    });
    if (dryRun) config.fetch = dryRunFetch(config.fetch);
    const client = createBusabaseClient(config);
    try {
      if (opts.all) {
        await streamAllPages(client, opts, config, handler);
        return;
      }
      const result = await handler(client, opts, config);
      console.log(render(opts.slim ? slim(result) : result, config.output));
      if (dryRun) console.error(DRY_RUN_NO_WRITE_NOTE);
      if (opts.wait) await awaitReview(client, opts, config, result);
    } catch (error) {
      if (!(error instanceof DryRunInterception)) throw error;
      // A suppressed write is a successful dry run, not a failed command: the
      // plan goes to stdout (it is the result the caller asked for) and the exit
      // code stays 0 so a script can branch on the real thing failing.
      console.log(
        config.output === "json"
          ? render({ dryRun: true, wouldSend: error.plan }, config.output)
          : renderDryRunPlan(error.plan),
      );
    }
  };
}

/** Default `--wait` budget: long enough for a reviewer who is at their desk. */
const DEFAULT_WAIT_SECONDS = 300;

/**
 * Block until the Change Request this command just filed is decided.
 *
 * The result is printed first, so a caller that times out still has the id it
 * needs to come back to. Exit codes carry the outcome (see `errors.ts`): merged
 * is success, rejected is a decision the caller must branch on, and a timeout is
 * neither — nothing was decided, so the write must NOT be retried.
 */
async function awaitReview(
  client: BusabaseClient,
  opts: OptionValues,
  config: ResolvedConfig,
  result: unknown,
): Promise<void> {
  const changeRequestId = findChangeRequestId(result);
  if (!changeRequestId) {
    console.error(
      "[busabase-cli] --wait: this command filed no Change Request; nothing to wait for.",
    );
    return;
  }
  const outcome = await waitForChangeRequest({
    changeRequestId,
    read: (id) => client.changeRequests.get({ changeRequestId: id }),
    timeoutMs: ((opts.waitTimeout as number | undefined) ?? DEFAULT_WAIT_SECONDS) * 1000,
    notify: (message) => console.error(message),
  });
  console.log(
    render(opts.slim ? slim(outcome.changeRequest) : outcome.changeRequest, config.output),
  );
  if (outcome.kind === "timeout") {
    throw new CliOutcomeError(
      "TIMEOUT",
      `--wait timed out: ${changeRequestId} is still ${outcome.status}. Nothing was decided — do NOT resubmit; poll it with \`busabase-cli change-requests get --change-request-id ${changeRequestId}\`.`,
    );
  }
  if (outcome.status !== "merged") {
    throw new CliOutcomeError(
      "REVIEW_REJECTED",
      `${changeRequestId} was ${outcome.status}, not merged.`,
    );
  }
}

/**
 * `--all` re-runs the same handler with a moving cursor. The handler reads its
 * input off `opts`, so advancing the page is a matter of setting `opts.cursor`
 * before each call rather than teaching every command a second code path.
 */
async function streamAllPages(
  client: BusabaseClient,
  opts: OptionValues,
  config: ResolvedConfig,
  handler: Handler,
): Promise<void> {
  // Whether this command can page at all is decided by what the first call
  // returns (see `readPage`), not by inspecting its flags: a command with no
  // cursor simply yields one page and stops.
  const rows = await paginateAll({
    fetchPage: async (cursor) => {
      opts.cursor = cursor;
      const result = await handler(client, opts, config);
      return opts.slim ? slim(result) : result;
    },
    limit: typeof opts.limit === "number" ? opts.limit : undefined,
    maxItems: typeof opts.maxItems === "number" ? opts.maxItems : undefined,
    write: (line) => console.log(line),
    notify: (message) => console.error(message),
  });
  if (rows === 0) console.error("[busabase-cli] no rows.");
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
    const refreshedToken = await maybeAutoRefresh(config.baseUrl, config.apiKey);
    if (refreshedToken) config.apiKey = refreshedToken;
    state.config = config;
    assertCredentialNotExpired(config.apiKey);
    const client = createBusabaseClient(config);
    const result = await handler(arg, client, opts, config);
    console.log(render(opts.slim ? slim(result) : result, config.output));
  };
}

/**
 * A command that touches only the local filesystem.
 *
 * `runArgAction` resolves credentials and builds a client before it calls the
 * handler, which is right for everything that talks to a workspace — and wrong
 * for `index`, whose whole job is to read a checkout. A CI runner building the
 * catalog has no Busabase server and no key, and demanding one would make the
 * catalog impossible to build in exactly the place it is meant to be built.
 */
function runLocalArgAction(
  handler: (arg: string, opts: OptionValues, config: ResolvedConfig) => Promise<unknown>,
) {
  return async (arg: string, _opts: OptionValues, cmd: Command): Promise<void> => {
    const opts = cmd.optsWithGlobals();
    const config = resolveConfig(opts);
    const result = await handler(arg, opts, config);
    console.log(render(opts.slim ? slim(result) : result, config.output));
  };
}

export function pkgVersion(): string {
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

// `kebab`, `ContractProcedure` and the contract walk live in ./contract-catalog.js
// so the generated command tree and `busabase-cli schema` describe the same set of
// endpoints — two independent walkers would drift, and the drift only shows up when
// someone trusts the wrong one.

type GenFlagKind = "string" | "number" | "boolean" | "enum" | "json";
interface GenField {
  key: string;
  kind: GenFlagKind;
  required: boolean;
  choices?: string[];
  /** This is the sole field and its JSON value IS the whole input, not a single property of it. */
  root?: boolean;
  /** Fixed by the command name (a union discriminator) — sent, but never a flag. */
  pinned?: string;
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
  const shape = objectShape(inner);
  if (!shape) {
    return [{ key: "input", kind: "json", required: true, root: true }];
  }
  return fieldsFromShape(shape);
}

/** The `shape` of an object schema, or undefined for any other type. */
function objectShape(inner: any): Record<string, any> | undefined {
  const shape = inner?.shape ?? (inner?.def?.type === "object" ? inner.def.shape : undefined);
  return shape && typeof shape === "object" ? (shape as Record<string, any>) : undefined;
}

function fieldsFromShape(shape: Record<string, any>): GenField[] {
  const fields: GenField[] = [];
  for (const [key, sub] of Object.entries(shape)) {
    const { inner: unwrapped, optional } = unwrapSchema(sub);
    const { kind, choices } = classifyKind(unwrapped);
    fields.push({ key, kind, required: !optional, choices });
  }
  return fields;
}

export interface GenVariant {
  /** The discriminator value, e.g. "update" — also the command-name prefix. */
  value: string;
  /** Flags for this branch, with the discriminator itself removed (the command name pins it). */
  fields: GenField[];
}

/**
 * Expand a discriminated-union input into one command per branch.
 *
 * The contract collapses verb-per-endpoint groups into a single endpoint taking
 * `{ operation, ... }` (`records.changeRequest`, `bases.fieldChangeRequest`,
 * `views.changeRequest`). Without this, `inputFields` would see a non-object top
 * level and degrade the whole payload to one `--input-json` blob. Instead each
 * branch becomes its own leaf — `records update-change-request --record-id ...`,
 * exactly the command surface these endpoints had before they merged.
 *
 * Handles the union directly and wrapped in an intersection (`union.and({ baseId })`,
 * which is how a path param is added on top of the union).
 */
function unionVariants(inputSchema: unknown, discriminator = "operation"): GenVariant[] | null {
  if (inputSchema === undefined) return null;
  const { inner } = unwrapSchema(inputSchema);

  // `union.and(object)` — collect the extra object's fields to merge into every branch.
  let unionNode = inner;
  let extraShape: Record<string, any> = {};
  if (inner?.def?.type === "intersection") {
    for (const side of [inner.def.left, inner.def.right]) {
      const { inner: sideInner } = unwrapSchema(side);
      const shape = objectShape(sideInner);
      if (shape) extraShape = { ...extraShape, ...shape };
      else unionNode = sideInner;
    }
  }

  const options = unionNode?.def?.options ?? unionNode?.options;
  if (!Array.isArray(options) || options.length === 0) return null;

  const variants: GenVariant[] = [];
  for (const option of options) {
    const { inner: optionInner } = unwrapSchema(option);
    const shape = objectShape(optionInner);
    if (!shape) return null;
    const { inner: discInner } = unwrapSchema(shape[discriminator]);
    const value = discInner?.def?.values?.[0] ?? discInner?.def?.value;
    if (typeof value !== "string") return null;
    const { [discriminator]: _pinned, ...rest } = shape;
    variants.push({ value, fields: fieldsFromShape({ ...rest, ...extraShape }) });
  }
  return variants;
}

/**
 * Words of an identifier, however it was spelled: `changeRequests` + `reviewMany`
 * and `change_requests_review_many` both reduce to
 * `change requests review many`. Lets the CLI compare its own generated command
 * paths against the MCP tool names in {@link TASK_SUPERSEDED_MCP_TOOLS} without
 * either side having to know how the other spells things.
 */
const identifierWords = (parts: readonly string[]): string =>
  parts
    .flatMap((part) => part.split(/[_\-\s]+/))
    .flatMap((part) => part.replace(/([a-z0-9])([A-Z])/g, "$1 $2").split(" "))
    .filter(Boolean)
    .map((word) => word.toLowerCase())
    .join(" ");

/**
 * Endpoint commands a curated task command already covers.
 *
 * The MCP adapter has always dropped these so "a catalog carries one way to do
 * each job rather than two" — and then the CLI published BOTH spellings, which
 * is a third of a 30 KB help screen an agent reads to orient itself. Same list,
 * same reason, one more consumer.
 *
 * Hidden, never removed: every one of them still runs, so no existing script
 * breaks, and `--help-all` prints them.
 */
const SUPERSEDED_COMMAND_PATHS = new Set(
  TASK_SUPERSEDED_MCP_TOOLS.map((tool) => identifierWords([tool])),
);

/**
 * Procedures a curated command already exposes under a DIFFERENT name (so the
 * name-collision guard wouldn't catch them). Keyed `group.procKey`.
 */
const GENERATED_SKIP = new Set<string>([
  "search", // top-level `search`
  // Both served by the top-level `guide [topic]`, which prints the markdown as
  // markdown instead of as one escaped table cell.
  "guides.list",
  "guides.read",
  "auth.verify", // `whoami`
  "records.search", // `records by-field-text`
  "records.listChangeRequests", // `records change-requests`
  // The `/file-trees` group is exposed by the task layer as `nodes
  // list-file-trees` / `get-file-tree` / `files` / `read-file` /
  // `files-change-request`, each taking `--kind` (see tasks/file-tree.ts).
  // `fileTrees.list`/`fileTrees.get` are absent because the procedures are: the
  // two tasks that used to call them now call `nodes.list({ types })` /
  // `nodes.get`, so there is nothing left for the generator to skip.
  "fileTrees.create",
  "fileTrees.listFiles",
  "fileTrees.readFile",
  "fileTrees.createChangeRequest",
  // `nodes get` is the curated `docs|files|folders get` facade's underlying
  // route, but it stays generated too: it is the ONE command that reads a node
  // of any type without knowing the type first, which is the whole point of the
  // consolidation.
]);

/** Routes that change nothing — they run for real under `--dry-run`, so no flag is offered. */
const READ_ROUTE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

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
    // navPath[0] locates the top-level group (e.g. "nodes"); any deeper segments
    // (e.g. "principals" in nodes.principals.list) are folded into the leaf's own
    // name instead of a second command level, so `nodes.principals.list` becomes
    // `busabase-cli nodes principals-list`, not a third-level subcommand.
    const baseName = [...navPath.slice(1), procKey].map(kebab).join("-");

    // A discriminated-union input becomes one leaf per branch (see unionVariants),
    // so a merged verb-per-operation endpoint keeps its per-verb command surface.
    const variants = unionVariants(inputSchema);
    if (variants) {
      for (const variant of variants) {
        addOneLeaf(
          parent,
          navPath,
          procKey,
          proc,
          `${kebab(variant.value)}-${baseName}`,
          [
            { key: "operation", kind: "string", required: true, pinned: variant.value },
            ...variant.fields,
          ],
          // The shared summary describes the merged endpoint; say which branch this is.
          `${route.summary ?? baseName} — operation "${variant.value}"`,
        );
      }
      return;
    }
    addOneLeaf(parent, navPath, procKey, proc, baseName, inputFields(inputSchema));
  };

  const addOneLeaf = (
    parent: Command,
    navPath: string[],
    procKey: string,
    proc: ContractProcedure,
    name: string,
    fields: GenField[],
    description?: string,
  ) => {
    const { route } = proc["~orpc"];
    // Curated command (or dup) wins. Aliases count: a task that renamed a command
    // keeps the old spelling as an alias, and commander throws outright if the
    // generated fallback then tries to register that same name.
    if (parent.commands.some((c) => c.name() === name || c.aliases().includes(name))) return;
    const superseded = SUPERSEDED_COMMAND_PATHS.has(identifierWords([parent.name(), name]));
    const leaf = parent
      .command(name, superseded ? { hidden: true } : undefined)
      .description(description ?? route.summary ?? `${route.method} ${route.path}`);
    for (const f of fields) {
      // Pinned by the command name (the union discriminator) — no flag for it.
      if (f.pinned !== undefined) continue;
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
    // Only where it means something: a GET changes nothing, so offering to
    // suppress its write would advertise a guarantee with no content.
    if (!READ_ROUTE_METHODS.has(route.method.toUpperCase())) {
      leaf.option("--dry-run", "print the request this would send and send nothing");
    }
    const procedureId = [...navPath, procKey].join(".");
    leaf.addHelpText(
      "after",
      `\nOpenAPI: ${route.method} ${route.path}\nRequires API key level: ${requiredLevelFor(procedureId).level}`,
    );
    leaf.action(
      runAction(state, (client, opts) => {
        // Recorded before the call so a 403 can name this endpoint's required level.
        state.procedureId = procedureId;
        let input: unknown = {};
        for (const f of fields) {
          if (f.pinned !== undefined) {
            (input as Record<string, unknown>)[f.key] = f.pinned;
            continue;
          }
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

  for (const { id, navPath, key, proc } of contractProcedures()) {
    if (GENERATED_SKIP.has(id)) continue;
    // navPath[0] is always the top-level group; any deeper segments (nested
    // contract groups, e.g. nodes.principals.list) are folded into the leaf
    // name by addLeaf rather than becoming a third command level.
    const parent = navPath.length
      ? getGroup(kebab(navPath[0]), proc["~orpc"].route.tags?.[0])
      : program;
    addLeaf(parent, navPath, key, proc);
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
 * Commander records `command(name, { hidden })` and `{ noHelp }` on `_hidden`;
 * this read `_noHelp`, which commander never sets, so it always answered false
 * and nothing was ever actually hidden from the root help.
 */
const isHelpHidden = (cmd: Command): boolean =>
  Boolean((cmd as { _hidden?: boolean; _noHelp?: boolean })._hidden) ||
  Boolean((cmd as { _noHelp?: boolean })._noHelp);

/**
 * Set for the duration of a `--help-all` render. A module-level flag rather than
 * a parameter because commander calls the help hook itself, with no way to
 * thread an argument through.
 */
let showAllCommands = false;

/**
 * Root help "Commands:" section: every leaf with its full flag signature (the flat
 * commander listing would only show group names). Generated from the command tree,
 * never hand-written.
 */
function commandsSection(program: Command, showAll = false): string {
  const lines: string[] = ["Commands:"];
  const skip = (cmd: Command) => cmd.name() === "help" || (!showAll && isHelpHidden(cmd));
  const entry = (prefix: string, cmd: Command) => {
    const sig = [prefix, flagSignature(cmd)].filter(Boolean).join(" ");
    const desc = cmd.description();
    if (!desc) return `  ${sig}`;
    if (sig.length <= 40) return `  ${sig.padEnd(42)}${desc}`;
    return `  ${sig}\n${" ".repeat(44)}${desc}`;
  };
  for (const cmd of program.commands) {
    if (skip(cmd)) continue;
    const leaves = cmd.commands.filter((leaf) => !skip(leaf));
    if (leaves.length > 0) {
      lines.push("");
      for (const leaf of leaves) lines.push(entry(`${cmd.name()} ${leaf.name()}`, leaf));
    } else if (cmd.commands.length === 0) {
      // A group whose every leaf is hidden is not itself runnable — printing it
      // as a leaf would advertise a command that does nothing.
      lines.push(entry(cmd.name(), cmd));
    }
  }
  return lines.join("\n");
}

const HELP_FOOTER = `
Config is read from flags, then env vars, then ~/.busabase/.env (auto-loaded — no
need to source it). An exported env var overrides the file.

Several accounts: \`login --profile <name>\` adds one, \`auth status\` lists them,
\`auth switch\` changes which is active. Several spaces on one account (the norm on
Cloud): \`space list\` / \`space use\`.

New here? \`busabase-cli guide\` is the operating manual — read \`workspace\` before
proposing changes. Endpoint commands a task command already covers are hidden;
\`--help-all\` prints them (they all still run).

Docs: https://busabase.com/docs · Troubleshooting: ${DOCS_TROUBLESHOOTING}`;

/** Exported for the help-example test, which walks the command tree in-process. */
export function buildProgram(state: CliState = {}): Command {
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

  addGlobalFlags(program.command("schema"))
    .argument("[endpoint...]", "contract id, e.g. `bases.list` or `bases list`; omit to list all")
    .description("Print one endpoint's input/output schema — offline, no credential")
    .addOption(
      new Option("--io <half>", "print only one half of the schema").choices(["input", "output"]),
    )
    .addHelpText(
      "after",
      `
Answers "what do I send, and what comes back" without fetching anything. The
contract is compiled into this CLI, so \`schema\` works offline and unauthenticated.

Prefer it over \`busabase-cli openapi\`: that returns the WHOLE document — 936 KB
across 103 endpoints as of 2026-09-04, with every type inlined per endpoint — so
reading one endpoint's arguments out of it costs roughly 234k tokens. One
endpoint through \`schema\` is a few KB.

  busabase-cli schema                                 # every endpoint: id, method, path
  busabase-cli schema ${sampleEndpointId()}                       # input + output schema
  busabase-cli schema records.changeRequest --io input  # just what to send
  busabase-cli schema records list --output json       # machine-readable

Ids are the contract path. \`schema\` also accepts the space-separated and kebab
spellings, so you can paste back whatever you saw.`,
    )
    .action((endpoint: string[], _opts: OptionValues, cmd: Command) => {
      const opts = cmd.optsWithGlobals();
      const config = resolveConfig(opts);
      state.config = config;
      const io = opts.io as "input" | "output" | undefined;
      if (!endpoint || endpoint.length === 0) {
        const entries = listEndpoints();
        console.log(
          config.output === "json" ? render(entries, config.output) : renderList(entries),
        );
        return;
      }
      const described = describeEndpoint(endpoint.join("."), io);
      console.log(
        config.output === "json" ? render(described, config.output) : renderEndpoint(described),
      );
    });

  addGlobalFlags(program.command("whoami"))
    .description("Active space, user, and membership")
    .action(runAction(state, (client) => client.auth.verify()));

  addGlobalFlags(program.command("guide"))
    .argument("[topic]", "which guide to read; omit to list the topics this server serves")
    .description("Read the Busabase operating manual (workspace conventions, AirApp contract)")
    .addHelpText(
      "after",
      `
Read this BEFORE unfamiliar work. It carries the conventions this workspace
expects, which no flag or schema can express on its own.

Examples:
  busabase-cli guide                 # what is available here
  busabase-cli guide workspace       # the change-request workflow
  busabase-cli guide airapp          # REQUIRED before writing any AirApp file`,
    )
    .action(async (topic: string | undefined, _opts: OptionValues, cmd: Command) => {
      const opts = cmd.optsWithGlobals();
      const config = resolveConfig(opts);
      state.config = config;
      const client = createBusabaseClient(config);
      if (!topic) {
        console.log(render(await client.guides.list(), config.output));
        return;
      }
      const guide = await client.guides.read({ topic });
      // The document is markdown meant to be READ. Rendering it through the
      // table/record formatter would print it as one escaped cell, so text mode
      // prints the body itself and only `--output json` wraps it.
      if (config.output === "json") {
        console.log(render(guide, config.output));
        return;
      }
      console.log(guide.content);
      console.error(`\n[busabase-cli] other topics: ${guide.otherTopics.join(", ") || "(none)"}`);
    });

  addGlobalFlags(program.command("login"))
    .description("Connect the CLI to Busabase — Personal/local, Cloud, or self-hosted")
    .option("--device-code", "force device authorization and skip the method prompt")
    .option("--oauth", "legacy same-machine OAuth callback flow")
    .option("--no-browser", "print the sign-in URL instead of opening a browser")
    .option("--refresh", "rotate the saved OAuth token set (no browser, no re-login)")
    .option(
      "--no-wait",
      "start a device sign-in and return verification_url + resume_code at once (for agents)",
    )
    .option("--resume-code <code>", "finish a device sign-in started earlier with --no-wait")
    .addHelpText(
      "after",
      `
Busabase is your AI agents' database, knowledge base, apps library, and skills registry.
Every change goes in as a change request, so it keeps a message, a diff, and a history.

Run interactively, login explains the connection choices and writes the selected
Busabase instance to ~/.busabase/.env:
  1. Local/Desktop on this computer — no account, no login
  2. Busabase Cloud — device sign-in (recommended; works over SSH)
  3. Busabase Cloud — paste an API key
  4. Self-hosted Busabase — device sign-in
  5. Self-hosted Busabase — paste an API key
The flags below skip the menu (handy for scripts / CI):

  busabase-cli login                                   # pick from the menu
  busabase-cli login --device-code                     # Cloud device sign-in
  busabase-cli login --oauth                           # legacy same-machine callback
  busabase-cli login --api-key sk_…                    # Cloud API key (headless/CI)
  busabase-cli login --base-url http://localhost:15419 # connect to a local server (no auth)
  busabase-cli login --refresh                         # rotate the OAuth token set (auto-runs too)
  busabase-cli login --profile work                    # add a SECOND account, then switch to it
  busabase-cli login --no-wait --output json           # agent: URL + resume code, returns at once
  busabase-cli login --resume-code <code>              # agent: finish after the user authorized

Login never blocks on a Space question, interactive or not: with more than one Space it always
accepts the server-resolved default (the one you were most recently active in) and prints the
full list — switch anytime with \`busabase-cli space use <id>\`.

For AI agents: the blocking flows above print the verification URL mid-command, and
a harness that only relays a turn's final message will drop it — the user never
sees the URL and login silently times out. Use the two-turn flow instead: run
\`--no-wait --output json\` now, send verification_url to the user as your final
message (verbatim — never re-encode or re-wrap it; \`busabase-cli qrcode\` renders
it scannable), end the turn, then run \`--resume-code <code>\` after they confirm.
Do not restart login after showing the URL — a restart invalidates it.`,
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
            deviceCode: Boolean(opts.deviceCode),
            oauth: Boolean(opts.oauth),
            browser: opts.browser !== false,
            // `--no-wait` is commander's negation of the global `--wait` flag
            // (same `wait` attribute). Login has no --wait behavior of its own,
            // so `wait === false` means exactly "the user passed --no-wait".
            noWait: opts.wait === false,
            resumeCode: opts.resumeCode as string | undefined,
            profile: opts.profile as string | undefined,
          });
      // Only after a successful sign-in: preserve the account already on disk as
      // `default` and make this one active. Doing it here (not before) keeps a
      // failed login side-effect-free — no profiles/ appears out of nowhere.
      const profile = opts.profile as string | undefined;
      if (profile && !opts.refresh) activateLoggedInProfile(profile);
      console.log(render(summary, config.output));
    });

  addGlobalFlags(program.command("logout"))
    .description("Revoke the saved OAuth token family (if any) and clear ~/.busabase/.env")
    .action(async (_opts: OptionValues, cmd: Command) => {
      const opts = cmd.optsWithGlobals();
      const config = resolveConfig(opts);
      state.config = config;
      const summary = await runLogout({ baseUrl: config.baseUrl, apiKey: config.apiKey });
      console.log(render(summary, config.output));
    });

  addGlobalFlags(program.command("qrcode"))
    .description("Render a URL (e.g. a login verification URL) as a QR code")
    .argument("<url>", "URL to encode — treated as an opaque string, byte-for-byte")
    .option("-o, --out-file <path>", "write a PNG here (under cwd, the temp dir, or your home)")
    .option("--ascii", "print a terminal QR code to stdout instead of writing a PNG")
    .option(
      "--size <px>",
      `PNG size in pixels (${QR_MIN_SIZE}-${QR_MAX_SIZE}, default ${QR_DEFAULT_SIZE})`,
      parsePositiveInt,
    )
    .addHelpText(
      "after",
      `
Made for the two-turn login: \`login --no-wait\` returns a verification_url the
user often approves on a phone — a QR code removes the copy-a-long-URL step.

  busabase-cli qrcode "<verification_url>" --out-file qr.png
  busabase-cli qrcode "<verification_url>" --ascii

Forward URLs verbatim: never re-encode, trim, or re-wrap a verification URL —
a reworded URL is a 404 on the user's phone.`,
    )
    .action(async (url: string, _opts: OptionValues, cmd: Command) => {
      const opts = cmd.optsWithGlobals();
      const config = resolveConfig(opts);
      state.config = config;
      if (opts.ascii) {
        console.log(await renderQrAscii(url));
        return;
      }
      const outFile = opts.outFile as string | undefined;
      if (!outFile) {
        throw new Error("Pass --out-file <path> for a PNG, or --ascii for terminal output.");
      }
      const filePath = safeQrOutputPath(outFile);
      await writeQrPng(url, filePath, (opts.size as number | undefined) ?? QR_DEFAULT_SIZE);
      console.log(
        render({ status: "qr code written", filePath, url, hint: QR_DISPLAY_HINT }, config.output),
      );
    });

  const auth = program.command("auth").description("Accounts (profiles) and CLI settings");
  const authStatus = (cmd: Command) =>
    cmd.action(async (_opts: OptionValues, sub: Command) => {
      const config = resolveConfig(sub.optsWithGlobals());
      state.config = config;
      console.log(runAuthStatus(config.output));
    });
  authStatus(addGlobalFlags(auth.command("status"))).description(
    "Show every configured account, grouped by host (* = active)",
  );
  authStatus(addGlobalFlags(auth.command("list"))).description("Alias for `auth status`");

  addGlobalFlags(auth.command("switch"))
    .argument("[name]", "profile to activate; omit to pick (auto when only one alternative)")
    .description("Switch the active account, and/or repoint it at another space")
    .addHelpText(
      "after",
      `
Switching rewrites ~/.busabase/.env with the chosen account, so the busabase
skill, the docs' curl snippets and the SDK all follow along automatically.

  busabase-cli auth switch                    # pick (or auto-switch when there are two)
  busabase-cli auth switch work               # activate "work"
  busabase-cli auth switch --space-id spc_x   # keep the account, change the space only`,
    )
    .action(async (name: string | undefined, _opts: OptionValues, sub: Command) => {
      const opts = sub.optsWithGlobals();
      const config = resolveConfig(opts);
      state.config = config;
      const summary = await runAuthSwitch({
        name,
        spaceId: opts.spaceId as string | undefined,
      });
      console.log(render(summary, config.output));
    });

  addGlobalFlags(auth.command("remove"))
    .argument("<name>", "profile to delete")
    .description("Delete a stored account (switch away from it first)")
    .action(async (name: string, _opts: OptionValues, sub: Command) => {
      const config = resolveConfig(sub.optsWithGlobals());
      state.config = config;
      console.log(render(runAuthRemove(name), config.output));
    });

  const authConfig = auth.command("config").description("CLI settings (~/.busabase/config.json)");
  addGlobalFlags(authConfig.command("set"))
    .argument("<key>", "setting name (currently: output)")
    .argument("<value>", "setting value")
    .description("Save a preference that outlives an account switch")
    .action(async (key: string, value: string, _opts: OptionValues, sub: Command) => {
      const config = resolveConfig(sub.optsWithGlobals());
      state.config = config;
      console.log(render(runAuthConfigSet(key, value), config.output));
    });
  addGlobalFlags(authConfig.command("list"))
    .description("Show current settings and which account is active")
    .action(async (_opts: OptionValues, sub: Command) => {
      const config = resolveConfig(sub.optsWithGlobals());
      state.config = config;
      console.log(render(runAuthConfigList(), config.output));
    });

  const space = program
    .command("space")
    .description("Spaces of the active account (Cloud has several; self-hosted has one)");
  addGlobalFlags(space.command("list"))
    .description("List every space this account can see (* = the one commands target)")
    .action(
      runAction(state, async (client, _opts, config) =>
        runSpaceList(await client.auth.verify(), config.spaceId, config.output),
      ),
    );
  addGlobalFlags(space.command("use"))
    .argument("[space]", "space id, slug or name; omit to pick from a list")
    .description("Target another space — same account, no re-login")
    .addHelpText(
      "after",
      `
Only spaces this account belongs to can be selected, so a typo fails here rather
than as a 403 later. The choice is stored in the active profile and mirrored to
~/.busabase/.env, so the skill and curl snippets follow along.

  busabase-cli space list             # what can I target?
  busabase-cli space use              # pick from a list
  busabase-cli space use VideoFactory # by name (slug and id also work)`,
    )
    .action(async (selector: string | undefined, _opts: OptionValues, sub: Command) => {
      const opts = sub.optsWithGlobals();
      const config = resolveConfig(opts);
      const refreshedToken = await maybeAutoRefresh(config.baseUrl, config.apiKey);
      if (refreshedToken) config.apiKey = refreshedToken;
      state.config = config;
      assertCredentialNotExpired(config.apiKey);
      const client = createBusabaseClient(config);
      const summary = await runSpaceUse({
        auth: await client.auth.verify(),
        targetedSpaceId: config.spaceId,
        selector,
      });
      console.log(render(summary, config.output));
    });

  const nodes = program.command("nodes").description("Workspace node tree");
  addGlobalFlags(nodes.command("list"))
    .description("Workspace node tree")
    .action(runAction(state, (client) => client.nodes.list()));

  addGlobalFlags(nodes.command("purge"))
    .description(
      "Permanently delete an ALREADY-archived node and its subtree (irreversible). Archive it first with `nodes archive` if it isn't archived yet.",
    )
    .requiredOption("--node-id <id>", "archived node id to purge")
    .option("--dry-run", "print the request this would send and send nothing")
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
    .option("--dry-run", "print the request this would send and send nothing")
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

  addGlobalFlags(nodes.command("set-agent-prompts"))
    .description(
      "Set a node's custom scenario prompts, shown in the Agent Prompts dialog instead of the node type's generic ones. Capability prompts (what the node type can actually do) are unaffected.",
    )
    .requiredOption("--node-id <id>", "node id to customize")
    .requiredOption(
      "--file <path>",
      "JSON file: an array of { key, intent?, label, body } — see the help text below",
    )
    .addHelpText(
      "after",
      `
Each entry: { key: string (unique per node), intent?: "read-only" | "change",
label: string | { <locale>: string }, body: string | { <locale>: string } }.
Locale keys (when using the object form): en, zh-CN, zh-TW, ja, ko, de, fr, es,
pt — anything else fails validation as "Invalid input" on that field.
"body" may contain a literal "{target}" placeholder, substituted at render time
with the same node/space description every built-in prompt uses. At most 50
entries per node, 80 characters per localized label, 8 KiB per localized body.

The file is validated against this exact schema BEFORE any network request —
a malformed file (duplicate key, an over-limit label/body, an unrecognized
locale) is reported entry-by-entry and nothing is written. \`--file\`'s
contents ARE the array to store; this command does not reshape it.

Examples:
  busabase-cli nodes set-agent-prompts --node-id nod_123 --file prompts.json`,
    )
    .option("--dry-run", "print the request this would send and send nothing")
    .action(
      runAction(state, async (client, opts) => {
        const filePath = opts.file as string;
        let raw: unknown;
        try {
          raw = JSON.parse(readFileSync(filePath, "utf8"));
        } catch (error) {
          throw new CliOutcomeError(
            "VALIDATION",
            `Could not read/parse ${filePath} as JSON: ${
              error instanceof Error ? error.message : String(error)
            }`,
          );
        }
        const parsed = customAgentPromptsSchema.safeParse(raw);
        if (!parsed.success) {
          const detail = formatIssues(parsed.error.issues);
          throw new CliOutcomeError(
            "VALIDATION",
            `Invalid agent prompts in ${filePath}${detail ? ` — ${detail}` : ""}`,
          );
        }
        const nodeId = opts.nodeId as string;
        // Prefer the dedicated endpoint; fall back to the metadata key it
        // replaced when the server does not have it yet.
        //
        // The CLI and the server ship separately, so a current CLI routinely
        // talks to an older server. Calling only the new route would make this
        // command fail outright against every server not yet upgraded — which
        // is precisely how a previous change took a working command to zero
        // results in production. The fallback writes where an older server
        // still reads from, so the command keeps working either way.
        try {
          return await client.nodes.updateAgentPrompts({
            nodeId,
            agentPrompts: parsed.data,
          });
        } catch (error) {
          if (!isNotFound(error)) throw error;
          return await client.nodes.updateMetadata({
            nodeId,
            metadata: { agentPrompts: parsed.data },
          });
        }
      }),
    );

  const bases = program.command("bases").description("Bases (structured tables)");
  addGlobalFlags(bases.command("list"))
    .description("List Bases in the active space")
    .addOption(
      new Option("--status <active|archived>", "live Bases (default) or archived ones").choices([
        "active",
        "archived",
      ]),
    )
    .action(
      runAction(state, (client, opts) =>
        client.bases.list({ status: (opts.status as "active" | "archived") ?? "active" }),
      ),
    );
  addGlobalFlags(bases.command("get"))
    .description("Get one Base by slug")
    .requiredOption("--slug <slug>", "Base slug")
    .action(
      runAction(state, async (client, opts) => {
        const slug = opts.slug as string;
        const found = (await client.bases.list({})).find((base) => base.slug === slug);
        if (!found) throw new Error(`no Base with slug "${slug}"`);
        return found;
      }),
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
    .option("--dry-run", "print the request this would send and send nothing")
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
  // Kept hand-written despite `base_field_change_request` covering the same
  // endpoint: this command converts attachment shortcut flags (--max-files,
  // --allowed-mime) into the nested `patch.options` shape. That is a CLI
  // ergonomic the task layer's flat parameter model does not express, and
  // dropping it would make a common edit require hand-written JSON. MCP still
  // sees only the task — an agent emitting structured arguments gains nothing
  // from the shortcut.
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
    .option("--dry-run", "print the request this would send and send nothing")
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
        return client.bases.fieldChangeRequest({
          operation: "update",
          baseId: opts.baseId as string,
          fieldId: opts.fieldId as string,
          patch: patch as Extract<
            Parameters<BusabaseClient["bases"]["fieldChangeRequest"]>[0],
            { operation: "update" }
          >["patch"],
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
      "skip review and create the record immediately if you have write access (default: merge immediately if you have write access, otherwise propose a pending Change Request)",
    )
    .option(
      "--require-review",
      "always propose a pending Change Request, even if you have write access",
    )
    .addHelpText(
      "after",
      `
Examples:
  busabase-cli bases create-change-request --base-id bse_123 --fields-json '{"title":"Hello","status":"draft"}'
  busabase-cli bases create-change-request --base-id bse_123 --fields-json @record.json
  busabase-cli bases create-change-request --base-id bse_123 --fields-json '{"title":"Hello"}' --auto-merge   # skip review, create immediately
  busabase-cli bases create-change-request --base-id bse_123 --fields-json '{"title":"Hello"}' --require-review   # always propose a Change Request`,
    )
    .option("--dry-run", "print the request this would send and send nothing")
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
          ...(opts.requireReview
            ? { autoMerge: false }
            : opts.autoMerge
              ? { autoMerge: true }
              : {}),
        }),
      ),
    );

  const records = program.command("records").description("Records");
  addGlobalFlags(records.command("get"))
    .description("Get one record")
    .requiredOption("--record-id <id>", "record id")
    .action(
      runAction(state, (client, opts) => client.records.get({ recordId: opts.recordId as string })),
    );
  addGlobalFlags(records.command("get-by-field"))
    .description("Get one record by an exact field value")
    .requiredOption("--base-id <id>", "Base id")
    .requiredOption("--field-slug <slug>", "field slug")
    .requiredOption("--value-text <value>", "exact field value")
    .action(
      runAction(state, (client, opts) =>
        getRecordByField(client, {
          baseId: opts.baseId as string,
          fieldSlug: opts.fieldSlug as string,
          valueText: opts.valueText as string,
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
  addGlobalFlags(changeRequests.command("get"))
    .description("Get a Change Request")
    .requiredOption("--change-request-id <id>", "Change Request id")
    .action(
      runAction(state, (client, opts) =>
        client.changeRequests.get({ changeRequestId: opts.changeRequestId as string }),
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
      'sources to scan: "files", "nodes", and/or "records" (default: all three)',
    )
    .option("--asset-ids <ids...>", "files scope: specific asset ids")
    .option("--drive-path <path>", "files scope: Drive/Skill mounted path prefix")
    .option("--mime-types <types...>", "files scope: MIME types")
    .option("--node-ids <ids...>", "nodes scope: specific node ids")
    .option(
      "--node-types <types...>",
      'nodes scope: narrow to "doc", "html", "whiteboard" and/or "workflow"',
    )
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
        const nodesScope =
          opts.nodeIds || opts.nodeTypes
            ? {
                nodeIds: opts.nodeIds as string[] | undefined,
                types: opts.nodeTypes as ("doc" | "html" | "whiteboard" | "workflow")[] | undefined,
              }
            : undefined;
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
          sources: opts.sources as ("files" | "nodes" | "records")[] | undefined,
          scope:
            filesScope || nodesScope || recordsScope
              ? { files: filesScope, nodes: nodesScope, records: recordsScope }
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
      .option("--dry-run", "print the request this would send and send nothing")
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
        grepAssets(client, {
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
    .description(
      "Install a Busabase package from a GitHub repo or a local directory into this space",
    )
    .argument(
      "<source>",
      "GitHub repo URL (optionally /tree/<ref>[/<subdir>]), or a local directory / file:// URL written by `busabase-cli export`",
    )
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
    .option(
      "--skill <name>",
      "which package to install when the URL is a repository holding several (e.g. busabase/skills)",
    )
    .option(
      "--no-sample-records",
      "propose a template's sample rows for review instead of merging them (default: merged, so the app is not empty on first open)",
    )
    .option(
      "--no-rollback",
      "keep whatever a failed install created (default: it is moved to Trash)",
    )
    .addHelpText(
      "after",
      `
The URL's git ref is the version pin — a tag installs that tag's content forever,
even after the branch moves on. GITHUB_TOKEN is honored for private repos.

A local directory or a \`file://\` URL installs straight from disk instead of
GitHub — the same package \`busabase-cli export\` just wrote, useful for
authoring/testing a package before it has anywhere to be pushed. Anything that
is not an http(s):// URL is read as a local path.

Examples:
  busabase-cli install https://github.com/acme/support-kb-template
  busabase-cli install https://github.com/acme/packages/tree/v1.2.0/skills/pdf-summarizer
  busabase-cli install https://github.com/acme/support-kb-template --dry-run
  busabase-cli install https://github.com/acme/support-kb-template --into-folder support --auto-merge
  busabase-cli install ./support-kb-template --dry-run

Folders, Bases, their fields and their views are structure and are always created
immediately. Records are content: by default they land as change requests for you
to review, and --auto-merge merges them on the spot instead.

A TEMPLATE (a package that also carries a SKILL.md) installs as an app: its
manual lands as a Skill node, its nodes are stamped as belonging to that app, its
Base slugs are prefixed with the target folder so two templates cannot collide on
a name like "settings", and its sample rows are merged so the app is not empty
when you open it (--no-sample-records opts out). Its AirApp code and its Skill
still wait for your review.

If the URL is a repository that holds several packages rather than being one,
install lists them and you pick with --skill <name>.

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
          skill: opts.skill as string | undefined,
          // commander maps `--no-sample-records` to `sampleRecords: false`.
          noSampleRecords: opts.sampleRecords === false,
          noRollback: opts.rollback === false,
          json: config.output === "json",
          githubToken: process.env.GITHUB_TOKEN,
          serverUrl: config.baseUrl,
        }),
      ),
    );

  addGlobalFlags(program.command("check"))
    .description("Check a package / Skill / template / AirApp directory against its contract")
    .argument("[dir]", "directory to check, or a repo with a templates/ subdirectory", ".")
    .option("--strict", "warnings fail too")
    .option("--as <layer>", "judge it as this layer even if it has not declared itself one")
    .option("--only <layer>", "report only this layer (package | skill | template | airapp)")
    .addHelpText(
      "after",
      `
Four things can be true of one directory and they are not four rungs of a ladder:
a package installs resources, an Agent Skill is a manual an agent reads, a template
is a directory that is both plus an explicit opt-in, and an AirApp is a node type
that ships inside a package. Each applicable layer is reported separately.

A layer that does not apply reports "-", never a tick: "not applicable" and "passed"
must not look the same.

This checks one directory. Whether a repository's catalog file is current is a
different question, answered by \`busabase-cli index --check\`.

Examples:
  busabase-cli check .
  busabase-cli check . --strict
  busabase-cli check ./templates/busa-email --only airapp`,
    )
    .action(
      runLocalArgAction((dir, opts, config) =>
        runCheck(dir, {
          strict: Boolean(opts.strict),
          as: opts.as as CheckLayer | undefined,
          only: opts.only as CheckLayer | undefined,
          json: config.output === "json",
        }),
      ),
    );

  addGlobalFlags(program.command("index"))
    .description("Build the Template Center catalog from a directory of skills")
    .argument("<dir>", "directory to scan (a checkout of the skills repository)")
    .requiredOption("--repo <owner/repo>", "repository the entries' subdirs are relative to")
    .option("--ref <ref>", "git ref the entries are read at", "main")
    .option("-o, --out <file>", "write the catalog here (default: print it)")
    .option("--check", "exit non-zero if the file on disk is not what would be written")
    .addHelpText(
      "after",
      `
Whether a skill is listed is decided by the same rules that decide how it
installs, so a card can never promise something its install does not do. A skill
that declared itself a template and did not qualify is reported with the reason
rather than silently left out.

Examples:
  busabase-cli index . --repo busabase/skills -o templates.json
  busabase-cli index . --repo busabase/skills -o templates.json --check`,
    )
    .action(
      runLocalArgAction((dir, opts, config) =>
        runIndex({
          dir,
          repo: opts.repo as string,
          ref: (opts.ref as string) || "main",
          out: opts.out as string | undefined,
          check: Boolean(opts.check),
          json: config.output === "json",
        }),
      ),
    );

  addGlobalFlags(program.command("export"))
    .description("Export a node subtree as a Busabase package directory you can push to GitHub")
    .argument("<node-slug-or-id>", "the folder/node to export")
    .requiredOption("-o, --out-dir <dir>", "output directory for the package")
    .option("--name <name>", "package name (default: reuse busabase.json, else the node slug)")
    .option("--dry-run", "list the files that would be written and write nothing")
    .option(
      "--template",
      "export as a template (an installable app): check it against the template rules and write a SKILL.md draft if the folder has no Skill node yet",
    )
    .addHelpText(
      "after",
      `
Output is deterministic: exporting twice from an unchanged space produces
byte-identical files, so a GitHub diff shows exactly what changed.

Examples:
  busabase-cli export support-kb -o ./support-kb-template
  busabase-cli export support-kb -o ./support-kb-template --name "Support KB" --dry-run
  busabase-cli export kelly-email -o ./kelly-email --template

--template makes the result installable as an APP rather than as a pile of
tables: the folder's Skill node is lifted to the package root as SKILL.md (or a
draft is written from the folder's structure for you to fill in), and anything
still missing is reported. The same directory then works both as an Agent Skill
and as something \`busabase-cli install\` can install.`,
    )
    .action(
      runArgAction(state, (nodeSlugOrId, client, opts, config) =>
        runExport(client, nodeSlugOrId, {
          outDir: opts.outDir as string,
          name: opts.name as string | undefined,
          dryRun: Boolean(opts.dryRun),
          template: Boolean(opts.template),
          json: config.output === "json",
          baseUrl: config.baseUrl,
        }),
      ),
    );

  addGlobalFlags(program.command("backup"))
    .description("Back up the active space to a full-fidelity .bbdump archive")
    .option("-o, --out-file <file>", "output archive path", "space.bbdump")
    .option(
      "--no-history",
      "drop finished change requests, reviews, comments and audit events (unfinished work is kept)",
    )
    .option("--state-only", "superseded by `busabase-cli export` — see the error text")
    .option(
      "--resume",
      "continue an interrupted backup, reusing the attachment bytes it already downloaded",
    )
    .addHelpText(
      "after",
      `
A backup is full fidelity: raw rows with their original ids, every doc body, and
every attachment's bytes, in one integrity-checked archive. Vault items and
webhook signing secrets are never written to it.

Examples:
  busabase-cli backup                                        # → ./space.bbdump
  busabase-cli backup -o ./backups/acme-2026-07-19.bbdump
  busabase-cli backup --no-history                           # current state + unfinished work

\`--no-history\` still restores completely: every record, field value, file and
permission is there. What it leaves out is the paper trail — change requests
that are already finished, their reviews and comments, and the audit log of who
did what when. Change requests still in review (or approved but unmerged) are
KEPT, because those are unfinished work rather than history.

To hand content to someone else rather than back it up, use \`busabase-cli export\`,
which writes a readable, diffable package directory you can push to GitHub.`,
    )
    .action(
      runAction(state, (client, opts, config) =>
        runBackup(client, {
          outFile: opts.outFile as string,
          includeHistory: opts.history !== false,
          resume: Boolean(opts.resume),
          stateOnly: Boolean(opts.stateOnly),
          json: config.output === "json",
          baseUrl: config.baseUrl,
          spaceId: config.spaceId,
          retries: config.retries,
          toolVersion: pkgVersion(),
        }),
      ),
    );

  addGlobalFlags(program.command("restore"))
    .description("Restore a .bbdump archive into an EMPTY space, preserving original ids")
    .argument("<file>", "path to the .bbdump archive")
    .option(
      "--resume",
      "continue a restore whose process was killed partway through (same archive, same space)",
    )
    .option("--into-folder <name>", "state-only archives only — see the error text")
    .addHelpText(
      "after",
      `
The archive's checksum is verified before a single row is written, and the target
space must be EMPTY — a restore replays original ids, so it cannot merge into a
space that already holds content. Those ids are also unique across the whole
database, not just the target space: restore only into a database where the
archive's ids have never been used before (disaster recovery into a fresh
database, or back into the space it came from after that space's own data was
removed). Restoring into a different space while the SOURCE space is still live
in the same database will fail — its rows already hold those ids.

Examples:
  busabase-cli restore ./space.bbdump
  busabase-cli restore ./backups/acme-2026-07-19.bbdump --space-id spc_123

To add content to a space that is already in use, use \`busabase-cli install\` instead.
To copy a still-live space's current content into another space, use
\`busabase-cli export\` + \`busabase-cli install\` instead of backup/restore.`,
    )
    .option("--dry-run", "print the request this would send and send nothing")
    .action(
      runArgAction(state, (file, client, opts, config) =>
        runRestore(client, {
          file,
          resume: Boolean(opts.resume),
          intoFolder: opts.intoFolder as string | undefined,
          json: config.output === "json",
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
    .option("--dry-run", "print the request this would send and send nothing")
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

  // `docs list|get`, `files list|get`, `folders list|get` — the names people
  // already type, kept alive on top of the unified Node surface.
  //
  // `GET /docs`, `/files`, `/folders` and their `/{nodeId}` gets are retired, so
  // without these the three commands would simply vanish from the CLI. Each one
  // is still exactly ONE request — `/nodes?types=<type>` or `/nodes/{nodeId}` —
  // and nothing here fans out a request per row to reconstruct the old payload.
  //
  // `get` returns what it always did (plus the `type` discriminator the union
  // carries). `list` is the honest part of the change: it prints lightweight
  // summaries, because the retired lists hydrated every row (a full Doc body
  // each, a resolved Asset each, a children query per folder) and that is the
  // cost the consolidation removed. The description says so, so a reader learns
  // it from `--help` instead of from a missing field at runtime.
  for (const facade of [
    {
      group: "docs",
      type: "doc" as const,
      label: "Doc",
      detail: "body included",
      omitted: "no bodies",
    },
    {
      group: "files",
      type: "file" as const,
      label: "File",
      detail: "backing Asset included",
      omitted: "no Asset detail",
    },
    {
      group: "folders",
      type: "folder" as const,
      label: "Folder",
      detail: "direct children included",
      omitted: "no children",
    },
  ]) {
    const group =
      program.commands.find((c) => c.name() === facade.group) ??
      program.command(facade.group).description(`${facade.label} nodes`);
    addGlobalFlags(group.command("list"))
      .description(`List ${facade.label} nodes — summaries only (${facade.omitted})`)
      .addHelpText(
        "after",
        `\nOpenAPI: GET /nodes?types=${facade.type}\n  Follow up with \`${facade.group} get --node-id <id>\` for one node's full detail.`,
      )
      .action(runAction(state, (client) => client.nodes.list({ types: [facade.type] })));
    addGlobalFlags(group.command("get"))
      .description(`Get one ${facade.label} node (${facade.detail})`)
      .requiredOption("--node-id <id>", `${facade.label} node id, or a slug unique to this type`)
      .addHelpText("after", `\nOpenAPI: GET /nodes/{nodeId}?type=${facade.type}`)
      .action(
        runAction(state, (client, opts) =>
          client.nodes.get({ nodeId: opts.nodeId as string, type: facade.type }),
        ),
      );
  }

  // Shared task definitions (`busabase-contract/tasks`) — the same source the MCP
  // servers build their tools from. Runs after the curated commands above (so a
  // hand-written command still wins a name collision) and before the generated
  // fallback (so a task always beats the raw endpoint command).
  registerTaskCommands(program, BUSABASE_TASKS, {
    addGlobalFlags,
    parseFieldSpecs,
    parseJsonValue,
    runAction: (handler) => runAction(state, (client, opts) => handler(client, opts)),
  });

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
  program.addHelpText(
    "after",
    () => `\n${commandsSection(program, showAllCommands)}\n${HELP_FOOTER}`,
  );
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
  if (argv.includes("--help-all")) {
    console.log(renderedHelp({ showAll: true }));
    return 0;
  }
  try {
    await program.parseAsync(argv, { from: "user" });
    // A command that ran fine but reached a failing verdict says so through
    // `process.exitCode` rather than by throwing. `check` reporting findings is not an
    // error — throwing would route it through the error envelope and, under `--json`,
    // put a second JSON document on stdout after the findings CI came for.
    return typeof process.exitCode === "number" ? process.exitCode : 0;
  } catch (error) {
    const json = errorOutputIsJson(state, argv);
    if (error instanceof CommanderError) {
      // commander already wrote the help text or usage error to the right stream.
      if (error.exitCode === 0) return 0;
      if (json) {
        console.log(
          JSON.stringify(
            { ok: false, code: "USAGE", message: error.message, retryable: false },
            null,
            2,
          ),
        );
      }
      return EXIT_CODES.USAGE;
    }
    const classified = classifyError(error);
    // Auth failures additionally carry an agent-facing `hint`: the exact
    // recovery command for THIS connection (base URL + profile pre-filled), so
    // an agent hitting a 401 mid-task recovers without reverse-engineering the
    // stderr prose. See content/spec/cli-first-login-ux.md in apps/busabase.
    if (classified.code === "UNAUTHORIZED" || classified.code === "FORBIDDEN") {
      const hintConfig = state.config ?? resolveConfig({});
      const profile = isMultiProfile() ? activeCredentialTarget().profile : undefined;
      // The command's own contract id when it has one; otherwise resolve the last
      // request off the wire, which is the only way to name the endpoint behind a
      // curated task command (it may legitimately call several).
      const procedureId =
        state.procedureId ??
        (state.lastRequest
          ? matchRoute(state.lastRequest.method, state.lastRequest.pathname)?.id
          : undefined);
      classified.hint = authRecoveryHint(classified.code, hintConfig.baseUrl, profile, {
        procedureId,
        ...(procedureId ? requiredLevelFor(procedureId) : {}),
      });
    }
    // The envelope goes to stdout because that is where a caller parsing
    // `--output json` already reads from; the prose still goes to stderr, so a
    // human sees exactly what they saw before and a pipeline sees neither twice.
    if (json) console.log(JSON.stringify(errorEnvelope(classified), null, 2));
    console.error(explainError(error, state.config ?? resolveConfig({})));
    return classified.exitCode;
  }
}

/**
 * Whether a failed run should print the machine-readable envelope.
 *
 * `state.config` is set by the first command that resolves one, but a failure
 * can happen before that (an unknown option, a bad `--config` path), so the raw
 * argv is the fallback. Both spellings commander accepts are checked.
 */
function errorOutputIsJson(state: CliState, argv: string[]): boolean {
  if (state.config) return state.config.output === "json";
  const flag = argv.indexOf("--output");
  if (flag !== -1 && argv[flag + 1] === "json") return true;
  if (argv.includes("--output=json")) return true;
  return configuredOutput() === "json";
}

function renderedHelp({ showAll = false }: { showAll?: boolean } = {}): string {
  let out = "";
  showAllCommands = showAll;
  const program = buildProgram();
  program.configureOutput({
    writeOut: (str) => {
      out += str;
    },
    writeErr: () => {},
  });
  program.outputHelp();
  showAllCommands = false;
  return out;
}

/** Full root help text (what `busabase-cli --help` prints). Generated from the command tree. */
export const HELP = renderedHelp();

/**
 * Root help INCLUDING the endpoint commands a task command supersedes — what
 * `--help-all` prints. Hidden means hidden from the index, not gone: they all
 * still run, which is what this lets the surface-coverage tests assert.
 */
export const HELP_ALL = renderedHelp({ showAll: true });

/**
 * Turn a low-level transport/HTTP error into an actionable message: which host was tried, the
 * concrete next step (set a key for Cloud, point at a local server, or check connectivity), and a
 * link to the troubleshooting docs.
 */
export function explainError(error: unknown, config: ResolvedConfig): string {
  const base = config.baseUrl;
  const rawMessage = error instanceof Error ? error.message : String(error);
  // A thrown ORPCError carries its validation detail on `.data.issues`, which the
  // raw-fetch path already renders. Do it here too — otherwise a schema refusal
  // reaches the user as the bare envelope ("Input validation failed") and the
  // reason it went to the trouble of explaining is dropped on the floor.
  const issueDetail = formatIssues((error as { data?: { issues?: unknown } }).data?.issues);
  // The server already folds the issue detail into `message` for a schema refusal
  // ("Input validation failed — limit: Too big…"), so appending unconditionally
  // printed the same sentence twice.
  const msg =
    issueDetail && !rawMessage.includes(issueDetail)
      ? `${rawMessage} — ${issueDetail}`
      : rawMessage;
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
