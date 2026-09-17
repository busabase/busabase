interface AirAppWebViewOptions {
  platform: string;
  serverUrl: string;
}

const IOS_APP_BOUND_DOMAINS = ["busabase.com", "demo.busabase.com"] as const;

const isAppBoundHostname = (hostname: string): boolean =>
  IOS_APP_BOUND_DOMAINS.some((domain) => hostname === domain || hostname.endsWith(`.${domain}`));

const isLoopbackHostname = (hostname: string): boolean => {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (normalized === "localhost" || normalized === "::1") return true;

  const octets = normalized.split(".");
  return octets.length === 4 && octets[0] === "127" && octets.every((octet) => /^\d+$/.test(octet));
};

/**
 * Nodepod needs a controlling Service Worker. On iOS that capability is
 * available for HTTPS domains compiled into WKAppBoundDomains. WebKit also
 * treats localhost and loopback IPs as app-bound so simulator development can
 * run the same Service Worker-backed AirApp UI as production.
 */
export const canEmbedAirAppInWebView = ({ platform, serverUrl }: AirAppWebViewOptions): boolean => {
  if (platform !== "ios") return true;

  try {
    const url = new URL(serverUrl);
    const hostname = url.hostname.toLowerCase();
    return (
      isLoopbackHostname(hostname) || (url.protocol === "https:" && isAppBoundHostname(hostname))
    );
  } catch {
    return false;
  }
};
