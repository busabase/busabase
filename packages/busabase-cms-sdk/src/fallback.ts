/**
 * The "read from Busabase, fall back to bundled content on any failure" wrapper — every app
 * consuming busabase-cms re-implemented this same try/catch/console.warn a couple of times
 * (once for list-shaped reads, once for single-record reads). One generic version, one place
 * to change the log format.
 */
export const readCmsOrFallback = async <T>(
  operation: (() => Promise<T>) | null | undefined,
  fallback: T,
  label: string,
): Promise<T> => {
  if (!operation) return fallback;
  try {
    return await operation();
  } catch (error) {
    console.warn(`[busabase-cms] ${label} failed; using bundled content`, error);
    return fallback;
  }
};

/**
 * The answer a read got, when the caller needs to act on it.
 *
 * `readCmsOrFallback` deliberately folds "unreachable" into "empty", which is the
 * right default for rendering — a marketing page should not 500 because the
 * workspace behind it blinked. It is the wrong answer the moment a page turns it
 * into a claim: an unreachable CMS then renders as a 404, and whatever caching
 * sits in front of it persists that as "this content was deleted".
 *
 * Reads whose result decides a `notFound()` should go through `readCmsStatus`
 * instead and be told which answer they actually received.
 */
export type CmsRead<T> = { status: "ok"; data: T } | { status: "unavailable" };

export const readCmsStatus = async <T>(
  operation: (() => Promise<T>) | null | undefined,
  /**
   * What "nothing here" looks like for this read.
   *
   * Returned as a SUCCESSFUL read when the integration is simply not configured:
   * an app with no CMS wired up is not broken, it just has no CMS content, and
   * turning that into an error breaks first-run and CMS-off deployments.
   */
  whenUnconfigured: T,
  label: string,
): Promise<CmsRead<T>> => {
  if (!operation) return { status: "ok", data: whenUnconfigured };
  try {
    return { status: "ok", data: await operation() };
  } catch (error) {
    console.warn(`[busabase-cms] ${label} failed`, error);
    return { status: "unavailable" };
  }
};

/**
 * Unwrap a read, or fail loudly.
 *
 * Throwing beats rendering a 404: an error response is not cached, so the page
 * recovers on the next request, whereas a cached 404 tells crawlers the content
 * is gone.
 */
export const requireCmsRead = <T>(read: CmsRead<T>, what: string): T => {
  if (read.status === "unavailable") {
    throw new Error(`Busabase CMS unreachable while rendering ${what}`);
  }
  return read.data;
};
