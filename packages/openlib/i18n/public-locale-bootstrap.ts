/**
 * The inline head script that sends a first-time visitor of a public page to
 * their language (`/pricing` → `/zh-CN/pricing`) and records the language they
 * are on. One implementation for every app that serves localized public pages,
 * so a rule fixed in one app is fixed in all of them.
 *
 * It runs before hydration on every page, so it decides what to leave alone:
 * the app paths in `skipPaths`, and, for apps with workspace subdomains, every
 * page of a workspace host (`<label>.<baseDomain>`) — the host serves only the
 * app there, and `/agent/...` would become a nonexistent `/zh-CN/agent/...`.
 */

export interface PublicLocaleBootstrapOptions {
  supportedLocales: readonly string[];
  /**
   * App paths that are never redirected into a locale. `"/x"` matches `/x` and
   * everything under it; `"/x/"` matches only what is under it.
   */
  skipPaths: readonly string[];
  /** Set by apps that serve each workspace on its own subdomain. */
  workspaceHosts?: {
    /** The workspace base domain (`busabase.com`); "" when subdomains are off. */
    baseDomain: string;
    /** Labels that are never a workspace (`www`, `community`, ...). */
    reservedLabels: readonly string[];
    /**
     * Pages a workspace host still serves in every language (sign-in), as a
     * RegExp source matched case-insensitively against the path. These keep
     * the redirect to their localized version.
     */
    localizedPathPattern?: string;
  };
}

export function createPublicLocaleBootstrapScript({
  supportedLocales,
  skipPaths,
  workspaceHosts,
}: PublicLocaleBootstrapOptions): string {
  return `(() => {
    try {
      const baseDomain = ${JSON.stringify(workspaceHosts?.baseDomain ?? "")};
      const reservedHosts = ${JSON.stringify(workspaceHosts?.reservedLabels ?? [])};
      const workspaceLocalizedPath = ${JSON.stringify(workspaceHosts?.localizedPathPattern ?? "")};
      const hostname = location.hostname.toLowerCase();
      const pathname = location.pathname;
      const workspaceLabel = baseDomain && hostname.endsWith("." + baseDomain)
        ? hostname.slice(0, -baseDomain.length - 1)
        : "";
      if (
        workspaceLabel &&
        !workspaceLabel.includes(".") &&
        !reservedHosts.includes(workspaceLabel) &&
        !(workspaceLocalizedPath && new RegExp(workspaceLocalizedPath, "i").test(pathname))
      ) {
        return;
      }

      const supportedLocales = ${JSON.stringify(supportedLocales)};
      const skipPaths = ${JSON.stringify(skipPaths)};
      const firstSegment = pathname.split("/")[1];
      const locale = supportedLocales.includes(firstSegment) ? firstSegment : null;
      const unlocalizedPath = locale ? pathname.slice(locale.length + 1) || "/" : pathname;
      const skipLocaleRedirect = skipPaths.some((prefix) =>
        prefix.endsWith("/")
          ? unlocalizedPath.startsWith(prefix)
          : unlocalizedPath === prefix || unlocalizedPath.startsWith(prefix + "/"),
      );

      if (locale) {
        document.documentElement.lang = locale;
        if (!skipLocaleRedirect) {
          document.cookie = "webpage_lang=" + encodeURIComponent(locale) + ";path=/;max-age=31536000;samesite=lax";
        }
        return;
      }
      if (skipLocaleRedirect) return;

      const cookieMatch = document.cookie.match(/(?:^|; )webpage_lang=([^;]*)/);
      const cookieLocale = cookieMatch ? decodeURIComponent(cookieMatch[1]) : "";
      const browserLocale = (navigator.languages && navigator.languages[0]) || navigator.language || "en";
      const preferredLocale = cookieLocale || browserLocale;
      const resolvedLocale = supportedLocales.includes(preferredLocale)
        ? preferredLocale
        : supportedLocales.find((candidate) => candidate.split("-")[0] === preferredLocale.split("-")[0]) || "en";

      document.documentElement.lang = "en";
      document.cookie = "webpage_lang=" + encodeURIComponent(resolvedLocale) + ";path=/;max-age=31536000;samesite=lax";
      if (resolvedLocale !== "en") {
        location.replace("/" + resolvedLocale + (pathname === "/" ? "" : pathname) + location.search + location.hash);
      }
    } catch {
      // Locale detection must never prevent the page from loading.
    }
  })();`;
}
