interface AirAppWebViewOptions {
  platform: string;
  serverUrl: string;
}

const IOS_APP_BOUND_DOMAINS = ["busabase.com", "demo.busabase.com"] as const;

const isAppBoundHostname = (hostname: string): boolean =>
  IOS_APP_BOUND_DOMAINS.some((domain) => hostname === domain || hostname.endsWith(`.${domain}`));

/**
 * Nodepod needs a controlling Service Worker. On iOS that capability is
 * available only for the HTTPS domains compiled into WKAppBoundDomains.
 */
export const canEmbedAirAppInWebView = ({ platform, serverUrl }: AirAppWebViewOptions): boolean => {
  if (platform !== "ios") return true;

  try {
    const url = new URL(serverUrl);
    return url.protocol === "https:" && isAppBoundHostname(url.hostname.toLowerCase());
  } catch {
    return false;
  }
};
