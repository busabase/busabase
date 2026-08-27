import { nodepodProxy } from "@scelar/nodepod/next";
import {
  decodeEmbedCapability,
  type EmbedFramePolicy,
  embedCapabilityCookieName,
  embedPublicIdFromPath,
  embedResponseHeaders,
  encodeEmbedCapability,
  parseEmbedBootstrap,
  parseEmbedIframeCapability,
} from "busabase-core/domains/embed-links/capability";
import {
  resolveEmbedCapabilityMetadata,
  resolveEmbedFramePolicy,
} from "busabase-core/domains/embed-links/logic";
import { type NextRequest, NextResponse } from "next/server";
import { DEMO_LOCALE_HEADER, resolveDemoMode } from "openlib/ui/dashboard/demo";
import { getLegacyDashboardRedirect } from "~/lib/dashboard-routes";

/** A page query param from the request's own URL or, for SPA calls, the `Referer`. */
const readParam = (request: NextRequest, key: string): string | null => {
  const own = request.nextUrl.searchParams.get(key);
  if (own != null) return own;
  const referer = request.headers.get("referer");
  if (!referer) return null;
  try {
    return new URL(referer).searchParams.get(key);
  } catch {
    return null;
  }
};

const applyEmbedHeaders = (
  request: NextRequest,
  response: NextResponse,
  policy: EmbedFramePolicy | null,
) => {
  for (const [name, value] of Object.entries(
    embedResponseHeaders(request.nextUrl.pathname, policy),
  )) {
    response.headers.set(name, value);
  }
  response.headers.set("x-robots-tag", "noindex, nofollow");
  return response;
};

const handleEmbedRequest = async (
  request: NextRequest,
  publicId: string,
): Promise<NextResponse> => {
  const bootstrap = parseEmbedBootstrap(
    request.nextUrl.pathname,
    request.nextUrl.searchParams.get("token"),
    request.nextUrl.searchParams.get("view"),
  );
  if (request.method === "GET" && bootstrap) {
    const metadata = await resolveEmbedCapabilityMetadata(publicId, bootstrap.secret);
    const cleanUrl = request.nextUrl.clone();
    cleanUrl.searchParams.delete("token");
    const response = NextResponse.redirect(cleanUrl, 303);
    if (metadata) {
      const forwardedProtocol = request.headers.get("x-forwarded-proto")?.split(",", 1)[0]?.trim();
      const secure = forwardedProtocol
        ? forwardedProtocol === "https"
        : request.nextUrl.protocol === "https:";
      response.cookies.set(
        embedCapabilityCookieName(publicId),
        encodeEmbedCapability(publicId, bootstrap.secret),
        {
          expires: metadata.expiresAt,
          httpOnly: true,
          path: `/embed/${publicId}`,
          sameSite: "lax",
          secure,
        },
      );
    }
    return applyEmbedHeaders(request, response, metadata?.framePolicy ?? null);
  }

  const direct = parseEmbedIframeCapability(
    request.nextUrl.pathname,
    request.nextUrl.searchParams.get("token"),
    request.nextUrl.searchParams.get("view"),
  );
  const cookie = decodeEmbedCapability(
    request.cookies.get(embedCapabilityCookieName(publicId))?.value,
  );
  const capability = direct ?? (cookie?.id === publicId ? cookie : null);
  const policy = capability ? await resolveEmbedFramePolicy(publicId, capability.secret) : null;
  return applyEmbedHeaders(request, NextResponse.next(), policy);
};

export async function proxy(request: NextRequest) {
  const redirectPath = getLegacyDashboardRedirect(request.nextUrl.pathname);
  if (redirectPath) {
    const redirected = request.nextUrl.clone();
    redirected.pathname = redirectPath;
    return NextResponse.redirect(redirected, 308);
  }

  const nodepodResponse = await nodepodProxy(request);
  if (nodepodResponse) return nodepodResponse;

  const publicId = embedPublicIdFromPath(request.nextUrl.pathname);
  if (publicId) return handleEmbedRequest(request, publicId);

  const { useCase, locale } = resolveDemoMode({
    demo: readParam(request, "demo") ?? undefined,
    lang: readParam(request, "lang") ?? undefined,
  });
  const headers = new Headers(request.headers);
  headers.delete("x-demo-mode");
  headers.delete(DEMO_LOCALE_HEADER);
  if (useCase) {
    headers.set("x-demo-mode", useCase);
    if (locale === "zh-CN") headers.set(DEMO_LOCALE_HEADER, locale);
  }

  return NextResponse.next({ request: { headers } });
}

export const config = {
  matcher: ["/dashboard/:path*", "/api/:path*", "/embed/:path*", "/__sw__.js"],
};
