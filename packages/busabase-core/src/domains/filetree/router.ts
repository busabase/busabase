import { implement } from "@orpc/server";
import { busabaseContract } from "busabase-contract/contract/busabase";
import { airappFileTreeConfig } from "../airapp/handlers";
import { driveFileTreeConfig } from "../drive/logic/config";
import { skillFileTreeConfig } from "../skill/handlers";
import {
  createFileTreeChangeRequest,
  createFileTreeNode,
  getFileTreeNode,
  listFileTreeFiles,
  listFileTreeKinds,
  listFileTreeNodes,
  readFileTreeFile,
  registerFileTreeKind,
  resolveFileTreeKind,
} from "./handlers";

// The kinds served by `/file-trees`. Registered here rather than as an import
// side effect in each kind module so the set is readable in one place.
registerFileTreeKind(skillFileTreeConfig);
registerFileTreeKind(driveFileTreeConfig);
registerFileTreeKind(airappFileTreeConfig);

// File-tree domain oRPC handler slice; aggregated into the kernel router (router.ts).
const os = implement(busabaseContract);

export const fileTreeRouter = {
  list: os.fileTrees.list.handler(async ({ input }) => {
    const kinds = input.type ? [resolveKindByType(input.type)] : listFileTreeKinds();
    const perKind = await Promise.all(kinds.map((config) => listFileTreeNodes(config)));
    return perKind.flat();
  }),
  create: os.fileTrees.create.handler(async ({ input }) => {
    const { type, ...rest } = input;
    return createFileTreeNode(resolveKindByType(type), rest);
  }),
  get: os.fileTrees.get.handler(async ({ input }) =>
    getFileTreeNode(await resolveFileTreeKind(input.nodeId, input.type), input.nodeId),
  ),
  listFiles: os.fileTrees.listFiles.handler(async ({ input }) =>
    listFileTreeFiles(await resolveFileTreeKind(input.nodeId, input.type), input.nodeId),
  ),
  readFile: os.fileTrees.readFile.handler(async ({ input }) =>
    readFileTreeFile(
      await resolveFileTreeKind(input.nodeId, input.type),
      input.nodeId,
      input.filePath,
    ),
  ),
  createChangeRequest: os.fileTrees.createChangeRequest.handler(async ({ input }) => {
    const { nodeId, type, ...rest } = input;
    return createFileTreeChangeRequest(await resolveFileTreeKind(nodeId, type), nodeId, rest);
  }),
};

/** `type` came through the contract's enum, so the kind is guaranteed registered. */
const resolveKindByType = (type: string) => {
  const config = listFileTreeKinds().find((kind) => kind.type === type);
  if (!config) throw new Error(`Unregistered file-tree kind: ${type}`);
  return config;
};
