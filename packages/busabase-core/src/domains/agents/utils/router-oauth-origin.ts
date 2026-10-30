/**
 * Read the host's public origin without importing cloud-only infrastructure.
 * Cloud publishes this document contract at runtime; standalone builds may
 * supply NEXT_PUBLIC_APP_URL or use the page's own origin instead.
 */
export function readRouterOauthOrigin(fallbackOrigin: string): string {
  const scope = globalThis as unknown as Record<string, unknown>;
  const injected = scope.__SHARELIB_PUBLIC_ENV__;
  const appUrl =
    injected && typeof injected === "object" && "appUrl" in injected ? injected.appUrl : undefined;
  const configured = appUrl || process.env.NEXT_PUBLIC_APP_URL;
  if (typeof configured !== "string") return fallbackOrigin;

  try {
    const url = new URL(configured);
    if ((url.protocol === "http:" || url.protocol === "https:") && !url.username && !url.password) {
      return url.origin;
    }
  } catch {
    // Invalid deployment configuration must not produce an unsafe popup URL.
  }
  return fallbackOrigin;
}
