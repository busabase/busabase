// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CoreI18nProvider, type CoreLocale } from "../../../i18n";
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
  source: "built-in-scenario",
  group: "Content",
  label: "Summarize this folder",
  body: 'Target: the Busabase Folder "Coder" (nodeId: nod_coder).\n\nReply to me in English.',
};

const secondPrompt: NodePrompt = {
  ...prompt,
  key: "folder-outline",
  label: "Outline this folder",
  body: 'Target: the Busabase Folder "Writer" (nodeId: nod_writer).',
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

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const renderView = (
  agentIntegration?: AgentIntegrationTarget,
  scenarios: NodePrompt[] = [prompt],
  locale: CoreLocale = "en",
) =>
  render(
    <CoreI18nProvider locale={locale}>
      <AgentPromptsView
        agentIntegration={agentIntegration}
        askAgent={null}
        capabilities={[]}
        onHandedOff={() => {}}
        scenarios={scenarios}
      />
    </CoreI18nProvider>,
  );

const copy = async () => {
  fireEvent.click(screen.getByRole("button", { name: "Copy" }));
  await vi.waitFor(() => expect(written).toHaveLength(1));
  return written[0] as string;
};

/**
 * Two scenarios (their own section) plus two capabilities split across two
 * capability groups (two more sections) — enough sections to prove
 * ArrowDown/ArrowUp cross section boundaries rather than stopping at the
 * end of whichever section currently has focus.
 */
const scenarioA: NodePrompt = {
  key: "scenario-a",
  tier: "scenario",
  source: "built-in-scenario",
  group: "Content",
  label: "Scenario A",
  body: "Body A",
};
const scenarioB: NodePrompt = {
  key: "scenario-b",
  tier: "scenario",
  source: "built-in-scenario",
  group: "Content",
  label: "Scenario B",
  body: "Body B",
};
const capabilityC: NodePrompt = {
  key: "capability-c",
  tier: "capability",
  source: "capability",
  group: "Read",
  label: "Capability C",
  body: "Body C",
};
const capabilityD: NodePrompt = {
  key: "capability-d",
  tier: "capability",
  source: "capability",
  group: "Write",
  label: "Capability D",
  body: "Body D",
};
const customScenario: NodePrompt = {
  key: "custom:custom-a",
  customKey: "custom-a",
  tier: "scenario",
  source: "custom-scenario",
  group: "Content",
  label: "Custom A",
  body: "Custom body",
};

const renderNavigableView = () =>
  render(
    <CoreI18nProvider locale="en">
      <AgentPromptsView
        askAgent={null}
        capabilities={[capabilityC, capabilityD]}
        onHandedOff={() => {}}
        scenarios={[scenarioA, scenarioB]}
      />
    </CoreI18nProvider>,
  );

describe("AgentPromptsView keyboard navigation", () => {
  it("ArrowDown moves selection and focus to the next prompt, across section boundaries", () => {
    renderNavigableView();

    const first = screen.getByRole("button", { name: "Scenario A" });
    const second = screen.getByRole("button", { name: "Scenario B" });
    const scrollIntoView = vi.fn();
    Object.defineProperty(second, "scrollIntoView", { value: scrollIntoView });
    first.focus();
    fireEvent.keyDown(first, { key: "ArrowDown" });

    expect(document.activeElement).toBe(second);
    expect(second.getAttribute("aria-current")).toBe("true");
    expect(scrollIntoView).toHaveBeenCalledWith({ block: "nearest" });

    fireEvent.keyDown(second, { key: "ArrowDown" });
    const third = screen.getByRole("button", { name: "Capability C" });
    expect(document.activeElement).toBe(third);
    expect(third.getAttribute("aria-current")).toBe("true");
  });

  it("ArrowUp moves selection and focus to the previous prompt", () => {
    renderNavigableView();

    const third = screen.getByRole("button", { name: "Capability C" });
    fireEvent.click(third);
    third.focus();
    fireEvent.keyDown(third, { key: "ArrowUp" });

    const second = screen.getByRole("button", { name: "Scenario B" });
    expect(document.activeElement).toBe(second);
  });

  it("wraps around at both ends of the flattened list", () => {
    renderNavigableView();

    const last = screen.getByRole("button", { name: "Capability D" });
    fireEvent.click(last);
    last.focus();
    fireEvent.keyDown(last, { key: "ArrowDown" });
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Scenario A" }));

    const first = screen.getByRole("button", { name: "Scenario A" });
    fireEvent.keyDown(first, { key: "ArrowUp" });
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Capability D" }));
  });

  it("keeps prompt buttons in the native Tab order while marking the active one", () => {
    renderNavigableView();

    expect(screen.getByRole("button", { name: "Scenario A" }).tabIndex).toBe(0);
    expect(screen.getByRole("button", { name: "Scenario B" }).tabIndex).toBe(0);
    expect(screen.getByRole("button", { name: "Capability C" }).tabIndex).toBe(0);
    expect(screen.getByRole("button", { name: "Capability D" }).tabIndex).toBe(0);
    expect(screen.getByRole("button", { name: "Scenario A" }).getAttribute("aria-current")).toBe(
      "true",
    );
  });

  it("does not hijack arrow keys from auxiliary controls inside the prompt list", () => {
    render(
      <CoreI18nProvider locale="en">
        <AgentPromptsView
          askAgent={null}
          capabilities={[capabilityC]}
          management={{
            canSave: true,
            customPrompts: [],
            save: vi.fn(),
            saving: false,
          }}
          onHandedOff={() => {}}
          scenarios={[scenarioA, scenarioB]}
        />
      </CoreI18nProvider>,
    );

    const addPrompt = screen.getByRole("button", { name: "Add prompt" });
    addPrompt.focus();
    fireEvent.keyDown(addPrompt, { key: "ArrowDown" });

    expect(document.activeElement).toBe(addPrompt);
    expect(screen.getByRole("button", { name: "Scenario A" }).getAttribute("aria-current")).toBe(
      "true",
    );
  });

  it("keeps the persistent actions menu keyboard-accessible without changing the active prompt", () => {
    render(
      <CoreI18nProvider locale="en">
        <AgentPromptsView
          askAgent={null}
          capabilities={[capabilityC]}
          management={{
            canSave: true,
            customPrompts: [
              { key: "custom-a", label: "Custom A", body: "Custom body", intent: "read-only" },
            ],
            save: vi.fn(),
            saving: false,
          }}
          onHandedOff={() => {}}
          scenarios={[customScenario, scenarioA]}
        />
      </CoreI18nProvider>,
    );

    const customPrompt = screen.getByRole("button", { name: "Custom A" });
    const actions = screen.getByRole("button", { name: "More actions" });
    actions.focus();
    fireEvent.keyDown(actions, { key: "ArrowDown" });

    expect(document.activeElement).toBe(screen.getByRole("menuitem", { name: "Copy prompt" }));
    expect(customPrompt.getAttribute("aria-current")).toBe("true");
  });
});

describe("AgentPromptsView copy", () => {
  it.each([
    ["en", "Copy", "Couldn't copy automatically — select the prompt preview and copy it manually."],
    [
      "ja",
      "Copy",
      "自動コピーに失敗しました——プロンプトのプレビューを選択して手動でコピーしてください。",
    ],
    ["zh-CN", "Copy", "自动复制失败——请选中提示词预览并手动复制。"],
    ["zh-TW", "Copy", "自動複製失敗——請選取提示詞預覽並手動複製。"],
  ] as const)("shows accurate manual-copy guidance in %s", async (locale, copyLabel, message) => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: () => Promise.reject(new Error("denied")),
      },
    });
    renderView(undefined, [prompt], locale);

    fireEvent.click(screen.getByRole("button", { name: copyLabel }));

    expect(await screen.findByText(message)).toBeTruthy();
  });

  it("labels and focuses the readonly prompt preview when clipboard write rejects", async () => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: () => Promise.reject(new Error("denied")),
      },
    });
    renderView(undefined);

    fireEvent.click(screen.getByRole("button", { name: "Copy" }));
    await screen.findByText(/select the prompt preview and copy it manually/);

    const snippet = screen.getByRole("textbox", { name: prompt.label }) as HTMLTextAreaElement;
    expect(snippet.readOnly).toBe(true);
    expect(document.activeElement).toBe(snippet);
  });

  it("clears stale success and failure feedback when a new prompt is selected", async () => {
    renderView(undefined, [prompt, secondPrompt]);

    fireEvent.click(screen.getByRole("button", { name: "Copy" }));
    expect(await screen.findByRole("button", { name: "Copied" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: secondPrompt.label }));

    expect(screen.queryByRole("button", { name: "Copied" })).toBeNull();
    expect(screen.queryByText(/select the prompt preview and copy it manually/)).toBeNull();
    expect(
      (screen.getByRole("textbox", { name: secondPrompt.label }) as HTMLTextAreaElement).value,
    ).toBe(secondPrompt.body);
  });

  it("removes stale success when a later clipboard write rejects", async () => {
    let calls = 0;
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: () => {
          calls += 1;
          return calls === 1 ? Promise.resolve() : Promise.reject(new Error("denied"));
        },
      },
    });
    renderView(undefined);

    fireEvent.click(screen.getByRole("button", { name: "Copy" }));
    fireEvent.click(await screen.findByRole("button", { name: "Copied" }));
    await screen.findByText(/select the prompt preview and copy it manually/);

    expect(screen.queryByRole("button", { name: "Copied" })).toBeNull();
  });

  it("cleans up the pending success timeout when the view unmounts", async () => {
    const setTimeout = vi.spyOn(window, "setTimeout");
    const clearTimeout = vi.spyOn(window, "clearTimeout");
    const { unmount } = renderView(undefined);

    fireEvent.click(screen.getByRole("button", { name: "Copy" }));
    await screen.findByRole("button", { name: "Copied" });
    const copyTimerIndex = setTimeout.mock.calls.findIndex(([, delay]) => delay === 1800);
    const copyTimer = setTimeout.mock.results[copyTimerIndex]?.value;
    expect(copyTimerIndex).toBeGreaterThanOrEqual(0);
    clearTimeout.mockClear();
    unmount();

    expect(clearTimeout).toHaveBeenCalledWith(copyTimer);
  });

  it("keeps an icon-and-label primary Copy control below the prompt body", () => {
    renderView(undefined);

    const copyButton = screen.getByRole("button", { name: "Copy" });
    const textarea = screen.getByRole("textbox");
    expect(copyButton.textContent).toBe("Copy");
    expect(copyButton.className).toContain("h-7");
    expect(copyButton.className).toContain("text-xs");
    expect(
      textarea.compareDocumentPosition(copyButton) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("uses the same copy state from the header menu and the primary Copy button", async () => {
    renderView(undefined);

    fireEvent.pointerDown(screen.getByRole("button", { name: "More actions" }), {
      button: 0,
      ctrlKey: false,
      pointerType: "mouse",
    });
    fireEvent.click(screen.getByRole("menuitem", { name: "Copy prompt" }));

    await vi.waitFor(() => expect(written).toHaveLength(1));
    expect(await screen.findByRole("button", { name: "Copied" })).toBeTruthy();
  });

  it("marks the selected prompt with aria-current for accessible inline selection", () => {
    renderView(undefined);

    const activeButton = screen.getByRole("button", { name: prompt.label });
    expect(activeButton.getAttribute("aria-current")).toBe("true");
  });

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

  it("does not show connection-check metadata in the compact prompt surface", () => {
    renderView({ edition: "cloud", targetSpaceId: "spc_acme" });

    expect(screen.queryByText(/also appends a short connection check/)).toBeNull();
  });
});
