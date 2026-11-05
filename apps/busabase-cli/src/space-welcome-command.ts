/**
 * `busabase-cli space-welcome get|set` — which Doc or HTML node Home shows at
 * the top of a space.
 *
 * The CLI and the server ship separately, and this route is newer than many
 * servers it will be pointed at. Their 404 must not read as "no welcome page"
 * (an agent would then write a guide nobody is ever shown) or as something
 * worth retrying, so it becomes one clear "upgrade the server" error. The
 * route itself never answers NOT_FOUND — a bad node id is `BAD_REQUEST` — so
 * a 404 here can only mean the route does not exist.
 */
import type { BusabaseClient } from "busabase-sdk";
import { CliOutcomeError, classifyError } from "./errors.js";

export const SPACE_WELCOME_UNSUPPORTED =
  "This server does not support the space welcome page yet (404 on /api/v1/space-welcome). Upgrade the Busabase server, then run this again. Nothing was changed; retrying against this server will not help.";

const supported = async <T>(call: () => Promise<T>): Promise<T> => {
  try {
    return await call();
  } catch (error) {
    if (classifyError(error).code !== "NOT_FOUND") throw error;
    throw new CliOutcomeError("NOT_FOUND", SPACE_WELCOME_UNSUPPORTED);
  }
};

export const spaceWelcomeGetCommand = (client: BusabaseClient) =>
  supported(() => client.spaceWelcome.get());

export interface SpaceWelcomeSetFlags {
  node?: string;
  clear?: boolean;
  expectedVersion: number;
}

export const spaceWelcomeSetCommand = (client: BusabaseClient, flags: SpaceWelcomeSetFlags) => {
  const hasNode = flags.node !== undefined;
  const clear = Boolean(flags.clear);
  if (hasNode === clear) {
    throw new CliOutcomeError("USAGE", "Pass exactly one of --node <nodeId> or --clear.");
  }
  const nodeId = hasNode ? (flags.node as string).trim() : null;
  if (nodeId === "") {
    throw new CliOutcomeError("USAGE", "--node needs the id of a Doc or HTML node.");
  }
  return supported(() =>
    client.spaceWelcome.update({ nodeId, expectedVersion: flags.expectedVersion }),
  );
};
