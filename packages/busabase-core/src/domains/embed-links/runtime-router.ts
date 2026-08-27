import "server-only";

import { ORPCError, os } from "@orpc/server";
import { resolveRequiredLevel } from "busabase-contract/access-control/api-key-level";
import { FILE_TREE_NODE_TYPES } from "busabase-contract/domains/filetree/contract";
import { busabaseRouter } from "../../router";

const READABLE_PROCEDURES = new Set([
  "search",
  "nodes.list",
  // The unified typed-detail read. It replaced `docs.get` / `files.get` /
  // `folders.get` / `fileTrees.get`, which means it also absorbed the AirApp
  // boundary those four used to draw by namespace — see
  // `isAirAppEmbedReadableInput` below.
  "nodes.get",
  "nodes.searchByName",
  "nodes.isDescendant",
  "bases.list",
  "bases.get",
  "bases.listViews",
  "records.list",
  "records.count",
  "records.get",
  "records.search",
  "records.listLinks",
  // Renamed from `docs.readLines`: it now serves every content-bearing node
  // type (doc/html/whiteboard/workflow), not just Docs.
  "nodes.readLines",
  // Skills, Drives, and AirApps all read their FILES through the one
  // `/file-trees` surface.
  "fileTrees.listFiles",
  "fileTrees.readFile",
  "assets.list",
  "assets.get",
  "assets.download",
  "assets.readTextLines",
]);

/**
 * The three file-tree node types, as a plain `Set<string>` — the input reaching
 * `isAirAppEmbedReadableInput` is UNVALIDATED (this middleware runs before the
 * contract's zod parse), so it must be testable against an arbitrary string
 * rather than the contract's narrowed literal union.
 */
const FILE_TREE_TYPES = new Set<string>(FILE_TREE_NODE_TYPES);

/** Node types an embed runtime may address by id/slug through `nodes.get`. */
const EMBED_READABLE_NODE_TYPES = new Set<string>(["skill", "drive"]);

export const isAirAppEmbedReadableProcedure = (
  path: readonly string[],
  routeMethod: string | undefined,
): boolean => {
  const normalized = path[0] === "core" ? path.slice(1) : [...path];
  return (
    READABLE_PROCEDURES.has(normalized.join(".")) &&
    routeMethod === "GET" &&
    resolveRequiredLevel(normalized, routeMethod) === "read"
  );
};

/**
 * An embed runtime may read Skills and Drives but NOT AirApps — an embedded
 * AirApp must not be able to read another AirApp's source. That used to be
 * expressed by the namespace itself (`airapps.*` was dropped from the router
 * while `skills.*` / `drives.*` were allowed). Once all three shared
 * `/file-trees`, the boundary moved onto the `type` discriminator; now that
 * `fileTrees.get` has been folded into `nodes.get`, the SAME rule has to cover
 * the unified route as well, or an embed could reach an AirApp's file list
 * through `GET /nodes/{nodeId}` instead.
 *
 * Both surfaces are handled with one predicate because they are one decision:
 * "which file-tree kinds may this embed address by id?" `type` is optional on
 * both, and an omitted `type` is refused rather than resolved — this runs
 * before the handler, so there is nothing here that could tell an AirApp id
 * from a Skill id, and guessing would be guessing on the permissive side.
 */
export const isAirAppEmbedReadableInput = (path: readonly string[], input: unknown): boolean => {
  const normalized = path[0] === "core" ? path.slice(1) : [...path];
  const isFileTreeRoute = normalized[0] === "fileTrees";
  const isNodeDetailRoute = normalized[0] === "nodes" && normalized[1] === "get";
  // `nodes.list` — including `nodes.list({ types: ["airapp"] })` — is not gated:
  // it has always returned every visible node row, AirApps included. What an
  // embed must not reach is an AirApp's file inventory or file contents, and
  // that lives behind `nodes.get` / `fileTrees.*`, which are gated below.
  if (!isFileTreeRoute && !isNodeDetailRoute) return true;

  const type = (input as { type?: unknown } | undefined)?.type;
  if (isNodeDetailRoute) {
    // `nodes.get` serves every node type, so an embed's other legitimate reads
    // (a Doc, a folder, a Base node) must keep working — only the file-tree
    // types are gated, and an AirApp is refused outright. A node-addressed read
    // with NO type hint can't be pre-checked, so it is refused too: an
    // un-hinted id could resolve to an AirApp.
    if (typeof type !== "string") return false;
    if (!FILE_TREE_TYPES.has(type)) return true;
    return EMBED_READABLE_NODE_TYPES.has(type);
  }
  // `fileTrees.*` is file-tree-only by construction: `listFiles` / `readFile`
  // without a type could span AirApps too, so they need an explicit allowed kind.
  return type === "skill" || type === "drive";
};

const readOnlyProcedure = os.use(async ({ path, procedure, next }, input) => {
  const method = procedure["~orpc"].route?.method;
  if (!isAirAppEmbedReadableProcedure(path, method)) {
    throw new ORPCError("FORBIDDEN", { message: "Embed runtimes have read-only data access" });
  }
  if (!isAirAppEmbedReadableInput(path, input)) {
    throw new ORPCError("FORBIDDEN", {
      message: 'Embed runtimes may only read file trees of type "skill" or "drive"',
    });
  }
  return next();
});

const {
  airapps: _airapps,
  auth: _auth,
  vault: _vault,
  webhooks: _webhooks,
  dump: _dump,
  changeRequests: _changeRequests,
  operations: _operations,
  ...airAppEmbedDataRouter
} = readOnlyProcedure.router(busabaseRouter);

export { airAppEmbedDataRouter };
