/**
 * Node.js-specific startup work, imported by instrumentation.ts only on the
 * Node runtime. Resumes the Cloud tunnel relay client (if a valid stored
 * credential exists) so the tunnel comes back up automatically after a
 * restart — see ~/domains/settings/logic/cloud-tunnel-client.ts.
 */
import { resumeCloudTunnelOnBoot } from "~/domains/settings/logic/cloud-tunnel-client";

void resumeCloudTunnelOnBoot();
