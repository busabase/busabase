import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { CreatableNodeType } from "busabase-contract/domains";
import { banner } from "./banner.js";
import {
  type BusabaseClient,
  createBusabaseClient,
  DEFAULT_BASE_URL,
  normalizeBaseUrl,
  type ResolvedConfig,
} from "./client.js";
import { render } from "./format.js";

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

export const HELP = `busabase-cli — client for the Busabase OpenAPI REST API

Usage:
  busabase-cli [global flags] <command> [flags]

Global flags:
  --base-url <url>     Server base URL (env BUSABASE_BASE_URL, default ${DEFAULT_BASE_URL})
  --api-key <token>    Bearer token for cloud hosts (env BUSABASE_API_KEY)
  --output <fmt>       table | json (default table)
  -h, --help           Show this help

Config is read from flags, then env vars, then ~/.busabase/.env (auto-loaded — no
need to source it). An exported env var overrides the file.

Commands:
  health                                   Server health check (GET /api/health)
  openapi                                  Fetch the OpenAPI document
  whoami                                   Active space, user, and membership

  nodes list                               Workspace node tree
  nodes create-draft --type <folder|base|skill|doc> --slug <s> --name <n>
               [--description <d>] [--parent-node-id <id>] [--message <m>] [--submitted-by <a>]
               [--field <slug:name:type> ...]  (fields are for --type base)

  bases list                               List Bases
  bases get --slug <slug>                  Get one Base by slug
  bases create --slug <s> --name <n> [--description <d>] [--parent-node-id <id>]
               --field <slug:name:type> [--field ...]
  bases create-field --base-id <id> --slug <s> --name <n> [--field-type <t>] [--required]
  bases create-draft --base-id <id> --fields-json <json> [--message <m>] [--submitted-by <a>]

  records list [--limit <n>]               List records
  records get --record-id <id>             Get one record
  records by-field-text --field-slug <s> --value-text <t> [--base-id <id>] [--limit <n>]
  records drafts --record-id <id>          Change requests for a record

  drafts list [--limit <n>]                List change requests
  drafts get --draft-id <id>               Get a change request
  drafts review --draft-id <id> --verdict <approved|rejected> [--reason <r>]
                                            rejected = request changes, not terminal
  drafts close --draft-id <id> [--reason <r>]  Terminally abandon/reject a draft
  drafts merge --draft-id <id>             Merge a change request into its Base

  search --query <q> [--limit <n>] [--offset <n>]

  api --method <get|post|put|delete> --path <p> [--query k=v ...] [--body-json <json>]

Docs: https://busabase.com/docs · Troubleshooting: https://busabase.com/docs/troubleshooting
`;

// The field `type` arrives as a free-form CLI string; the typed contract narrows it
// to the field-type union. Server-side zod re-validates, so narrow with a cast here.
type FieldType = NonNullable<
  Parameters<BusabaseClient["bases"]["create"]>[0]["fields"]
>[number]["type"];

interface Flags {
  positionals: string[];
  get(name: string): string | undefined;
  getAll(name: string): string[];
  has(name: string): boolean;
  num(name: string): number | undefined;
}

function parse(argv: string[]): Flags {
  const positionals: string[] = [];
  const values = new Map<string, string[]>();
  const bools = new Set<string>();
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (token.startsWith("--")) {
      const name = token.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith("--")) {
        values.set(name, [...(values.get(name) ?? []), next]);
        i++;
      } else {
        bools.add(name);
      }
    } else if (token === "-h") {
      bools.add("help");
    } else {
      positionals.push(token);
    }
  }
  return {
    positionals,
    get: (name) => values.get(name)?.at(-1),
    getAll: (name) => values.get(name) ?? [],
    has: (name) => bools.has(name) || values.has(name),
    num: (name) => {
      const raw = values.get(name)?.at(-1);
      return raw === undefined ? undefined : Number(raw);
    },
  };
}

function resolveConfig(flags: Flags): ResolvedConfig {
  const outputRaw = flags.get("output") ?? "table";
  if (outputRaw !== "table" && outputRaw !== "json") {
    throw new Error(`--output must be "table" or "json", got "${outputRaw}"`);
  }
  // Precedence: explicit flag > exported env var > ~/.busabase/.env file > default. Reading the
  // file directly means `busabase-cli` works straight after onboarding without a manual `source`,
  // while an exported env var still overrides the file.
  const file = loadDotEnvFile();
  return {
    baseUrl:
      flags.get("base-url") ??
      process.env.BUSABASE_BASE_URL ??
      file.BUSABASE_BASE_URL ??
      DEFAULT_BASE_URL,
    apiKey: flags.get("api-key") ?? process.env.BUSABASE_API_KEY ?? file.BUSABASE_API_KEY,
    output: outputRaw,
  };
}

