// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { BusabaseDashboardApiClient } from "busabase-contract/api-client";
import type { InstallEventVO, InstallPlanVO } from "busabase-contract/domains/install/types";
import * as React from "react";
import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CoreI18nProvider } from "../../../i18n";
import { coreMessagesByLocale } from "../../../i18n/catalog";
import { InstallFromGithubModal } from "./install-from-github-modal";

Object.assign(globalThis, { React });

const plan: InstallPlanVO = {
  package: { name: "Example", description: "Example package", tags: [] },
  source: { owner: "busabase", repo: "example" },
  targetFolderSlug: "f-11111111-1111-4111-8111-111111111111",
  newFolder: { slug: "f-11111111-1111-4111-8111-111111111111", name: "Example" },
  nodes: [],
  counts: {
    folders: 0,
    docs: 0,
    bases: 0,
    records: 0,
    skills: 0,
    airapps: 0,
    drives: 0,
    files: 0,
  },
  collisions: [],
  warnings: [],
  requiresAutoMerge: false,
  applicable: true,
};

const renderInstall = (
  locale: "zh-CN" | "ja" | "en",
  overrides: Pick<BusabaseDashboardApiClient, "planInstallFromGithub" | "installFromGithubStream">,
) =>
  render(
    <CoreI18nProvider locale={locale}>
      <InstallFromGithubModal
        apiClient={overrides as BusabaseDashboardApiClient}
        initialRepoUrl="https://github.com/busabase/example"
        onInstalled={vi.fn()}
        onOpenChange={vi.fn()}
        open
      />
    </CoreI18nProvider>,
  );

// Radix FocusScope dispatches its unmount focus event on a setTimeout(0). Let it
// fire while jsdom is still alive, or it lands after teardown as an unhandled
// "parameter 1 is not of type 'Event'" error that fails the whole run.
const unmountAndFlushTimers = async () => {
  cleanup();
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
};

describe("InstallFromGithubModal diagnostic detail", () => {
  afterEach(unmountAndFlushTimers);

  it.each(["zh-CN", "ja"] as const)(
    "shows the server's actionable preview refusal in the %s interface",
    async (locale) => {
      const diagnostic = "Not a Busabase package: expected busabase.json at the repository root.";
      renderInstall(locale, {
        planInstallFromGithub: vi.fn().mockRejectedValue(new Error(diagnostic)),
        installFromGithubStream: vi.fn(),
      });

      expect(await screen.findByText(diagnostic)).toBeTruthy();
      expect(screen.queryByText(coreMessagesByLocale[locale].install.previewFailed)).toBeNull();
    },
  );

  it.each(["zh-CN", "ja"] as const)(
    "shows the %s install status with server progress, then retains the failure reason",
    async (locale) => {
      const progress = "Importing docs 4/7 into example…";
      const diagnostic = 'Cannot create Base "orders": the name is already in use.';
      let finishProgress = () => {};
      const waitForProgress = new Promise<void>((resolve) => {
        finishProgress = resolve;
      });
      const installFromGithubStream = vi.fn(
        async (): Promise<AsyncIterable<InstallEventVO>> =>
          (async function* () {
            yield { kind: "progress" as const, message: progress };
            await waitForProgress;
            throw new Error(diagnostic);
          })(),
      );
      renderInstall(locale, {
        planInstallFromGithub: vi.fn().mockResolvedValue(plan),
        installFromGithubStream,
      });

      try {
        fireEvent.click(
          await screen.findByRole("button", { name: coreMessagesByLocale[locale].install.install }),
        );
        expect(await screen.findByText(progress)).toBeTruthy();
        expect(screen.getByText(coreMessagesByLocale[locale].install.installingHint)).toBeTruthy();
        await act(async () => finishProgress());
        expect(await screen.findByText(diagnostic)).toBeTruthy();
        expect(screen.queryByText(coreMessagesByLocale[locale].install.installFailed)).toBeNull();
      } finally {
        finishProgress();
      }
    },
  );
});

