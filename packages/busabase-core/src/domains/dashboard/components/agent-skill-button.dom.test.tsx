// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { CoreI18nProvider } from "../../../i18n";
import { CLOUD_MCP_BASE_URL, LOCAL_MCP_BASE_URL, type McpGuideEdition } from "./agent-mcp-guides";
import { AgentIntegrationContent } from "./agent-skill-button";

/**
 * The MCP tab used to hardcode its connection mode to `local`, so Busabase
 * Cloud handed every visitor `http://localhost:15419/api/mcp` — an address
 * nothing on their machine is listening to. Unlike the Agent Skills tab, that
 * panel has no edition dispatcher downstream to catch the mistake, so this is
 * the only guard it has.
 *
 * These need a DOM: Radix renders nothing for an inactive tab, so the panel is
 * unreachable from `renderToStaticMarkup` — the tab has to actually be clicked.
 */
const renderPanel = (edition: McpGuideEdition) =>
  render(
    <CoreI18nProvider locale="en">
      <AgentIntegrationContent
        defaultOrigin="https://app.busabase.com"
        edition={edition}
        editionConfirmed
      />
    </CoreI18nProvider>,
  );

// Radix switches tabs on mousedown, not on a synthesized click.
const openMcpTab = () => fireEvent.mouseDown(screen.getByRole("tab", { name: "MCP" }));

const mcpBaseUrl = () => (screen.getByLabelText("Base URL") as HTMLInputElement).value;

const pressedMode = () =>
  screen
    .getByRole("group", { name: "Connection mode" })
    .querySelector('button[aria-pressed="true"]')?.textContent;

describe("AgentIntegrationContent — MCP tab", () => {
  afterEach(cleanup);

  it("opens Cloud on the hosted endpoint", () => {
    renderPanel("cloud");
    openMcpTab();

    expect(pressedMode()).toBe("Cloud");
    // jsdom serves the app from a loopback origin, which is exactly the case
    // `getDefaultCloudMcpBaseUrl` redirects to the production host.
    expect(mcpBaseUrl()).toBe(CLOUD_MCP_BASE_URL);
    expect(mcpBaseUrl()).not.toContain("15419");
  });

  it("opens Desktop on the local endpoint", () => {
    renderPanel("desktop");
    openMcpTab();

    expect(pressedMode()).toBe("Local");
    expect(mcpBaseUrl()).toBe(LOCAL_MCP_BASE_URL);
  });

  it("follows a live edition switch", () => {
    // The homepage keeps one dialog mounted while its edition toggle flips
    // underneath it, so a remount is not what re-derives the endpoint.
    const { rerender } = renderPanel("cloud");
    openMcpTab();
    expect(pressedMode()).toBe("Cloud");

    rerender(
      <CoreI18nProvider locale="en">
        <AgentIntegrationContent
          defaultOrigin="https://app.busabase.com"
          edition="desktop"
          editionConfirmed
        />
      </CoreI18nProvider>,
    );

    expect(pressedMode()).toBe("Local");
    expect(mcpBaseUrl()).toBe(LOCAL_MCP_BASE_URL);
  });

  it("keeps a deliberate mode choice until the edition itself changes", () => {
    renderPanel("cloud");
    openMcpTab();

    fireEvent.click(screen.getByRole("button", { name: "Local" }));

    expect(pressedMode()).toBe("Local");
    expect(mcpBaseUrl()).toBe(LOCAL_MCP_BASE_URL);
  });
});