function required(flags: Flags, name: string): string {
  const value = flags.get(name);
  if (value === undefined) throw new Error(`missing required flag --${name}`);
  return value;
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

// Flat command dispatch table — clearer than nested per-group handlers.
async function dispatch(
  command: string,
  sub: string | undefined,
  flags: Flags,
  config: ResolvedConfig,
  client: BusabaseClient,
): Promise<unknown> {
  switch (command) {
    case "health":
      return rawFetch(config, "GET", "/api/health");
    case "openapi":
      return rawFetch(config, "GET", "/api/v1/openapi.json");
    case "whoami":
      return client.auth.verify();
    case "search":
      return client.search({
        query: required(flags, "query"),
        limit: flags.num("limit"),
        offset: flags.num("offset"),
      });
    case "api": {
      const query = new URLSearchParams();
      for (const pair of flags.getAll("query")) {
        const [key, ...rest] = pair.split("=");
        query.set(key, rest.join("="));
      }
      const qs = query.toString();
      const path = `/api/v1${required(flags, "path")}${qs ? `?${qs}` : ""}`;
      const bodyJson = flags.get("body-json");
      return rawFetch(
        config,
        required(flags, "method"),
        path,
        bodyJson ? JSON.parse(bodyJson) : undefined,
      );
    }
    case "nodes":
      if (sub === "list") return client.nodes.list();
      if (sub === "create-draft") {
        const nodeType = required(flags, "type") as CreatableNodeType;
        const name = required(flags, "name");
        return client.nodes.createChangeRequest({
          message: flags.get("message") ?? `Create ${nodeType} ${name}`,
          submittedBy: flags.get("submitted-by"),
          operations: [
            {
              kind: "create",
              nodeType,
              slug: required(flags, "slug"),
              name,
              description: flags.get("description"),
              parentNodeId: flags.get("parent-node-id"),
              ...(nodeType === "base"
                ? {
                    fields: flags.getAll("field").map((spec) => {
                      const [fieldSlug, name, type] = spec.split(":");
                      return {
                        slug: fieldSlug,
                        name: name ?? fieldSlug,
                        ...(type ? { type: type as FieldType } : {}),
                      };
                    }),
                  }
                : {}),
            },
          ],
        });
      }
      break;
    case "bases":
      switch (sub) {
        case "list":
          return client.bases.list();
        case "get": {
          const slug = required(flags, "slug");
          const found = (await client.bases.list()).find((b) => b.slug === slug);
          if (!found) throw new Error(`no Base with slug "${slug}"`);
          return found;
        }
        case "create":
          return client.bases.create({
            slug: required(flags, "slug"),
            name: required(flags, "name"),
            description: flags.get("description"),
            parentNodeId: flags.get("parent-node-id"),
            fields: flags.getAll("field").map((spec) => {
              const [fieldSlug, name, type] = spec.split(":");
              return {
                slug: fieldSlug,
                name: name ?? fieldSlug,
                ...(type ? { type: type as FieldType } : {}),
              };
            }),
          });
        case "create-field":
          return client.bases.createField({
            baseId: required(flags, "base-id"),
            slug: required(flags, "slug"),
            name: required(flags, "name"),
            ...(flags.get("field-type") ? { type: flags.get("field-type") as FieldType } : {}),
            required: flags.has("required"),
          });
        case "create-draft":
          return client.bases.createChangeRequest({
            baseId: required(flags, "base-id"),
            fields: JSON.parse(required(flags, "fields-json")),
            message: flags.get("message"),
            submittedBy: flags.get("submitted-by"),
          });
      }
      break;
    case "records":
      switch (sub) {
        case "list":
          return client.records.list({ limit: flags.num("limit") });
        case "get":
          return client.records.get({ recordId: required(flags, "record-id") });
        case "by-field-text":
          return client.records.search({
            fieldSlug: required(flags, "field-slug"),
            valueText: required(flags, "value-text"),
            baseId: flags.get("base-id"),
            limit: flags.num("limit"),
          });
        case "drafts":
          return client.records.listChangeRequests({ recordId: required(flags, "record-id") });
      }
      break;
    case "drafts":
      switch (sub) {
        case "list":
          return client.changeRequests.list({ limit: flags.num("limit") });
        case "get":
          return client.changeRequests.get({ changeRequestId: required(flags, "draft-id") });
        case "review": {
          const verdict = required(flags, "verdict");
          if (verdict !== "approved" && verdict !== "rejected") {
            throw new Error(`--verdict must be "approved" or "rejected"`);
          }
          return client.changeRequests.review({
            changeRequestId: required(flags, "draft-id"),
            verdict,
            reason: flags.get("reason"),
          });
        }
        case "merge":
          return client.changeRequests.merge({ changeRequestId: required(flags, "draft-id") });
        case "close":
          return client.changeRequests.close({
            changeRequestId: required(flags, "draft-id"),
            reason: flags.get("reason"),
          });
      }
      break;
  }
  throw new Error(`unknown command: ${[command, sub].filter(Boolean).join(" ")}\n\n${HELP}`);
}

/**
 * Run the client CLI. Returns a process exit code (0 ok, 1 error). Reused by the
 * `busabase` bin, which delegates every non-`server` command here.
 */
export async function runCli(argv: string[]): Promise<number> {
  const flags = parse(argv);
  if (flags.has("help") || flags.positionals.length === 0) {
    const baseUrl = flags.get("base-url") ?? process.env.BUSABASE_API_BASE_URL ?? DEFAULT_BASE_URL;
    console.log(`${banner(baseUrl)}\n${HELP}`);
    return 0;
  }
  let config: ResolvedConfig;
  try {
    config = resolveConfig(flags);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  }
  try {
    const [command, sub] = flags.positionals;
    const client = createBusabaseClient(config);
    const result = await dispatch(command, sub, flags, config, client);
    console.log(render(result, config.output));
    return 0;
  } catch (error) {
    console.error(explainError(error, config));
    return 1;
  }
}

/** Public docs page covering every error below, for both Cloud and local. Linked from each error. */
const DOCS_TROUBLESHOOTING = "https://busabase.com/docs/troubleshooting";

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
