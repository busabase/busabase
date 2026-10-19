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
  targetFolderSlug: "example",
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
  locale: "zh-CN" | "ja",
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
    expect(await screen.findByText(messages.installFailed)).toBeTruthy();
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
    expect(await screen.findByText(messages.installFailed)).toBeTruthy();
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
    expect(await screen.findByText(messages.installFailed)).toBeTruthy();
    expect(installFromGithubStream.mock.calls[0]?.[0]).not.toHaveProperty("autoMerge");
  });
});
