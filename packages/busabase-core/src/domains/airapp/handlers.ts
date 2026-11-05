import "server-only";

import type {
  createAirAppChangeRequestInputSchema,
  createAirAppInputSchema,
} from "busabase-contract/domains/airapp/contract";
import type { AirAppVO, ChangeRequestVO } from "busabase-contract/types";
import type { z } from "zod";
import { registerMaterializer } from "../../logic/materialize";
import {
  createFileTreeChangeRequest,
  createFileTreeNode,
  type FileTreeKindConfig,
  getFileTreeNode,
  listFileTreeFiles,
  listFileTreeNodes,
  makeMaterializer,
  readFileTreeFile,
} from "../filetree/handlers";
import { createAirAppStarterFiles } from "./utils/starter-files";

/**
 * File-tree kind config for the "airapp" node type — mirrors drive/skill's
 * `*FileTreeConfig` shape, but the seed files produce a working minimal
 * Hono HTTP server + static HTML/CSS/JS project instead of a doc/README:
 * `npm install && npm run dev` works immediately after node creation, no
 * extra setup. Its explicit site declaration publishes the same public assets.
 */
export const airappFileTreeConfig = {
  type: "airapp",
  label: "AirApp",
  entryFile: "package.json",
  seedFiles: createAirAppStarterFiles,
} satisfies FileTreeKindConfig;

export const createAirApp = (input: z.input<typeof createAirAppInputSchema>) =>
  createFileTreeNode(airappFileTreeConfig, input) as Promise<
    (AirAppVO & { materialized: true }) | (ChangeRequestVO & { materialized: false })
  >;

export const getAirApp = (nodeIdOrSlug: string): Promise<AirAppVO> =>
  getFileTreeNode(airappFileTreeConfig, nodeIdOrSlug) as Promise<AirAppVO>;

export const listAirApps = () => listFileTreeNodes(airappFileTreeConfig) as Promise<AirAppVO[]>;

export const listAirAppFiles = (nodeIdOrSlug: string) =>
  listFileTreeFiles(airappFileTreeConfig, nodeIdOrSlug);

export const readAirAppFile = (nodeIdOrSlug: string, filePath: string) =>
  readFileTreeFile(airappFileTreeConfig, nodeIdOrSlug, filePath);

export const createAirAppChangeRequest = (
  nodeIdOrSlug: string,
  input: z.input<typeof createAirAppChangeRequestInputSchema>,
) => createFileTreeChangeRequest(airappFileTreeConfig, nodeIdOrSlug, input);

// Built on first use, not at module evaluation: `makeMaterializer` comes from
// filetree/handlers, and calling it here would make this module's evaluation
// order relative to that one load-bearing (see logic/materialize.ts).
let materializeAirAppNodeImpl: ReturnType<typeof makeMaterializer> | undefined;
export const materializeAirAppNode: ReturnType<typeof makeMaterializer> = (ctx, args) => {
  if (!materializeAirAppNodeImpl) {
    materializeAirAppNodeImpl = makeMaterializer(airappFileTreeConfig);
  }
  return materializeAirAppNodeImpl(ctx, args);
};

registerMaterializer("airapp", materializeAirAppNode);
