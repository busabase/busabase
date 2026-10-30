// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { BusabaseDashboardApiClient } from "busabase-contract/api-client";
import type { RecordVO } from "busabase-contract/types";
import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { CoreI18nProvider } from "../../../i18n";
import { coreMessagesByLocale } from "../../../i18n/catalog";
import type { CoreLocale } from "../../../i18n/locales";
import { DashboardVisitorProvider } from "../visitor-context";
import { RecordDetailDialog } from "./record-detail-dialog";

const timestamp = "2026-10-26T08:00:00.000Z";
const record = {
  id: "rec_dialog",
  baseId: "bas_customers",
  status: "active",
  createdBy: "usr_dialog",
  headCommitId: "cmt_dialog",
  createdAt: timestamp,
  updatedAt: timestamp,
  base: {
    id: "bas_customers",
    nodeId: "nod_customers",
    slug: "customers",
    name: "Customers",
    description: "",
    reviewPolicy: { kind: "single", requiredApprovals: 1 },
    createdAt: timestamp,
    fields: [
      { id: "fld_name", slug: "name", name: "Name", type: "text", options: {} },
      { id: "fld_notes", slug: "notes", name: "Notes", type: "text", options: {} },
    ],
  },
  headCommit: {
    id: "cmt_dialog",
    baseId: "bas_customers",
    targetType: "base",
    parentCommitId: null,
    payload: { name: "Acme follow-up", notes: "Read the same record details here" },
    operation: "record_create",
    author: "usr_dialog",
    createdAt: timestamp,
  },
} as unknown as RecordVO;

// Only the data responses are fixtures; the Dialog, detail body and SPA links
// exercise the actual components rather than replacement renderers.
const client = {
  listRecordChangeRequests: async () => [],
  listComments: async () => [],
} as unknown as BusabaseDashboardApiClient;

const triggers: HTMLButtonElement[] = [];

afterEach(() => {
  cleanup();
  for (const trigger of triggers.splice(0)) trigger.remove();
});

function renderDialog(locale: CoreLocale = "en", visitorKind: "member" | "anonymous" = "member") {
  const location = memoryLocation({
    path: "/base/customers/calendar?space=tnl_test",
    record: true,
  });
  const trigger = document.createElement("button");
  trigger.textContent = "Calendar card";
  document.body.appendChild(trigger);
  triggers.push(trigger);
  trigger.focus();

  function Preview() {
    const [open, setOpen] = useState(true);
    return open ? (
      <RecordDetailDialog
        baseSlug="customers"
        client={client}
        onClose={() => setOpen(false)}
        onDeleteChangeRequest={async () => undefined}
        record={record}
        records={[record]}
        returnFocusTo={trigger}
      />
    ) : null;
  }

  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <Router hook={location.hook} searchHook={location.searchHook}>
        <CoreI18nProvider locale={locale}>
          <DashboardVisitorProvider visitorKind={visitorKind}>
            <Preview />
          </DashboardVisitorProvider>
        </CoreI18nProvider>
      </Router>
    </QueryClientProvider>,
  );
  return { location, trigger };
}

describe("record detail dialog", () => {
  it.each(["en", "zh-CN"] as const)(
    "shows a visible localized full-page link and the shared detail content in %s",
    (locale) => {
      const { location } = renderDialog(locale);
      const dialog = screen.getByRole("dialog", { name: "Acme follow-up" });
      const label = coreMessagesByLocale[locale].recordView.openFullPage;
      const fullPage = within(dialog).getByRole("link", { name: label });
      expect(fullPage.textContent).toBe(label);
      expect(fullPage.getAttribute("href")).toBe("/base/customers/rec_dialog?space=tnl_test");
      expect(within(dialog).getByText("Read the same record details here")).toBeTruthy();
      expect(
        within(dialog).getByRole("link", { name: coreMessagesByLocale[locale].recordView.edit }),
      ).toBeTruthy();

      fireEvent.click(fullPage);
      expect(location.history.at(-1)).toBe("/base/customers/rec_dialog?space=tnl_test");
    },
  );

  it("keeps the full-page link for anonymous readers and hides Edit", () => {
    renderDialog("en", "anonymous");
    const dialog = screen.getByRole("dialog", { name: "Acme follow-up" });
    expect(within(dialog).getByRole("link", { name: "Open full page" })).toBeTruthy();
    expect(within(dialog).queryByRole("link", { name: "Edit" })).toBeNull();
    expect(within(dialog).getByText("Read the same record details here")).toBeTruthy();
  });

  it.each(["button", "Escape"])(
    "closes through %s and returns focus to the calendar card",
    async (method) => {
      const { trigger, location } = renderDialog();
      const dialog = screen.getByRole("dialog", { name: "Acme follow-up" });
      if (method === "button") {
        fireEvent.click(within(dialog).getByRole("button", { name: "Close" }));
      } else {
        fireEvent.keyDown(document, { key: "Escape" });
      }
      await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
      await waitFor(() => expect(document.activeElement).toBe(trigger));
      expect(location.history).toEqual(["/base/customers/calendar?space=tnl_test"]);
    },
  );
});
