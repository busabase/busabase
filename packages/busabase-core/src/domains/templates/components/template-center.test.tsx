import type { ApiKeyPermissionLevel } from "busabase-contract/access-control/api-key-level";
import type { BusabaseDashboardApiClient } from "busabase-contract/api-client";
import type { BusabaseQueryUtils } from "busabase-contract/api-client/react-query";
import type { TemplateCardVO } from "busabase-contract/domains/templates/types";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { coreMessagesEn } from "../../../i18n/messages";
import { SubmitPermissionProvider } from "../../dashboard/components/split-submit-button";
import { TemplateCenter } from "./template-center";

Object.assign(globalThis, { React });

const template: TemplateCardVO = {
  id: "busabase/templates/templates/busa-email",
  name: "busa-email",
  description: "Email operations workspace",
  category: "Operations",
  tags: [],
  screenshots: [],
  agentPrompts: [],
  stats: { folders: 1, docs: 1, bases: 2, records: 3, files: 0, airapps: 1, skill: true },
  install: {
    repoUrl: "https://github.com/busabase/templates/tree/main/templates/busa-email",
    intoFolder: "busa-email",
  },
  sourceUrl: "https://github.com/busabase/templates/tree/main/templates/busa-email",
};

vi.mock("@tanstack/react-query", () => ({
  useQuery: () => ({ data: { templates: [template] }, isPending: false, isError: false }),
}));

const orpc = {
  templates: { list: { queryOptions: () => ({}) } },
} as unknown as BusabaseQueryUtils;
const apiClient = {} as BusabaseDashboardApiClient;

const renderDetail = (level: ApiKeyPermissionLevel) =>
  renderToStaticMarkup(
    <SubmitPermissionProvider permissionLevel={level}>
      <TemplateCenter
        orpc={orpc}
        apiClient={apiClient}
        selectedName="busa-email"
        onSelect={() => {}}
        onBack={() => {}}
        onInstalled={() => {}}
        onReviewChangeRequests={() => {}}
      />
    </SubmitPermissionProvider>,
  );

// The detail page's primary action; other buttons (Back) carry no `disabled`.
const installButton = (markup: string) =>
  markup.match(/<button(?:(?!<button)[\s\S])*?>Install<\/button>/)?.[0] ?? "";
const escapeHtml = (text: string) => text.replaceAll("'", "&#x27;");
const isDisabled = (button: string) => /\sdisabled(=""|\s|>)/.test(button);

describe("TemplateCenter install gate", () => {
  // Mirrors `requireWriteForInstall`: the bar is workspace `write`, which a
  // Cloud member holds — not `manage`, which only owners and admins do.
  it("lets a member (write) install", () => {
    const markup = renderDetail("write");
    expect(installButton(markup)).not.toBe("");
    expect(isDisabled(installButton(markup))).toBe(false);
    expect(markup).not.toContain(escapeHtml(coreMessagesEn.templates.installRestricted));
  });

  it("explains instead of offering install to a read-only member", () => {
    const markup = renderDetail("read");
    expect(isDisabled(installButton(markup))).toBe(true);
    expect(markup).toContain(escapeHtml(coreMessagesEn.templates.installRestricted));
  });
});
