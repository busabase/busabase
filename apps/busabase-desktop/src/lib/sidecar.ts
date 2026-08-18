export interface BusabaseSidecarStatus {
  running: boolean;
  healthy: boolean;
  port: number;
  pid: number | null;
  localUrl: string;
  apiUrl: string;
  dataDir: string;
  launchMode: "managed" | "external" | "stopped";
  error: string | null;
}

export const FALLBACK_SIDECAR_URL = "http://localhost:15419";
export const OPEN_EXTERNAL_REQUEST = "busabase-desktop:open-external";
export const OPEN_EXTERNAL_RESULT = "busabase-desktop:open-external:result";

export const getSidecarDashboardUrl = (status: BusabaseSidecarStatus) =>
  `${status.localUrl || FALLBACK_SIDECAR_URL}/dashboard`;

export const getExternalHttpUrl = (value: string) => {
  const target = new URL(value);
  if (target.protocol !== "http:" && target.protocol !== "https:") {
    throw new Error(`Refusing to open ${target.protocol} URL externally`);
  }
  return target.toString();
};