describe("InstallFromGithubModal review choice", () => {
  afterEach(unmountAndFlushTimers);

  const messages = coreMessagesByLocale["zh-CN"].install;
  const emptyStream = async (_input: unknown): Promise<AsyncIterable<InstallEventVO>> =>
    (async function* () {})();

  it("leaves autoMerge to the server by default, so a manager's install goes live", async () => {
    const installFromGithubStream = vi.fn(emptyStream);
    renderInstall("zh-CN", {
      planInstallFromGithub: vi.fn().mockResolvedValue(plan),
      installFromGithubStream,
    });

    fireEvent.click(await screen.findByRole("button", { name: messages.install }));

    await vi.waitFor(() => expect(installFromGithubStream).toHaveBeenCalledTimes(1));
    // The stub stream ends without a result; wait for the dialog to settle on that.
    expect(await screen.findByText(messages.installUnknown)).toBeTruthy();
    expect(installFromGithubStream.mock.calls[0]?.[0]).not.toHaveProperty("autoMerge");
  });

  it("sends autoMerge: false only when the user opts into review", async () => {
    const installFromGithubStream = vi.fn(emptyStream);
    renderInstall("zh-CN", {
      planInstallFromGithub: vi.fn().mockResolvedValue(plan),
      installFromGithubStream,
    });

    fireEvent.click(
      await screen.findByRole("checkbox", { name: new RegExp(messages.requireReview) }),
    );
    fireEvent.click(screen.getByRole("button", { name: messages.install }));

    await vi.waitFor(() => expect(installFromGithubStream).toHaveBeenCalledTimes(1));
    // The stub stream ends without a result; wait for the dialog to settle on that.
    expect(await screen.findByText(messages.installUnknown)).toBeTruthy();
    expect(installFromGithubStream.mock.calls[0]?.[0]).toMatchObject({ autoMerge: false });
  });

  it("does not offer review for a package whose links need live records, and still installs it", async () => {
    const installFromGithubStream = vi.fn(emptyStream);
    renderInstall("zh-CN", {
      planInstallFromGithub: vi.fn().mockResolvedValue({ ...plan, requiresAutoMerge: true }),
      installFromGithubStream,
    });

    expect(await screen.findByText(messages.autoMergeRequiredTitle)).toBeTruthy();
    expect(screen.queryByText(messages.requireReview)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: messages.install }));

    await vi.waitFor(() => expect(installFromGithubStream).toHaveBeenCalledTimes(1));
    // The stub stream ends without a result; wait for the dialog to settle on that.
    expect(await screen.findByText(messages.installUnknown)).toBeTruthy();
    expect(installFromGithubStream.mock.calls[0]?.[0]).not.toHaveProperty("autoMerge");
  });
});

describe("InstallFromGithubModal plan preview", () => {
  afterEach(unmountAndFlushTimers);

  it("renders a root skill and an app that share the package slug without a duplicate key", async () => {
    // Real shape of e.g. b2b-crm: the root SKILL.md is folded in at
    // `path: <package slug>`, which is also the app's path.
    const sharedPath: InstallPlanVO = {
      ...plan,
      nodes: [
        { path: "b2b-crm", slug: "b2b-crm", name: "B2B CRM manual", type: "skill", depth: 0 },
        { path: "b2b-crm", slug: "b2b-crm", name: "B2B CRM app", type: "airapp", depth: 0 },
      ],
    };
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      renderInstall("zh-CN", {
        planInstallFromGithub: vi.fn().mockResolvedValue(sharedPath),
        installFromGithubStream: vi.fn(),
      });

      expect(await screen.findByText("B2B CRM manual")).toBeTruthy();
      expect(screen.getByText("B2B CRM app")).toBeTruthy();
      const keyWarnings = consoleError.mock.calls.filter((args) =>
        String(args[0]).includes("same key"),
      );
      expect(keyWarnings).toEqual([]);
    } finally {
      consoleError.mockRestore();
    }
  });
});

