// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import type { PlaybookAttributionVO } from "busabase-contract/types";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CoreI18nProvider } from "../../../i18n";

vi.mock("wouter", () => ({ useSearch: () => "" }));
vi.mock("openlib/ui/dashboard", () => ({
  SPALink: ({ children, ...props }: { children: ReactNode; href: string }) => (
    <a {...props}>{children}</a>
  ),
}));

const { PlaybookChip, getPlaybookHref } = await import("./playbook-chip");

const skill: PlaybookAttributionVO = {
  kind: "skill",
  accessible: true,
  nodeId: "nod_triage",
  key: null,
  nodeType: "skill",
  nodeSlug: "support-triage",
  label: "Support triage",
};

const prompt: PlaybookAttributionVO = {
  kind: "prompt",
  accessible: true,
  nodeId: "nod_crm",
  key: "weekly-review",
  nodeType: "base",
  nodeSlug: "crm",
  label: "Weekly review",
};

const hidden: PlaybookAttributionVO = {
  kind: "prompt",
  accessible: false,
  nodeId: null,
  key: null,
  nodeType: null,
  nodeSlug: null,
  label: null,
};

const renderChip = (
  playbook: PlaybookAttributionVO | null | undefined,
  { linked, locale = "en" }: { linked?: boolean; locale?: string } = {},
) =>
  render(
    <CoreI18nProvider locale={locale}>
      <PlaybookChip linked={linked} playbook={playbook} />
    </CoreI18nProvider>,
  );

afterEach(cleanup);

describe("PlaybookChip", () => {
  it("names a readable skill playbook and links to its node", () => {
    renderChip(skill);
    const link = screen.getByRole("link", { name: "via playbook “Support triage”" });
    expect(link.getAttribute("href")).toBe("/skill/support-triage");
    expect(link.getAttribute("title")).toBe("The playbook the agent followed to make this change");
  });

  it("links a prompt playbook to the node that carries the prompt", () => {
    renderChip(prompt);
    expect(
      screen.getByRole("link", { name: "via playbook “Weekly review”" }).getAttribute("href"),
    ).toBe("/base/crm");
  });

  it("says 'via a playbook' with no link when the reader cannot read the playbook", () => {
    renderChip(hidden);
    expect(screen.getByTestId("playbook-chip").textContent).toBe("via a playbook");
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("falls back to 'via a playbook' when an accessible playbook has no label", () => {
    renderChip({ ...skill, label: "  " });
    expect(screen.getByTestId("playbook-chip").textContent).toBe("via a playbook");
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("renders plain text (no nested link) when linked={false}, e.g. inside an inbox row", () => {
    renderChip(skill, { linked: false });
    expect(screen.getByTestId("playbook-chip").textContent).toBe("via playbook “Support triage”");
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("renders nothing when no playbook was recorded", () => {
    const { container } = renderChip(null);
    expect(container.textContent).toBe("");
    const { container: undefinedContainer } = renderChip(undefined);
    expect(undefinedContainer.textContent).toBe("");
  });

  it("localizes the label", () => {
    renderChip(skill, { locale: "zh-CN" });
    expect(screen.getByRole("link").textContent).toBe("通过做事手册「Support triage」");
  });
});

describe("getPlaybookHref", () => {
  it("returns null for node types without a detail screen and for hidden playbooks", () => {
    expect(getPlaybookHref(hidden)).toBeNull();
    expect(getPlaybookHref({ ...skill, nodeType: "no-such-type" })).toBeNull();
  });
});
