import {
  type ApiKeyPermissionLevel,
  PROCEDURE_PERMISSION_POLICY,
  resolveRequiredLevel,
} from "busabase-contract/access-control/api-key-level";
import { z } from "zod";
import { type CatalogEntry, contractProcedures, generatedCommandPath } from "./contract-catalog.js";
import { CliOutcomeError } from "./errors.js";

/**
 * `busabase-cli schema [endpoint]` — read one endpoint's exact input/output shape.
 *
 * The alternative is `busabase-cli openapi`, which is the whole document: measured
 * against production on 2026-09-04 it is **936 KB across 103 endpoints with zero
 * shared component schemas** (every type is inlined per endpoint), so an agent that
 * needs one endpoint's arguments pays ~234k tokens to read them. One endpoint is
 * ~10 KB with both halves, and far less with `--io input`.
 *
 * It is also offline: the contract is compiled into this CLI, so `schema` answers
 * without a network round trip and without a credential — which is the difference
 * between "I can look this up" and "I have to be signed in to find out what to send".
 */

export interface SchemaEndpoint {
  id: string;
  method: string;
  path: string;
  summary?: string;
  description?: string;
  command: string;
  /** Minimum API-key permission level this endpoint requires. */
  requiredLevel: ApiKeyPermissionLevel;
  input?: unknown;
  output?: unknown;
}

/**
 * The level an endpoint needs, from the contract's own policy table — the same
 * table the server enforces with, so this can never disagree with a real 403.
 *
 * A handful of endpoints have no explicit entry and the policy fails closed to
 * `manage`. That is the right answer for the gate, but a *guess* as far as advice
 * goes, so callers that phrase it for a human should know which it is.
 */
export function requiredLevelFor(id: string): {
  level: ApiKeyPermissionLevel;
  declared: boolean;
} {
  return {
    level: resolveRequiredLevel(id.split("."), undefined),
    declared: id in PROCEDURE_PERMISSION_POLICY,
  };
}

/** Zod → JSON Schema. `io` matters: defaults/coercion make input and output differ. */
function toJsonSchema(schema: unknown, io: "input" | "output"): unknown | undefined {
  if (schema === undefined) return undefined;
  try {
    return z.toJSONSchema(schema as z.ZodType, { io, unrepresentable: "any" });
  } catch {
    // A schema JSON Schema cannot express (a transform, a custom type) is not a
    // reason to fail the lookup — the route and the other half still help.
    return undefined;
  }
}

const describe = (entry: CatalogEntry): Omit<SchemaEndpoint, "input" | "output"> => {
  const { route } = entry.proc["~orpc"];
  return {
    id: entry.id,
    method: route.method,
    path: route.path,
    ...(route.summary ? { summary: route.summary } : {}),
    ...(route.successDescription ? { description: route.successDescription } : {}),
    command: `busabase-cli ${generatedCommandPath(entry.navPath, entry.key).join(" ")}`,
    requiredLevel: requiredLevelFor(entry.id).level,
  };
};

/** Every endpoint the contract carries, in contract order. */
export function listEndpoints(): Array<Omit<SchemaEndpoint, "input" | "output">> {
  return [...contractProcedures()].map(describe);
}

/**
 * Resolve a user-typed id. Accepts the dotted contract path (`bases.list`), the
 * space-separated form (`bases list`, already joined by the caller), and the
 * kebab spelling the command tree uses (`change-requests.list`), so an agent can
 * paste back whatever it saw without translating.
 */
function findEntry(query: string): CatalogEntry | undefined {
  const normalize = (value: string) =>
    value
      .replace(/[\s/]+/g, ".")
      .replace(/-/g, "")
      .toLowerCase();
  const wanted = normalize(query);
  const entries = [...contractProcedures()];
  return (
    entries.find((entry) => entry.id === query) ??
    entries.find((entry) => normalize(entry.id) === wanted)
  );
}

/** Ids closest to a miss, so the error can suggest instead of just refusing. */
function suggestions(query: string, limit = 5): string[] {
  const needle = query.replace(/[\s./-]+/g, "").toLowerCase();
  if (!needle) return [];
  const scored: Array<{ id: string; score: number }> = [];
  for (const entry of contractProcedures()) {
    const hay = entry.id.replace(/[.-]/g, "").toLowerCase();
    if (hay.includes(needle)) scored.push({ id: entry.id, score: 0 });
    else if (needle.length >= 3 && hay.includes(needle.slice(0, 3)))
      scored.push({ id: entry.id, score: 1 });
  }
  return scored
    .sort((a, b) => a.score - b.score || a.id.length - b.id.length)
    .slice(0, limit)
    .map((s) => s.id);
}

/**
 * A misspelled id is a usage error, not a runtime failure: it exits `2` like any
 * other bad argument, so a script can tell "you typed it wrong" from "the call failed".
 */
export class SchemaNotFoundError extends CliOutcomeError {
  constructor(query: string, near: string[]) {
    super(
      "USAGE",
      near.length
        ? `Unknown endpoint "${query}". Did you mean: ${near.join(", ")}? Run \`busabase-cli schema\` for the full list.`
        : `Unknown endpoint "${query}". Run \`busabase-cli schema\` for the full list.`,
    );
    this.name = "SchemaNotFoundError";
  }
}

/** One endpoint, with the halves the caller asked for. */
export function describeEndpoint(query: string, io?: "input" | "output"): SchemaEndpoint {
  const entry = findEntry(query);
  if (!entry) throw new SchemaNotFoundError(query, suggestions(query));
  const { inputSchema, outputSchema } = entry.proc["~orpc"];
  return {
    ...describe(entry),
    ...(io === "output" ? {} : { input: toJsonSchema(inputSchema, "input") }),
    ...(io === "input" ? {} : { output: toJsonSchema(outputSchema, "output") }),
  };
}

/** Human-readable rendering for a terminal; `--output json` prints the object instead. */
export function renderEndpoint(endpoint: SchemaEndpoint): string {
  const lines = [
    `${endpoint.id}`,
    `  ${endpoint.method} ${endpoint.path}`,
    ...(endpoint.summary ? [`  ${endpoint.summary}`] : []),
    ...(endpoint.description ? [`  ${endpoint.description}`] : []),
    `  command: ${endpoint.command}`,
    `  requires API key level: ${endpoint.requiredLevel}`,
  ];
  if (endpoint.input !== undefined) {
    lines.push("", "input:", JSON.stringify(endpoint.input, null, 2));
  }
  if (endpoint.output !== undefined) {
    lines.push("", "output:", JSON.stringify(endpoint.output, null, 2));
  }
  return lines.join("\n");
}

/** The endpoint index, one line each — the map before you pick a target. */
export function renderList(entries: Array<Omit<SchemaEndpoint, "input" | "output">>): string {
  const width = Math.max(...entries.map((e) => e.id.length));
  return [
    ...entries.map(
      (e) =>
        `${e.id.padEnd(width)}  ${e.method.padEnd(6)} ${e.path}${e.summary ? `  — ${e.summary}` : ""}`,
    ),
    "",
    `${entries.length} endpoints. \`busabase-cli schema <id>\` prints one endpoint's input and output schema.`,
  ].join("\n");
}

/** Exported for the help text, so the example ids can never name a dead endpoint. */
export const sampleEndpointId = (): string =>
  findEntry("bases.list")?.id ?? [...contractProcedures()][0]?.id ?? "bases.list";
