interface AirAppEmbedSourceOptions {
  serverUrl: string;
  mode: "self-hosted" | "demo" | "cloud";
  bearerToken: string | null;
  spaceId: string | null;
  nodeId: string;
}

export interface AirAppEmbedSource {
  uri: string;
  method?: "GET" | "POST";
  headers?: Record<string, string>;
  body?: string;
}

interface AirAppSpaceIdOptions {
  selectedSpaceId?: string | null;
  verifiedSpaceId?: string | null;
}

export const resolveAirAppSpaceId = ({
  selectedSpaceId,
  verifiedSpaceId,
}: AirAppSpaceIdOptions): string | null => selectedSpaceId ?? verifiedSpaceId ?? null;

export const buildAirAppEmbedSource = ({
  serverUrl,
  mode,
  bearerToken,
  spaceId,
  nodeId,
}: AirAppEmbedSourceOptions): AirAppEmbedSource | null => {
  if (!nodeId) return null;

  const base = serverUrl.replace(/\/+$/, "");
  const dashboardBase =
    mode === "cloud"
      ? spaceId
        ? `/dashboard/${encodeURIComponent(spaceId)}`
        : null
      : "/dashboard";
  if (!dashboardBase) return null;

  const target = `${dashboardBase}/airapp/${encodeURIComponent(nodeId)}?chromeless=1`;
  if (mode !== "cloud") return { uri: `${base}${target}` };
  if (!bearerToken) return null;

  return {
    uri: `${base}/api/auth/mobile-embed-token`,
    method: "POST",
    body: new URLSearchParams({ token: bearerToken, target }).toString(),
  };
};

export const buildAirAppExternalUrl = (source: AirAppEmbedSource): string => {
  if (source.method !== "POST" || !source.body) return source.uri;
  const url = new URL(source.uri);
  const body = new URLSearchParams(source.body);
  for (const [key, value] of body) url.searchParams.set(key, value);
  return url.toString();
};
