import { normalizeServerUrl } from "~/connection/server-url";

export async function validateBusabaseServer(serverUrl: string) {
  const normalizedUrl = normalizeServerUrl(serverUrl);
  const response = await fetch(`${normalizedUrl}/api/health`);
  if (!response.ok) {
    throw new Error(`Health check failed with HTTP ${response.status}`);
  }
  const payload = (await response.json()) as { service?: string; status?: string };
  if (payload.service !== "busabase" || payload.status !== "ok") {
    throw new Error("This does not look like a Busabase server");
  }
  return { ...payload, serverUrl: normalizedUrl };
}
