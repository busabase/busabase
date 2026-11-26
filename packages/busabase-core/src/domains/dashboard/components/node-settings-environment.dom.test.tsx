// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { BusabaseQueryUtils } from "busabase-contract/api-client/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Router } from "wouter";
import { CoreI18nProvider } from "../../../i18n";
import { AirAppEngineAvailabilityProvider } from "../../airapp/components/engine-availability-context";
import { NodeSettingsDialog } from "./node-settings-dialog";

vi.mock("../../airapp/components/AirAppSiteControls", () => ({
  AirAppSiteEnvironmentSettings: () => <p>Environment editor</p>,
}));

const orpc = {
  nodes: {
    get: {
      queryOptions: () => ({ queryKey: ["node"], queryFn: () => new Promise(() => undefined) }),
    },
  },
} as unknown as BusabaseQueryUtils;

function mount(nodeType: string, locale: "zh-CN" | "zh-TW", engines: ("browser" | "site")[]) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <CoreI18nProvider locale={locale}>
        <AirAppEngineAvailabilityProvider engines={engines}>
          <Router>
            <NodeSettingsDialog
              initialTab="permissions"
              nodeId="node"
              nodeName="Shop"
              nodeType={nodeType}
              onOpenChange={() => undefined}
              open
              orpc={orpc}
            />
          </Router>
        </AirAppEngineAvailabilityProvider>
      </CoreI18nProvider>
    </QueryClientProvider>,
  );
}

afterEach(cleanup);

describe("site environment settings navigation", () => {
  it.each([
    ["zh-CN", "密钥与变量"],
    ["zh-TW", "密鑰與變數"],
  ] as const)("opens the editor from the %s tab", (locale, label) => {
    mount("airapp", locale, ["browser", "site"]);
    fireEvent.click(screen.getByRole("button", { name: label }));
    expect(screen.getByText("Environment editor")).toBeTruthy();
  });

  it("does not show the tab for other nodes or hosts without the site engine", () => {
    mount("base", "zh-CN", ["browser", "site"]);
    expect(screen.queryByRole("button", { name: "密钥与变量" })).toBeNull();
    cleanup();
    mount("airapp", "zh-CN", ["browser"]);
    expect(screen.queryByRole("button", { name: "密钥与变量" })).toBeNull();
  });
});
