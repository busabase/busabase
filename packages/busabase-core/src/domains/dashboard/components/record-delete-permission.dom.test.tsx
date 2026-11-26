// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ApiKeyPermissionLevel } from "busabase-contract/access-control/api-key-level";
import type { BusabaseDashboardApiClient } from "busabase-contract/api-client";
import type { BaseFieldVO, RecordVO } from "busabase-contract/types";
import * as React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { CoreI18nProvider } from "../../../i18n";
import { DashboardVisitorProvider } from "../visitor-context";
import { RecordDetailView } from "./record-views";
import { SubmitPermissionProvider } from "./split-submit-button";

// The record page's delete actions follow the viewer's level on the Base: the
// server refuses a read-only proposal, so the menu must not offer one — and a
// refusal that still happens must be shown, not swallowed.
const toastError = vi.hoisted(() => vi.fn());
vi.mock("sonner", async (importOriginal) => {
  const actual = await importOriginal<typeof import("sonner")>();
  return { ...actual, toast: Object.assign(vi.fn(), { ...actual.toast, error: toastError }) };
});

Object.assign(globalThis, { React });

const timestamp = "2026-11-01T09:00:00.000Z";
const field = (slug: string, name: string, position: number): BaseFieldVO => ({
  id: `fld_${slug}`,
  baseId: "bas_deals",
  slug,
  name,
  type: "text",
  required: false,
  options: {},
  position,
});
const record = {
  id: "rec_deal",
  baseId: "bas_deals",
  status: "active",
  createdBy: "usr_kelly",
  headCommitId: "cmt_head",
  parentRecordId: null,
  parentCommitId: null,
  archivedAt: null,
  createdAt: timestamp,
  updatedAt: timestamp,
  base: {
    id: "bas_deals",
    nodeId: "nod_deals",
    slug: "deals",
    name: "Deals",
    description: "",
    reviewPolicy: { kind: "single", requiredApprovals: 1 },
    createdAt: timestamp,
    fields: [field("name", "Name", 0)],
  },
  headCommit: {
    id: "cmt_head",
    baseId: "bas_deals",
    targetType: "base",
    nodeId: null,
    operationId: null,
    parentCommitId: null,
    payload: { name: "Acme" },
    operation: "record_create",
    message: "Add Acme",
    author: "usr_kelly",
    createdAt: timestamp,
  },
} as unknown as RecordVO;

afterEach(() => {
  cleanup();
  toastError.mockReset();
});

const renderDetail = (options: {
  basePermissionLevel?: ApiKeyPermissionLevel;
  workspaceLevel: ApiKeyPermissionLevel;
  onDeleteChangeRequest?: () => Promise<void>;
}) => {
  const client = {
    listRecordChangeRequests: vi.fn(async () => []),
    listComments: vi.fn(async () => []),
  };
  const location = memoryLocation({ path: "/base/deals/rec_deal" });
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <Router hook={location.hook} searchHook={location.searchHook}>
        <CoreI18nProvider locale="en">
          <DashboardVisitorProvider visitorKind="member">
            <SubmitPermissionProvider permissionLevel={options.workspaceLevel}>
              <RecordDetailView
                basePermissionLevel={options.basePermissionLevel}
                baseSlug="deals"
                client={client as unknown as BusabaseDashboardApiClient}
                onDeleteChangeRequest={options.onDeleteChangeRequest ?? (async () => undefined)}
                record={record}
                records={[record]}
              />
            </SubmitPermissionProvider>
          </DashboardVisitorProvider>
        </CoreI18nProvider>
      </Router>
    </QueryClientProvider>,
  );
};

const deleteItems = () => [
  screen.queryByRole("button", { name: "Delete change request" }),
  screen.queryByRole("button", { name: "Delete & merge" }),
];

describe("record page delete actions", () => {
  it("are not offered to a read-only workspace viewer", () => {
    renderDetail({ workspaceLevel: "read" });
    expect(deleteItems()).toEqual([null, null]);
    // The menu itself (Activity) is still there.
    expect(screen.getByRole("button", { name: "Activity" })).toBeTruthy();
  });

  it("follow a read grant on the Base even for a workspace member", () => {
    renderDetail({ workspaceLevel: "write", basePermissionLevel: "read" });
    expect(deleteItems()).toEqual([null, null]);
  });

  it("are offered to a member who may propose changes on the Base", () => {
    renderDetail({ workspaceLevel: "read", basePermissionLevel: "changeRequest" });
    expect(deleteItems().every(Boolean)).toBe(true);
  });

  it("show the refusal when the server still says no", async () => {
    renderDetail({
      workspaceLevel: "write",
      onDeleteChangeRequest: async () => {
        throw Object.assign(new Error("Requires changeRequest access on this node"), {
          code: "FORBIDDEN",
        });
      },
    });
    fireEvent.click(screen.getByRole("button", { name: "Delete change request" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Create delete request" }));
    await waitFor(() => expect(toastError).toHaveBeenCalledTimes(1));
    expect(String(toastError.mock.calls[0]?.[0])).toContain("changeRequest");
  });
});
