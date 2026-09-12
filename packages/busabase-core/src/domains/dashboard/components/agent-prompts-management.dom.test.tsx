// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { CustomAgentPrompts } from "busabase-contract/contract/node-agent-prompt-schemas";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CoreI18nProvider } from "../../../i18n";
import type { NodePrompt } from "../helpers/node-agent-prompts";
import { type AgentPromptsManagement, AgentPromptsView } from "./agent-prompts-view";
import { SubmitPermissionProvider } from "./split-submit-button";

const builtIn: NodePrompt = {
  key: "skill-use",
  tier: "scenario",
  source: "built-in-scenario",
  group: "Content",
  label: "Use this skill",
  body: "Use the skill.",
};

const customDef = {
  key: "review-draft",
  intent: "change" as const,
  label: "Review a draft",
  body: "Review {target}.",
};

const custom: NodePrompt = {
  key: "custom:review-draft",
  customKey: "review-draft",
  tier: "scenario",
  source: "custom-scenario",
  group: "Content",
  label: "Review a draft",
  body: "Review the selected skill.",
};

const capability: NodePrompt = {
  key: "skill_file_create",
  tier: "capability",
  source: "capability",
  group: "Content",
  label: "Create skill file",
  body: "Create a file.",
};

const makeManagement = (
  overrides: Partial<AgentPromptsManagement> = {},
): AgentPromptsManagement => ({
  customPrompts: [customDef],
  canSave: true,
  saving: false,
  save: vi.fn(async () => {}),
  ...overrides,
});

const renderView = ({
  management = makeManagement(),
  permission = "manage",
  prompts = [builtIn, custom],
}: {
  management?: AgentPromptsManagement;
  permission?: "read" | "changeRequest" | "write" | "manage";
  prompts?: NodePrompt[];
} = {}) =>
  render(
    <CoreI18nProvider locale="en">
      <SubmitPermissionProvider permissionLevel={permission}>
        <AgentPromptsView
          askAgent={null}
          capabilities={[capability]}
          management={management}
          onHandedOff={() => {}}
          scenarios={prompts}
        />
      </SubmitPermissionProvider>
    </CoreI18nProvider>,
  );

describe("AgentPromptsView management", () => {
  afterEach(() => {
    cleanup();
    localStorage.clear();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("shows management actions only for custom scenarios and write-capable users", () => {
    renderView();

    const createButton = screen.getByRole("button", { name: "New prompt" });
    expect(createButton.textContent).toBe("");
    expect(screen.getByRole("button", { name: "Actions for Review a draft" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Actions for Use this skill" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Actions for Create skill file" })).toBeNull();
    expect(
      screen.queryByRole("button", {
        name: "Add prompt",
      }),
    ).toBeNull();

    cleanup();
    renderView({ permission: "changeRequest" });
    expect(screen.queryByRole("button", { name: "New prompt" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Actions for Review a draft" })).toBeNull();
  });

  it("uses the empty custom section as the create button", () => {
    renderView({
      management: makeManagement({ customPrompts: [] }),
      prompts: [builtIn],
    });

    expect(screen.queryByRole("button", { name: "New prompt" })).toBeNull();
    fireEvent.click(
      screen.getByRole("button", {
        name: "Add prompt",
      }),
    );
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "New scenario" })).toBeTruthy();
  });

  it("does not show an empty-state create button without write permission", () => {
    renderView({
      management: makeManagement({ customPrompts: [] }),
      permission: "read",
      prompts: [builtIn],
    });

    expect(
      screen.queryByRole("button", {
        name: "Add prompt",
      }),
    ).toBeNull();
    expect(screen.queryByRole("button", { name: "New prompt" })).toBeNull();
  });

  it("creates a scenario with the default change intent in the shared modal", async () => {
    const save = vi.fn(async (_prompts: CustomAgentPrompts) => {});
    renderView({ management: makeManagement({ save }) });

    fireEvent.click(screen.getByRole("button", { name: "New prompt" }));
    expect(screen.queryByRole("group", { name: "Agent access" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Read only" })).toBeNull();
    expect(screen.queryByRole("button", { name: "May make changes" })).toBeNull();
    fireEvent.change(screen.getByLabelText("Scenario name"), {
      target: { value: "Summarize findings" },
    });
    fireEvent.change(screen.getByLabelText("Prompt template"), {
      target: { value: "Summarize {target}." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add scenario" }));

    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    expect(save.mock.calls[0]?.[0].at(-1)).toMatchObject({
      intent: "change",
      label: "Summarize findings",
      body: "Summarize {target}.",
    });
  });

  it("edits a custom scenario in the same modal without changing its key", async () => {
    const save = vi.fn(async (_prompts: CustomAgentPrompts) => {});
    renderView({ management: makeManagement({ save }) });

    fireEvent.pointerDown(screen.getByRole("button", { name: "Actions for Review a draft" }), {
      button: 0,
      ctrlKey: false,
    });
    fireEvent.click(await screen.findByRole("menuitem", { name: "Edit" }));
    expect(screen.getByRole("group", { name: "Agent access" })).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Prompt template"), {
      target: { value: "Review and summarize {target}." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    expect(save.mock.calls[0]?.[0]).toEqual([
      { ...customDef, body: "Review and summarize {target}." },
    ]);
  });

  it("deletes a custom scenario only after confirmation", async () => {
    const save = vi.fn(async (_prompts: CustomAgentPrompts) => {});
    renderView({ management: makeManagement({ save }) });

    fireEvent.pointerDown(screen.getByRole("button", { name: "Actions for Review a draft" }), {
      button: 0,
      ctrlKey: false,
    });
    fireEvent.click(await screen.findByRole("menuitem", { name: "Delete scenario" }));
    expect(screen.getByText("Delete this custom scenario?")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Delete scenario" }));

    await waitFor(() => expect(save).toHaveBeenCalledWith([]));
  });

  it("keeps the modal draft and shows the API error when saving fails", async () => {
    const save = vi.fn(async () => {
      throw new Error("Server denied the update");
    });
    renderView({ management: makeManagement({ save }) });

    fireEvent.click(screen.getByRole("button", { name: "New prompt" }));
    fireEvent.change(screen.getByLabelText("Scenario name"), {
      target: { value: "Unpublished idea" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add scenario" }));

    await waitFor(() => expect(screen.getByText("Server denied the update")).toBeTruthy());
    expect(screen.getByDisplayValue("Unpublished idea")).toBeTruthy();
  });

  it("shows validation in the modal without submitting", () => {
    const save = vi.fn(async (_prompts: CustomAgentPrompts) => {});
    renderView({ management: makeManagement({ save }) });

    fireEvent.click(screen.getByRole("button", { name: "New prompt" }));
    fireEvent.change(screen.getByLabelText("Scenario name"), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Add scenario" }));

    expect(screen.getByText("Enter a scenario name.")).toBeTruthy();
    expect(save).not.toHaveBeenCalled();
  });

  it("keeps the compact list and previews the prioritized custom scenario", () => {
    renderView();

    expect(screen.getByRole("button", { name: "Use this skill" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Review a draft" })).toBeTruthy();
    expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe(
      "Review the selected skill.",
    );
  });
});
