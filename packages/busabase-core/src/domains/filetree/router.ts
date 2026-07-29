import { implement } from "@orpc/server";
import { busabaseContract } from "busabase-contract/contract/busabase";
import {
  createFileTreeChangeRequest,
  createFileTreeNode,
  listFileTreeFiles,
  listFileTreeKinds,
  readFileTreeFile,
  resolveFileTreeKind,
} from "./handlers";
// Registers skill/drive/airapp as file-tree kinds (side-effect import).
import "./kinds";

// File-tree domain oRPC handler slice; aggregated into the kernel router (router.ts).
//
// `list` and `get` are gone: `GET /file-trees` and `GET /file-trees/{nodeId}`
// were folded into the unified Node surface (`nodes.list({ types })` /
// `nodes.get`). The underlying `listFileTreeNodes` / `getFileTreeNode` logic is
// unchanged and still called — by the Node detail dispatcher and by the kind
// facades in domains/skill|drive|airapp.
const os = implement(busabaseContract);

export const fileTreeRouter = {
  create: os.fileTrees.create.handler(async ({ input }) => {
    const { type, ...rest } = input;
    return createFileTreeNode(resolveKindByType(type), rest);
  }),
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
