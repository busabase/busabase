import { describe, expect, it } from "vitest";
import {
  type BusabaseSidecarStatus,
  FALLBACK_SIDECAR_URL,
  getExternalHttpUrl,
  getSidecarDashboardUrl,
} from "./sidecar";

const status = (localUrl: string): BusabaseSidecarStatus => ({
  running: true,
  healthy: true,
  port: 15419,
  pid: 42,
  localUrl,
  apiUrl: `${localUrl}/api/v1`,
  dataDir: "/tmp/busabase",
  launchMode: "managed",
  error: null,
});

describe("desktop sidecar boundaries", () => {
  it("builds the dashboard URL from the running sidecar", () => {
    expect(getSidecarDashboardUrl(status("http://localhost:16000"))).toBe(
      "http://localhost:16000/dashboard",
    );
    expect(getSidecarDashboardUrl(status(""))).toBe(`${FALLBACK_SIDECAR_URL}/dashboard`);
  });

  it("allows only HTTP URLs to leave the Tauri webview", () => {
    expect(getExternalHttpUrl("https://busabase.com/connect")).toBe("https://busabase.com/connect");
    expect(() => getExternalHttpUrl("file:///etc/passwd")).toThrow(
      "Refusing to open file: URL externally",
    );
    expect(() => getExternalHttpUrl("busabase://desktop/cloud-connect")).toThrow(
      "Refusing to open busabase: URL externally",
    );
  });
});