describe("InstallFromGithubModal independent multilingual folders", () => {
  afterEach(unmountAndFlushTimers);
  const messages = coreMessagesByLocale["zh-CN"].install;
  const created = {
    folders: 1,
    docs: 0,
    bases: 0,
    views: 0,
    records: 0,
    fileTreeNodes: 0,
    files: 0,
  };
  const doneStream = (name: string) =>
    (async function* (): AsyncGenerator<InstallEventVO> {
      yield {
        kind: "done",
        result: {
          targetFolderNodeId: "nod_installed",
          targetFolderSlug: plan.targetFolderSlug,
          targetFolderName: name,
          created,
          pendingChangeRequests: 0,
          warnings: [],
        },
      };
    })();

  it("defaults to the active locale's display name and never renders an address input", async () => {
    const planInstallFromGithub = vi.fn().mockResolvedValue({
      ...plan,
      package: { ...plan.package, displayName: { en: "Email desk", "zh-CN": "邮件工作台" } },
      nodes: [
        {
          type: "base",
          path: "contacts",
          slug: `${plan.targetFolderSlug}-contacts`,
          name: "联系人",
          depth: 0,
        },
      ],
    });
    renderInstall("zh-CN", { planInstallFromGithub, installFromGithubStream: vi.fn() });
    const name = await screen.findByRole("textbox", { name: messages.folderName });
    expect((name as HTMLInputElement).value).toBe("邮件工作台");
    expect(name.getAttribute("dir")).toBe("auto");
    expect(screen.queryByText(messages.targetFolder)).toBeNull();
    expect(screen.queryByDisplayValue(plan.targetFolderSlug)).toBeNull();
    expect(screen.queryByText(`${plan.targetFolderSlug}-contacts`)).toBeNull();
    expect(planInstallFromGithub.mock.calls[0]?.[0]).toMatchObject({ newFolder: {} });
    expect(planInstallFromGithub.mock.calls[0]?.[0]).not.toHaveProperty("intoFolder");
  });

  it.each([
    "Kelvin企业邮箱工作台",
    "チームの受信箱",
    "팀 메일함",
    "صندوق بريد الفريق",
    "Почта команды",
    "Équipe émail",
    "团队 Inbox 📬",
  ])("submits %s unchanged with the allocated slug and shows its name on success", async (name) => {
    const planInstallFromGithub = vi.fn().mockResolvedValue(plan);
    const installFromGithubStream = vi.fn(async (_input: unknown) => doneStream(name));
    renderInstall("zh-CN", { planInstallFromGithub, installFromGithubStream });
    fireEvent.change(await screen.findByRole("textbox", { name: messages.folderName }), {
      target: { value: name },
    });
    fireEvent.click(screen.getByRole("button", { name: messages.install }));
    expect(await screen.findByText(`已安装到 ${name}`)).toBeTruthy();
    expect(installFromGithubStream.mock.calls[0]?.[0]).toMatchObject({
      newFolder: { slug: plan.targetFolderSlug, name },
    });
    expect(installFromGithubStream.mock.calls[0]?.[0]).not.toHaveProperty("intoFolder");
    expect(planInstallFromGithub).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(plan.targetFolderSlug)).toBeNull();
  });

  it("keeps a blank name in place, associates its error, and focuses it without starting an install", async () => {
    const installFromGithubStream = vi.fn();
    renderInstall("zh-CN", {
      planInstallFromGithub: vi.fn().mockResolvedValue(plan),
      installFromGithubStream,
    });
    const input = await screen.findByRole("textbox", { name: messages.folderName });
    fireEvent.change(input, { target: { value: "   " } });
    fireEvent.click(screen.getByRole("button", { name: messages.install }));
    const error = await screen.findByText(messages.folderNameRequired);
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(input.getAttribute("aria-describedby")).toContain(error.id);
    expect(document.activeElement).toBe(input);
    expect(installFromGithubStream).not.toHaveBeenCalled();
  });

  it("puts a known failure outside the scrollable preview and keeps generated addresses in details", async () => {
    const diagnostic = `Cannot create folder ${plan.targetFolderSlug}: workspace quota exceeded.`;
    const failure = Object.assign(new Error(diagnostic), {
      data: {
        phase: "Pass 1/5 (structure)",
        targetFolderSlug: plan.targetFolderSlug,
        created: { ...created, folders: 0 },
        pendingChangeRequests: 0,
      },
    });
    renderInstall("zh-CN", {
      planInstallFromGithub: vi.fn().mockResolvedValue(plan),
      installFromGithubStream: vi.fn().mockRejectedValue(failure),
    });
    fireEvent.click(await screen.findByRole("button", { name: messages.install }));
    const error = await screen.findByRole("alert");
    expect(error.textContent).toContain("workspace quota exceeded");
    expect(error.textContent).toContain("Example");
    expect(error.textContent).not.toContain(plan.targetFolderSlug);
    expect(await screen.findByText(messages.installNoChanges)).toBeTruthy();
    expect(error.closest(".flex-1.overflow-y-auto")).toBeNull();
    const detail = screen.getByText(diagnostic).closest("details");
    expect(detail?.open).toBe(false);
    expect(screen.getByRole("button", { name: messages.install }).hasAttribute("disabled")).toBe(
      false,
    );
  });

  it("blocks an uncertain result instead of offering an immediate duplicate install", async () => {
    const installFromGithubStream = vi.fn(async () => (async function* () {})());
    renderInstall("zh-CN", {
      planInstallFromGithub: vi.fn().mockResolvedValue(plan),
      installFromGithubStream,
    });
    fireEvent.click(await screen.findByRole("button", { name: messages.install }));
    expect(await screen.findByText(messages.installUnknown)).toBeTruthy();
    expect(screen.getAllByText(messages.installUnknown)).toHaveLength(1);
    expect(screen.getByRole("alert").textContent).toBe(messages.installUnknown);
    expect(screen.queryByText(messages.installFailed)).toBeNull();
    const button = screen.getByRole("button", { name: messages.install });
    expect(button.hasAttribute("disabled")).toBe(true);
    fireEvent.click(button);
    expect(installFromGithubStream).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(messages.installNoChanges)).toBeNull();
  });

  it("refreshes the host after a partial failure without claiming that remaining content is known", async () => {
    const onInstalled = vi.fn();
    const failure = Object.assign(new Error("Record creation failed"), {
      data: {
        phase: "Pass 4/5 (sample records)",
        targetFolderSlug: plan.targetFolderSlug,
        created,
        pendingChangeRequests: 0,
      },
    });
    const apiClient = {
      planInstallFromGithub: vi.fn().mockResolvedValue(plan),
      installFromGithubStream: vi.fn().mockRejectedValue(failure),
    } as unknown as BusabaseDashboardApiClient;
    render(
      <CoreI18nProvider locale="zh-CN">
        <InstallFromGithubModal
          open
          apiClient={apiClient}
          initialRepoUrl="https://github.com/busabase/example"
          onInstalled={onInstalled}
          onOpenChange={vi.fn()}
        />
      </CoreI18nProvider>,
    );
    fireEvent.click(await screen.findByRole("button", { name: messages.install }));
    expect(await screen.findByText(messages.installPartial)).toBeTruthy();
    expect(screen.queryByText(messages.installNoChanges)).toBeNull();
    fireEvent.click(
      screen.getByRole("button", { name: coreMessagesByLocale["zh-CN"].common.cancel }),
    );
    expect(onInstalled).toHaveBeenCalledExactlyOnceWith(null);
  });

  it("starts one request while a streamed install is still in progress", async () => {
    let finish = () => {};
    const wait = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const installFromGithubStream = vi.fn(async () =>
      (async function* (): AsyncGenerator<InstallEventVO> {
        yield { kind: "progress", message: `Creating ${plan.targetFolderSlug}` };
        await wait;
      })(),
    );
    renderInstall("zh-CN", {
      planInstallFromGithub: vi.fn().mockResolvedValue(plan),
      installFromGithubStream,
    });
    const button = await screen.findByRole("button", { name: messages.install });
    try {
      fireEvent.click(button);
      fireEvent.click(button);
      await screen.findByRole("status");
      expect(installFromGithubStream).toHaveBeenCalledTimes(1);
      expect(
        screen.queryByText(`Creating ${plan.targetFolderSlug}`)?.closest("details")?.open,
      ).toBe(false);
    } finally {
      await act(async () => finish());
    }
  });

  it("does not fall back to a legacy target when the server lacks the new-folder capability", async () => {
    const { newFolder: _newFolder, ...legacyPlan } = plan;
    const installFromGithubStream = vi.fn();
    renderInstall("zh-CN", {
      planInstallFromGithub: vi.fn().mockResolvedValue(legacyPlan),
      installFromGithubStream,
    });
    expect(await screen.findByText(messages.installUnavailable)).toBeTruthy();
    expect(screen.queryByRole("button", { name: messages.install })).toBeNull();
    expect(installFromGithubStream).not.toHaveBeenCalled();
  });

  it.each(["name", "slug"] as const)(
    "maps only a server-rejected name to the name field (%s)",
    async (field) => {
      const failure = Object.assign(new Error("Input validation failed"), {
        data: { issues: [{ path: ["newFolder", field], message: "Invalid input" }] },
      });
      renderInstall("zh-CN", {
        planInstallFromGithub: vi.fn().mockResolvedValue(plan),
        installFromGithubStream: vi.fn().mockRejectedValue(failure),
      });
      const input = await screen.findByRole("textbox", { name: messages.folderName });
      fireEvent.click(screen.getByRole("button", { name: messages.install }));
      if (field === "name") {
        expect(await screen.findByText(messages.folderNameRequired)).toBeTruthy();
        expect(document.activeElement).toBe(input);
        expect(input.getAttribute("aria-invalid")).toBe("true");
      } else {
        expect(await screen.findByText(messages.installUnknown)).toBeTruthy();
        expect(screen.queryByText(messages.folderNameRequired)).toBeNull();
        expect(input.getAttribute("aria-invalid")).toBe("false");
      }
    },
  );

  it("ignores a delayed preview after the host closes the dialog externally", async () => {
    let finishFirst = (_plan: InstallPlanVO) => {};
    const first = new Promise<InstallPlanVO>((resolve) => {
      finishFirst = resolve;
    });
    const next = {
      ...plan,
      newFolder: { slug: "f-reopened", name: "Reopened" },
      package: { ...plan.package, name: "Reopened" },
    };
    const planInstallFromGithub = vi.fn().mockReturnValueOnce(first).mockResolvedValueOnce(next);
    const apiClient = {
      planInstallFromGithub,
      installFromGithubStream: vi.fn(),
    } as unknown as BusabaseDashboardApiClient;
    const view = (open: boolean) => (
      <CoreI18nProvider locale="zh-CN">
        <InstallFromGithubModal
          open={open}
          apiClient={apiClient}
          initialRepoUrl="https://github.com/busabase/example"
          onInstalled={vi.fn()}
          onOpenChange={vi.fn()}
        />
      </CoreI18nProvider>
    );
    const { rerender } = render(view(true));
    await vi.waitFor(() => expect(planInstallFromGithub).toHaveBeenCalledTimes(1));
    rerender(view(false));
    await act(async () => finishFirst(plan));
    expect(screen.queryByRole("textbox", { name: messages.folderName })).toBeNull();
    rerender(view(true));
    const input = await screen.findByRole("textbox", { name: messages.folderName });
    expect((input as HTMLInputElement).value).toBe("Reopened");
    expect(planInstallFromGithub.mock.calls[1]?.[0]).toMatchObject({ newFolder: {} });
  });

  it("invalidates an in-flight preview when the host switches its space-bound client", async () => {
    let finishFirst = (_plan: InstallPlanVO) => {};
    const first = new Promise<InstallPlanVO>((resolve) => {
      finishFirst = resolve;
    });
    const firstClient = {
      planInstallFromGithub: vi.fn().mockReturnValue(first),
      installFromGithubStream: vi.fn(),
    } as unknown as BusabaseDashboardApiClient;
    const next = {
      ...plan,
      newFolder: { slug: "f-other-space", name: "Other space" },
      package: { ...plan.package, name: "Other space" },
    };
    const nextClient = {
      planInstallFromGithub: vi.fn().mockResolvedValue(next),
      installFromGithubStream: vi.fn(),
    } as unknown as BusabaseDashboardApiClient;
    const view = (apiClient: BusabaseDashboardApiClient) => (
      <CoreI18nProvider locale="zh-CN">
        <InstallFromGithubModal
          open
          apiClient={apiClient}
          initialRepoUrl="https://github.com/busabase/example"
          onInstalled={vi.fn()}
          onOpenChange={vi.fn()}
        />
      </CoreI18nProvider>
    );
    const { rerender } = render(view(firstClient));
    await vi.waitFor(() => expect(firstClient.planInstallFromGithub).toHaveBeenCalledTimes(1));
    rerender(view(nextClient));
    const input = await screen.findByRole("textbox", { name: messages.folderName });
    expect((input as HTMLInputElement).value).toBe("Other space");
    await act(async () => finishFirst(plan));
    expect((input as HTMLInputElement).value).toBe("Other space");
    fireEvent.click(screen.getByRole("button", { name: messages.install }));
    await vi.waitFor(() => expect(nextClient.installFromGithubStream).toHaveBeenCalledTimes(1));
    expect(firstClient.installFromGithubStream).not.toHaveBeenCalled();
  });

  it("starts a fresh allocation on reopen and ignores the first dialog's delayed preview", async () => {
    let finishFirst = (_plan: InstallPlanVO) => {};
    const first = new Promise<InstallPlanVO>((resolve) => {
      finishFirst = resolve;
    });
    const next = {
      ...plan,
      newFolder: { slug: "f-second", name: "Second" },
      package: { ...plan.package, name: "Second" },
    };
    const planInstallFromGithub = vi.fn().mockReturnValueOnce(first).mockResolvedValueOnce(next);
    const apiClient = {
      planInstallFromGithub,
      installFromGithubStream: vi.fn(),
    } as unknown as BusabaseDashboardApiClient;
    function Host() {
      const [open, setOpen] = React.useState(true);
      return (
        <CoreI18nProvider locale="zh-CN">
          <button type="button" onClick={() => setOpen(true)}>
            Reopen
          </button>
          <InstallFromGithubModal
            open={open}
            onOpenChange={setOpen}
            apiClient={apiClient}
            initialRepoUrl="https://github.com/busabase/example"
            onInstalled={vi.fn()}
          />
        </CoreI18nProvider>
      );
    }
    render(<Host />);
    await vi.waitFor(() => expect(planInstallFromGithub).toHaveBeenCalledTimes(1));
    fireEvent.click(
      screen.getByRole("button", { name: coreMessagesByLocale["zh-CN"].common.cancel }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Reopen" }));
    const input = await screen.findByRole("textbox", { name: messages.folderName });
    expect((input as HTMLInputElement).value).toBe("Second");
    await act(async () => finishFirst(plan));
    expect((input as HTMLInputElement).value).toBe("Second");
    expect(planInstallFromGithub).toHaveBeenCalledTimes(2);
    expect(planInstallFromGithub.mock.calls[1]?.[0]).toMatchObject({ newFolder: {} });
  });
});
