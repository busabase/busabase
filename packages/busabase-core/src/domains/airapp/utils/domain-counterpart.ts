/**
 * The www / root-domain twin a person usually wants bound next to a domain.
 *
 * PURITY: no imports; safe for client and server.
 *
 * No public-suffix list is bundled, so "root domain" is decided conservatively:
 * exactly two labels (`company.com`), or three where the last two are a common
 * second-level registry suffix (`company.co.uk`). Anything else (`shop.company.com`,
 * an unknown suffix) gets no suggestion rather than a wrong one.
 */

const SECOND_LEVEL_SUFFIXES: ReadonlySet<string> = new Set([
  "co.uk",
  "org.uk",
  "me.uk",
  "com.hk",
  "org.hk",
  "com.cn",
  "net.cn",
  "org.cn",
  "com.tw",
  "com.au",
  "net.au",
  "org.au",
  "co.jp",
  "co.nz",
  "co.kr",
  "com.sg",
  "com.my",
  "co.in",
  "com.br",
  "com.mx",
  "co.za",
]);

/** Whether `hostname` (lowercase, no trailing dot) is a registrable root such as `company.com`. */
export const isApexLikeHostname = (hostname: string): boolean => {
  const labels = hostname.split(".");
  if (labels.some((label) => label.length === 0)) return false;
  if (labels.length === 2) return !SECOND_LEVEL_SUFFIXES.has(hostname);
  if (labels.length === 3) return SECOND_LEVEL_SUFFIXES.has(labels.slice(1).join("."));
  return false;
};

/**
 * `company.com` → `www.company.com`, `www.company.com` → `company.com`, otherwise `null`.
 * Only suggests a counterpart that is not already in `bound`.
 */
export const suggestCounterpartHostname = (
  hostname: string,
  bound: readonly string[],
): string | null => {
  let counterpart: string | null = null;
  if (isApexLikeHostname(hostname)) {
    counterpart = `www.${hostname}`;
  } else if (hostname.startsWith("www.") && isApexLikeHostname(hostname.slice(4))) {
    counterpart = hostname.slice(4);
  }
  return counterpart && !bound.includes(counterpart) ? counterpart : null;
};
