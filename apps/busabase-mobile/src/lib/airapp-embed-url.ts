interface AirAppEmbedUrlOptions {
  serverUrl: string;
  mode: "self-hosted" | "demo" | "cloud";
  bearerToken: string | null;
  spaceId: string | null;
  nodeId: string;
}

export const buildAirAppEmbedUrl = ({
  serverUrl,
  mode,
  bearerToken,
  spaceId,
  nodeId,
}: AirAppEmbedUrlOptions): string | null => {
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
  if (mode !== "cloud") return `${base}${target}`;
  if (!bearerToken) return null;

  return `${base}/api/auth/mobile-embed-token?token=${encodeURIComponent(bearerToken)}&target=${encodeURIComponent(target)}`;
};
