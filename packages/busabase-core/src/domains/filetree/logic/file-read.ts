import "server-only";

import type { NodeType } from "busabase-contract/domains";
import { isAnonymousVisitor } from "../../../context";
import {
  denyAnonymousNodeType,
  isAnonymousReadableNodeType,
} from "../../../logic/anonymous-allowlist";
import { resolveVisibleNode } from "../../../logic/node-resolve";
import { ensureReady } from "../../../logic/seed";
import { getFileTreeKind, readFileTreeFile, resolveFileTreeKind } from "../handlers";

/** Public RPC file reads share nodes.get's resolved-node ACL and type gate. */
export const readVisitorFileTreeFile = async (input: {
  nodeId: string;
  filePath: string;
  type?: NodeType;
}) => {
  // Members and Embed Links keep the existing file-tree resolution/errors.
  if (!isAnonymousVisitor()) {
    return readFileTreeFile(
      await resolveFileTreeKind(input.nodeId, input.type),
      input.nodeId,
      input.filePath,
    );
  }
  await ensureReady();
  const node = await resolveVisibleNode(input.nodeId, input.type ?? ["skill", "drive", "airapp"]);
  if (!isAnonymousReadableNodeType(node.type)) {
    denyAnonymousNodeType(node.type);
  }
  return readFileTreeFile(getFileTreeKind(node.type), node.id, input.filePath);
};
