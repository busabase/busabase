/**
 * A host app's place on the shared conversion stack (Buda, Busabase Cloud,
 * PreviewFile): the same values feed its convert route and the worker its
 * instrumentation starts, so the two always agree on the queue.
 */

export interface ConversionHost {
  /** BullMQ queue the route enqueues on and the worker takes jobs from. */
  queueName: string;
  /** Redis key prefix for cached outputs. */
  cacheKeyPrefix: string;
  /** Cache identity namespace; bump it to invalidate every cached output. */
  cacheVersion: string;
}

/**
 * Namespaced by `id` because hosts share Redis: on a shared queue one host's
 * worker would take another's jobs and store the PDF where the requesting host
 * cannot serve it. `PREVIEWFILE_CONVERSION_QUEUE` / `PREVIEWFILE_CONV_CACHE_PREFIX`
 * override the names per deployment.
 */
export function defineConversionHost(
  id: string,
  options: { cacheVersion?: string } = {},
): ConversionHost {
  return {
    queueName: process.env.PREVIEWFILE_CONVERSION_QUEUE || `${id}-document-conversion`,
    cacheKeyPrefix: process.env.PREVIEWFILE_CONV_CACHE_PREFIX || `${id}:conv-cache-1:`,
    cacheVersion: options.cacheVersion ?? `${id}-conversion-cache-v1`,
  };
}

/**
 * Starts the host's conversion worker from its Node instrumentation, without
 * blocking startup. The worker module is imported lazily so BullMQ never lands
 * in other runtimes' bundles. A no-op (logged) without a redis:// REDIS_URL.
 */
export function startConversionHostWorker(host: ConversionHost): void {
  import("./queue/conversion-worker")
    .then(({ startConversionWorker }) => {
      const worker = startConversionWorker({ queueName: host.queueName });
      console.log(
        worker
          ? `[conversion] worker started on ${host.queueName}`
          : "[conversion] worker not started (no redis:// REDIS_URL)",
      );
    })
    .catch((err) => {
      console.error("[conversion] failed to start the worker:", err);
    });
}
