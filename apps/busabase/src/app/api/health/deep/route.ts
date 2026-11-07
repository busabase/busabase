import { cache } from "openlib/cache";
import { createDeepHealthCheck } from "openlib/health/deep-health-check";
import {
  createCacheRoundTripProbe,
  createDatabaseProbe,
  createStorageProbe,
} from "openlib/health/probes";
import { storage } from "openlib/storage";
import { getDb } from "~/db";

// Never prerender or cache at the framework level — the check keeps its own 10s cache.
export const dynamic = "force-dynamic";

// Module level: one cache and one in-flight run for every request this process serves.
const deepHealthCheck = createDeepHealthCheck({
  service: "busabase",
  probes: {
    database: createDatabaseProbe(getDb),
    // busabase-core reads previews and AirApp targets through openlib/cache (REDIS_URL).
    cache: createCacheRoundTripProbe(cache),
    // Workspace assets (STORAGE_URL).
    storage: createStorageProbe(storage),
  },
});

/**
 * Dependency health for monitoring: 200 when every configured dependency answered, 503
 * otherwise; 404 without `Authorization: Bearer <HEALTH_CHECK_TOKEN>`.
 */
export function GET(request: Request): Promise<Response> {
  return deepHealthCheck.respond(request);
}
