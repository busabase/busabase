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
