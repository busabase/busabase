/**
 * Node.js-specific startup work, imported by instrumentation.ts only on the
 * Node runtime. Resumes the Cloud tunnel relay client (if a valid stored
 * credential exists) so the tunnel comes back up automatically after a
 * restart — see ~/domains/settings/logic/cloud-tunnel-client.ts.
 *
 * Also does two things for agent sessions:
 *
 * - Closes out sessions a previous process left behind. A local agent lives in
 *   a child process that dies with the server (measured — in a stdio protocol
 *   the pipe is the lifetime), so those rows can never become live again;
 *   without this the Agents list would show sessions that look ready but can
 *   never answer. Bookkeeping, not cleanup: nothing is killed, because there is
 *   provably nothing left running. See the Agents spec §7.3.
 * - Sweeps finished sessions past the retention window, on boot and then daily.
 *   Daily as well as on boot because a desktop install can stay up for weeks —
 *   boot-only retention on a long-lived process is retention in name only.
 */

import {
  endOrphanedLocalSessions,
  pruneExpiredSessions,
} from "busabase-core/domains/agents/logic/agent-session-store";
import { resumeCloudTunnelOnBoot } from "~/domains/settings/logic/cloud-tunnel-client";

/**
 * Declare what this build is, before anything asks.
 *
 * `APP_ENV` is how the server decides whether it may run an AirApp as a process
 * on itself (`engine-availability.ts`). This build's host IS the user's own
 * machine — that is the entire premise of a self-hosted server — so it says so
 * rather than requiring every user to set an environment variable to get the
 * engine the product is supposed to offer them.
 *
 * `||=`, not `=`: an operator who set `APP_ENV` deliberately (`LOCAL` while
 * developing, `DESKTOP` inside the desktop app) has said something more
 * specific, and this must not overwrite it.
 *
 * Busabase Cloud has no equivalent line. Its deployment sets `APP_ENV` itself,
 * and an unset value resolves to "shared infrastructure" — the restrictive
 * answer — so a cloud deployment that forgets cannot accidentally end up
 * spawning app processes next to the server.
 */
process.env.APP_ENV ||= "SELF-HOSTED";

const SWEEP_INTERVAL_MS = 24 * 60 * 60 * 1000;

type GlobalWithSweep = typeof globalThis & { __busabaseAgentSweepTimer?: NodeJS.Timeout };

async function sweep(): Promise<void> {
  const pruned = await pruneExpiredSessions();
  if (pruned > 0) console.info(`[agents] pruned ${pruned} expired session(s)`);
}

void resumeCloudTunnelOnBoot();

void endOrphanedLocalSessions().then((ended) => {
  if (ended > 0) console.info(`[agents] marked ${ended} session(s) ended after restart`);
});

void sweep();

// `globalThis`-guarded for the same reason the live-session map is: Next's
// dev-mode re-evaluation would otherwise stack a new timer per reload. `unref`
// so a pending sweep never keeps the process alive on shutdown.
const globalWithSweep = globalThis as GlobalWithSweep;
if (!globalWithSweep.__busabaseAgentSweepTimer) {
  globalWithSweep.__busabaseAgentSweepTimer = setInterval(() => void sweep(), SWEEP_INTERVAL_MS);
  globalWithSweep.__busabaseAgentSweepTimer.unref();
}
