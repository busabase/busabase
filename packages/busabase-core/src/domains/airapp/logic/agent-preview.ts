import "server-only";

import { ORPCError } from "@orpc/server";
import type { AirAppPreviewStartInput } from "busabase-contract/domains/airapp/contract";
import { assertNodePermission } from "../../../logic/node-acl";
import { ensureReady } from "../../../logic/seed";
import {
  getFileTreeKind,
  listFileTreeFiles,
  readFileTreeFile,
  readFileTreeFileBytes,
} from "../../filetree/handlers";
import { getFileTreeNode } from "../../filetree/logic/storage";
import { resolveRunPlan } from "../utils/airapp-runtime-descriptor";
import { getRunSessionState, startRunSession, stopRunSession } from "./run-session";

/** A runtime operation must never reinterpret another kind of node as executable code. */
const requireAirApp = async (nodeId: string, level: "read" | "write"): Promise<void> => {
  await ensureReady();
  await assertNodePermission(nodeId, level);
  const node = await getFileTreeNode("airapp", nodeId);
  if (!node || node.id !== nodeId) {
    throw new ORPCError("NOT_FOUND", { message: "AirApp not found." });
  }
};

/** Load merged files using their stored encoding, so images/fonts never pass through UTF-8. */
const loadPreviewFiles = async (nodeId: string) => {
  const config = getFileTreeKind("airapp");
  const text: Array<[string, string]> = [];
  const binary: Array<[string, string]> = [];
  let after: string | undefined;
  for (;;) {
    const page = await listFileTreeFiles(config, nodeId, { limit: 5_000, after });
    for (let offset = 0; offset < page.length; offset += 16) {
      await Promise.all(
        page.slice(offset, offset + 16).map(async ({ path }) => {
          const file = await readFileTreeFile(config, nodeId, path);
          if (file.encoding === "utf8") {
            text.push([path, file.content]);
          } else {
            binary.push([
              path,
              (await readFileTreeFileBytes(config, nodeId, path)).toString("base64"),
            ]);
          }
        }),
      );
    }
    if (page.length < 5_000) break;
    after = page.at(-1)?.path;
  }
  return { files: Object.fromEntries(text), binaryFiles: Object.fromEntries(binary) };
};

/** Start from the node's merged source; the caller chooses a permitted engine explicitly. */
export const startAgentPreview = async (input: AirAppPreviewStartInput) => {
  await requireAirApp(input.nodeId, "write");
  const files = await loadPreviewFiles(input.nodeId);
  let requiredEngine: string | undefined;
  try {
    requiredEngine = resolveRunPlan(files.files).requiredEngine;
  } catch (error) {
    throw new ORPCError("BAD_REQUEST", {
      message: error instanceof Error ? error.message : String(error),
    });
  }
  if (requiredEngine && requiredEngine !== input.engine) {
    throw new ORPCError("PRECONDITION_FAILED", {
      message: `This AirApp requires the "${requiredEngine}" engine. ${requiredEngine === "site" ? "Use the website preview operation." : requiredEngine === "browser" ? "Open the AirApp in a browser to preview it." : `Start it with engine "${requiredEngine}".`}`,
    });
  }
  return startRunSession({ ...input, ...files });
};

export const readAgentPreview = async (nodeId: string) => {
  await requireAirApp(nodeId, "read");
  return getRunSessionState(nodeId);
};

export const stopAgentPreview = async (nodeId: string) => {
  await requireAirApp(nodeId, "write");
  return stopRunSession(nodeId);
};
