import type { BusabaseORPCClient } from "busabase-contract/api-client/react-query";
import type {
  InstallEventVO,
  InstallFromGithubDTO,
  InstallResultVO,
} from "busabase-contract/domains/install/types";
import { isMissingRouteError } from "~/api/mobile-api-compat";

/**
 * The two install calls this flow needs.
 *
 * Declared structurally rather than as `Pick<BusabaseORPCClient["install"]>`
 * because the real streaming procedure returns oRPC's `AsyncIteratorClass`,
 * which a test cannot construct — this widens it to the `AsyncIterable` the
 * loop below actually requires. The assertion underneath is what keeps that
 * widening honest.
 */
export interface InstallClient {
  fromGithubStream: (input: InstallFromGithubDTO) => Promise<AsyncIterable<InstallEventVO>>;
  fromGithub: (input: InstallFromGithubDTO) => Promise<InstallResultVO>;
}

/**
 * The real client must still satisfy that shape.
 *
 * Without this, the `as unknown as InstallClient` at the call site would absorb
 * a renamed procedure or a changed payload silently, and the first sign of it
 * would be a failed install on a user's phone rather than a failed build.
 */
type RealInstallClient = BusabaseORPCClient["install"];
type _InstallClientMatchesContract = RealInstallClient extends InstallClient ? true : never;
const _installClientMatchesContract: _InstallClientMatchesContract = true;

export interface RunInstallOptions {
  /** Called with each server-side progress line as it arrives. */
  onProgress: (message: string) => void;
  /** Message for a stream that ended without a result. */
  incompleteMessage: string;
}

/**
 * Install a package, streaming so a gateway cannot mistake a working install
 * for a dead connection.
 *
 * `fromGithub` runs the whole five-pass install inside one request and writes
 * no response bytes for its duration — measured at 11-15s server-side with no
 * network latency, against gateway idle timeouts that are typically 60s. The
 * gateway closes the connection while the install keeps going, so the user is
 * told it failed on an install that actually succeeded, and their retry
 * collides with what the "failed" attempt just created. A phone on mobile data
 * is the worst case for exactly that.
 */
export const runInstall = async (
  client: InstallClient,
  input: InstallFromGithubDTO,
  { onProgress, incompleteMessage }: RunInstallOptions,
): Promise<InstallResultVO> => {
  let events: AsyncIterable<InstallEventVO>;
  try {
    events = await client.fromGithubStream(input);
  } catch (caught) {
    // `fromGithubStream` is newer than many of the self-hosted servers this
    // build gets pointed at, and it takes no id, so it cannot answer NOT_FOUND
    // for missing data — a not-found here can only mean the route is absent.
    // Nothing has been created yet (the stream never opened), so replaying on
    // the legacy route is a first attempt, not a second one.
    //
    // Any other refusal — a collision, a permission check, a bad repo URL — is
    // the server's real answer and must reach the user. Retrying those on
    // `fromGithub` would run the install the stream route just declined.
    if (!isMissingRouteError(caught)) throw caught;
    return client.fromGithub(input);
  }

  let installed: InstallResultVO | null = null;
  for await (const event of events) {
    if (event.kind === "progress") onProgress(event.message);
    else installed = event.result;
  }

  // The stream ended without a `done` event: the connection dropped
  // mid-install. Still a failure, because this client genuinely does not know
  // the outcome — but unlike the old silent timeout, the caller keeps the last
  // progress line, which says how far it actually got.
  if (!installed) throw new Error(incompleteMessage);
  return installed;
};
