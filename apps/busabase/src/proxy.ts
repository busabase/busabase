import { nodepodProxy } from "@scelar/nodepod/next";
import { type NextRequest, NextResponse } from "next/server";
import { DEMO_LOCALE_HEADER, resolveDemoMode } from "openlib/ui/dashboard/demo";

/**
 * Demo mode is resolved PURELY server-side — no client code, no cookie. The
 * dashboard is an oRPC SPA whose API requests POST to `/api/rpc` and do NOT carry
 * the page's `?demo` / `?lang` query, so this proxy bridges them into request
 * headers (`x-demo-mode` / `x-demo-locale`); `route.ts` then swaps to the stateless
 * demo router (validating the use-case) and serves the locale's seed — the server
 * render / page need no demo logic at all.
 *
 * The values come from the request's own query (direct REST/curl) or, for
 * same-origin SPA calls, the page URL carried in `Referer`. The headers are
 * server-derived only: any inbound copy is stripped so a client can't spoof them.
 *
 * (Next 16 renamed `middleware` → `proxy`; this exports the `proxy` function.)
 *
 * Note: `?demo` (and `?lang`) must stay in the page URL for the demo to persist.
 * Client-side (wouter) navigation that drops them ends/resets the demo.
 */

/** A page query param from the request's own URL or, for SPA calls, the `Referer`. */
const readParam = (request: NextRequest, key: string): string | null => {
  const own = request.nextUrl.searchParams.get(key);
  if (own != null) {
    return own;
  }
  const referer = request.headers.get("referer");
  if (!referer) {
    return null;
  }
  try {
    return new URL(referer).searchParams.get(key);
  } catch {
    return null;
  }
};

export async function proxy(request: NextRequest) {
  // Nodepod (AirApp node's in-browser Run panel, via busabase-core's
  // dashboard) needs its service worker reachable at `/__sw__.js` on this
  // app's own origin. Unified with apps/busabase-cloud's approach (compose
  // nodepodProxy into the app's existing proxy.ts) rather than a separate
  // `app/__sw__.js/route.ts` — see the airapp changelog for why both forms
  // work and why this one was chosen for consistency across the two apps.
  const nodepodResponse = await nodepodProxy(request);
  if (nodepodResponse) return nodepodResponse;

  // Resolve the page `?demo`/`?lang` (0/false/off → not demo) into the demo signals;
  // `route.ts` validates the use-case into a `DemoUseCase`.
  const { useCase, locale } = resolveDemoMode({
    demo: readParam(request, "demo") ?? undefined,
    lang: readParam(request, "lang") ?? undefined,
  });
  const headers = new Headers(request.headers);
  // Trust only the proxy-derived values; never an inbound client header.
  headers.delete("x-demo-mode");
  headers.delete(DEMO_LOCALE_HEADER);
  if (useCase) {
    headers.set("x-demo-mode", useCase);
    if (locale === "zh-CN") {
      headers.set(DEMO_LOCALE_HEADER, locale);
    }
  }
  return NextResponse.next({ request: { headers } });
}

export const config = {
  // Next.js statically analyzes `matcher` at build time and requires literal
  // strings — it cannot resolve an imported `nodepodMatcher` reference here,
  // even though its value is exactly this same literal ("/__sw__.js").
  matcher: ["/api/v1/:path*", "/api/rpc/:path*", "/__sw__.js"],
};
