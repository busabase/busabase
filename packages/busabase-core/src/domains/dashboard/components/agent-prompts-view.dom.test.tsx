// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CoreI18nProvider } from "../../../i18n";
import type { NodePrompt } from "../helpers/node-agent-prompts";
import type { AgentIntegrationTarget } from "./agent-install-panel";
import { AgentPromptsView } from "./agent-prompts-view";

/**
 * The connection check is deliberately NOT in the preview, which means the
 * preview cannot prove it exists — only the clipboard can. So these need a real
 * DOM and a real click on Copy; `renderToStaticMarkup` would happily pass while
 * the appended paragraph was missing entirely.
 */
const prompt: NodePrompt = {
  key: "folder-summarize",
  tier: "scenario",
  group: "Content",
  label: "Summarize this folder",
  body: 'Target: the Busabase Folder "Coder" (nodeId: nod_coder).\n\nReply to me in English.',
};

let written: string[] = [];

beforeEach(() => {
  written = [];
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: {
      writeText: (text: string) => {
        written.push(text);
        return Promise.resolve();
      },
    },
  });
});

afterEach(cleanup);

const renderView = (agentIntegration?: AgentIntegrationTarget) =>
  render(
    <CoreI18nProvider locale="en">
      <AgentPromptsView
        agentIntegration={agentIntegration}
        askAgent={null}
        capabilities={[]}
        onHandedOff={() => {}}
        scenarios={[prompt]}
      />
    </CoreI18nProvider>,
  );

const copy = async () => {
  fireEvent.click(screen.getByRole("button", { name: "Copy prompt" }));
  await vi.waitFor(() => expect(written).toHaveLength(1));
  return written[0] as string;
};

describe("AgentPromptsView copy", () => {
  it("copies the preview's text plus a connection check bound to the target space", async () => {
    renderView({ edition: "cloud", targetSpaceId: "spc_acme" });

    const text = await copy();

    // The preview's own text still leads, unchanged — the target line stays the
    // first thing a human can select off the top of a copied prompt.
    expect(text.startsWith(prompt.body)).toBe(true);
    expect(text).toContain("Before you begin, confirm that this environment is connected");
    // Rebuilt from the live browser origin, never a host's SSR placeholder.
    expect(text).toContain(
      `${window.location.origin}/SETUP_SKILL.md?edition=cloud&editionConfirmed=1&space=spc_acme`,
    );
  });

  it("never leaks a cloud space id into Desktop guidance", async () => {
    renderView({ edition: "desktop", targetSpaceId: "spc_acme" });

    const text = await copy();

    expect(text).toContain("edition=desktop");
    expect(text).not.toContain("spc_acme");
    expect(text).not.toContain("space=");
  });

  it("copies the body alone when no host wired an edition", async () => {
    // The chromeless mobile WebView and SSR-only hosts land here. Emitting a
    // guessed setup URL would point someone's agent at the wrong Busabase,
    // which is worse than handing it no guide at all.
    renderView(undefined);

    expect(await copy()).toBe(prompt.body);
  });

  it("says out loud that the copied text is longer than the preview", () => {
    const { unmount } = renderView({ edition: "cloud", targetSpaceId: "spc_acme" });
    expect(screen.getByText(/also appends a short connection check/)).toBeTruthy();
    unmount();

    renderView(undefined);
    expect(screen.queryByText(/also appends a short connection check/)).toBeNull();
  });
});
