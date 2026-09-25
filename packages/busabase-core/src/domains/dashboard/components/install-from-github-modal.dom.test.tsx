// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { BusabaseDashboardApiClient } from "busabase-contract/api-client";
import type { InstallEventVO, InstallPlanVO } from "busabase-contract/domains/install/types";
import * as React from "react";
import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CoreI18nProvider, coreMessagesByLocale } from "../../../i18n";
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

describe("InstallFromGithubModal diagnostic detail", () => {
  afterEach(cleanup);

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
