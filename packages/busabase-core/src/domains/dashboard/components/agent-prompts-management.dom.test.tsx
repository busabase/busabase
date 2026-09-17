// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { CustomAgentPrompts } from "busabase-contract/contract/node-agent-prompt-schemas";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CoreI18nProvider, type CoreLocale } from "../../../i18n";
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
  locale = "en",
}: {
  management?: AgentPromptsManagement;
  permission?: "read" | "changeRequest" | "write" | "manage";
  prompts?: NodePrompt[];
  locale?: CoreLocale;
} = {}) =>
  render(
    <CoreI18nProvider locale={locale}>
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

const openPromptActions = (name = "More actions") => {
  fireEvent.pointerDown(screen.getByRole("button", { name }), {
    button: 0,
    ctrlKey: false,
    pointerType: "mouse",
  });
};

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
    expect(screen.queryByRole("button", { name: "Actions for Review a draft" })).toBeNull();
    openPromptActions();
    expect(screen.getByRole("menuitem", { name: "Edit scenario" })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: "Delete scenario" })).toBeTruthy();
    expect(
      screen.queryByRole("button", {
        name: "Add prompt",
      }),
    ).toBeNull();

    cleanup();
    renderView({ permission: "changeRequest" });
    expect(screen.queryByRole("button", { name: "New prompt" })).toBeNull();
    openPromptActions();
    expect(screen.getByRole("menuitem", { name: "Copy prompt" })).toBeTruthy();
    expect(screen.queryByRole("menuitem", { name: "Edit scenario" })).toBeNull();
    expect(screen.queryByRole("menuitem", { name: "Delete scenario" })).toBeNull();
  });

  it("shows the active scenario title in the detail header", () => {
    renderView();

    const title = screen.getByTestId("agent-prompts-active-title");
    expect(title.textContent).toBe("Review a draft");
    expect(title.getAttribute("title")).toBe("Review a draft");
  });

  it("updates the detail title when another scenario is selected", () => {
    renderView();

    fireEvent.click(screen.getByRole("button", { name: "Use this skill" }));

    const title = screen.getByTestId("agent-prompts-active-title");
    expect(title.textContent).toBe("Use this skill");
    expect(title.getAttribute("title")).toBe("Use this skill");
  });

  it("truncates a long title without allowing it to shrink the toolbar actions", () => {
    const longLabel = "Review this unusually long research draft before publishing it externally";
    renderView({ prompts: [{ ...custom, label: longLabel }] });

    const title = screen.getByTestId("agent-prompts-active-title");
    const actions = screen.getByTestId("agent-prompts-toolbar-actions");
    expect(title.textContent).toBe(longLabel);
    expect(title.getAttribute("title")).toBe(longLabel);
    expect(title.className).toContain("min-w-0");
    expect(title.className).toContain("flex-1");
    expect(title.className).toContain("truncate");
    expect(actions.className).toContain("shrink-0");
    expect(actions.contains(screen.getByRole("button", { name: "More actions" }))).toBe(true);
    expect(screen.getByRole("button", { name: "Copy" })).toBeTruthy();
  });

  it("shows edit and delete in the persistent menu only while a custom scenario is active", () => {
    renderView();

    openPromptActions();
    const copy = screen.getByRole("menuitem", { name: "Copy prompt" });
    const edit = screen.getByRole("menuitem", { name: "Edit scenario" });
    const separator = screen.getByRole("separator");
    const remove = screen.getByRole("menuitem", { name: "Delete scenario" });
    expect(copy.compareDocumentPosition(edit) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(edit.compareDocumentPosition(separator) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(
      separator.compareDocumentPosition(remove) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });
    fireEvent.click(screen.getByRole("button", { name: "Use this skill" }));
    openPromptActions();
    expect(screen.getByRole("menuitem", { name: "Copy prompt" })).toBeTruthy();
    expect(screen.queryByRole("menuitem", { name: "Edit scenario" })).toBeNull();
    expect(screen.queryByRole("menuitem", { name: "Delete scenario" })).toBeNull();

    fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });
    fireEvent.click(screen.getByRole("button", { name: "Create skill file" }));
    openPromptActions();
    expect(screen.getByRole("menuitem", { name: "Copy prompt" })).toBeTruthy();
    expect(screen.queryByRole("menuitem", { name: "Edit scenario" })).toBeNull();
    expect(screen.queryByRole("menuitem", { name: "Delete scenario" })).toBeNull();
  });

  it("localizes the menu and keeps the requested English Copy label for the primary button", () => {
    renderView({ locale: "zh-CN" });

    expect(screen.getByRole("button", { name: "Copy" }).textContent).toBe("Copy");
    openPromptActions("更多操作");
    expect(screen.getByRole("menuitem", { name: "复制提示词" })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: "编辑场景" })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: "删除场景" })).toBeTruthy();
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

    openPromptActions();
    fireEvent.click(screen.getByRole("menuitem", { name: "Edit scenario" }));
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

    openPromptActions();
    fireEvent.click(screen.getByRole("menuitem", { name: "Delete scenario" }));
    expect(screen.getByText("Delete this custom scenario?")).toBeTruthy();
    const deleteButtons = screen.getAllByRole("button", { name: "Delete scenario" });
    fireEvent.click(deleteButtons.at(-1) as HTMLButtonElement);

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
