export const LOCAL_SPACE_ID = "local";

const splitPathSuffix = (value: string): [string, string] => {
  const suffixIndex = value.search(/[?#]/);
  return suffixIndex === -1 ? [value, ""] : [value.slice(0, suffixIndex), value.slice(suffixIndex)];
};

const normalizeRoutePath = (value: string): string => {
  const [pathname, suffix] = splitPathSuffix(value.trim());
  const normalizedPathname = `/${pathname}`.replace(/\/{2,}/g, "/").replace(/\/$/, "") || "/";
  return `${normalizedPathname}${suffix}`;
};

export const getDashboardBasePath = (spaceId = LOCAL_SPACE_ID): string =>
  `/dashboard/${encodeURIComponent(spaceId)}`;

/** `/home` (the landing digest), not `/inbox`, is where an unqualified dashboard URL lands. */
export const buildDashboardUrl = (path = "/home", options: { spaceId?: string } = {}): string => {
  const normalized = normalizeRoutePath(path);
  const basePath = getDashboardBasePath(options.spaceId);
  return normalized === "/" ? `${basePath}/home` : `${basePath}${normalized}`;
};

export const getLegacyDashboardRedirect = (pathname: string): string | null => {
  const normalized = normalizeRoutePath(pathname);
  const basePath = getDashboardBasePath();

  if (normalized === basePath || normalized === `${basePath}/`) {
    return `${basePath}/home`;
  }
  if (normalized.startsWith(`${basePath}/`)) {
    return null;
  }
  if (normalized === "/dashboard" || normalized === "/dashboard/") {
    return `${basePath}/home`;
  }
  if (normalized.startsWith("/dashboard/")) {
    return `${basePath}/${normalized.slice("/dashboard/".length)}`;
  }
  return null;
};
