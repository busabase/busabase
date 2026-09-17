// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { BusabaseQueryUtils } from "busabase-contract/api-client/react-query";
import type { BaseVO, RecordVO } from "busabase-contract/types";
import type { ComponentType, ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Router } from "wouter";
import { CoreI18nProvider } from "../../../i18n";
import { getSidePanelTab, type SidePanelTabProps } from "../side-panel-registry";
import { useSidePanelStore } from "../store/side-panel-store";
import { type DashboardVisitorKind, DashboardVisitorProvider } from "../visitor-context";

vi.mock("./node-agent-prompts-button", () => ({
  NodeAgentPromptsButton: () => <button type="button">Agent prompts</button>,
}));

const { RecordTopbarActions } = await import("./record-views");

const timestamp = "2026-09-16T08:00:00.000Z";
const customerBase = {
  id: "bas_customers",
  nodeId: "nod_customers",
  slug: "customers",
  name: "Customers",
  description: "",
  reviewPolicy: { kind: "single", requiredApprovals: 1 },
  createdAt: timestamp,
  fields: [
    {
      id: "fld_name",
      slug: "name",
      name: "Name",
      type: "text",
      required: true,
      options: {},
    },
    {
      id: "fld_email",
      slug: "email",
      name: "Email",
      type: "email",
      required: false,
      options: {},
    },
    {
      id: "fld_account",
      slug: "account",
      name: "Account",
      type: "relation",
      required: false,
      options: { multiple: false, targetBaseId: "bas_accounts" },
    },
  ],
} as unknown as BaseVO;

const record = {
  id: "rec_customer",
  baseId: customerBase.id,
  status: "active",
  createdBy: "user_preview",
  headCommitId: "cmt_customer",
  createdAt: timestamp,
  updatedAt: timestamp,
  base: customerBase,
  headCommit: {
    id: "cmt_customer",
    baseId: customerBase.id,
    targetType: "base",
    nodeId: customerBase.nodeId,
    operationId: "opr_customer",
    parentCommitId: null,
    payload: {
      name: "Ada Lovelace",
      email: "ada@example.com",
      account: "rec_account",
    },
    operation: "record_create",
    message: "Create customer",
    author: "user_preview",
    createdAt: timestamp,
  },
} as unknown as RecordVO;

const accountRecord = {
  ...record,
  id: "rec_account",
  baseId: "bas_accounts",
  headCommitId: "cmt_account",
  base: {
    ...customerBase,
    id: "bas_accounts",
    nodeId: "nod_accounts",
    slug: "accounts",
    name: "Accounts",
    fields: [customerBase.fields[0]],
  },
  headCommit: {
    ...record.headCommit,
    id: "cmt_account",
    baseId: "bas_accounts",
    nodeId: "nod_accounts",
    payload: { name: "Analytical Engines" },
  },
} as unknown as RecordVO;

const useStaticLocation = (): [string, (path: string) => void] => [
  "/base/customers/rec_customer",
  () => undefined,
];

const createOrpc = (getRecord: (recordId: string) => Promise<RecordVO>) =>
  ({
    records: {
      get: {
        queryOptions: ({ input }: { input: { recordId: string } }) => ({
          queryKey: ["records", "get", input.recordId],
          queryFn: () => getRecord(input.recordId),
        }),
      },
    },
  }) as unknown as BusabaseQueryUtils;

function Providers({
  children,
  visitorKind = "member",
}: {
  children: ReactNode;
  visitorKind?: DashboardVisitorKind;
}) {
  return (
    <CoreI18nProvider locale="en">
      <Router hook={useStaticLocation} searchHook={() => ""}>
        <DashboardVisitorProvider visitorKind={visitorKind}>{children}</DashboardVisitorProvider>
      </Router>
    </CoreI18nProvider>
  );
}

function renderPreview(orpc: BusabaseQueryUtils, recordId = record.id) {
  const renderer = getSidePanelTab("record-preview");
  if (!renderer) throw new Error("record-preview renderer was not registered");
  const Renderer = renderer as ComponentType<SidePanelTabProps>;
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <Providers>
      <QueryClientProvider client={queryClient}>
        <Renderer orpc={orpc} payload={{ recordId }} />
      </QueryClientProvider>
    </Providers>,
  );
}

afterEach(() => {
  cleanup();
  localStorage.clear();
  useSidePanelStore.setState({
    activeTabId: null,
    isOpen: false,
    layout: "split",
    tabs: [],
  });
});

describe("Record side-panel pinning", () => {
  it("opens one idempotent tab with the canonical record title and payload", () => {
    render(
      <Providers>
        <RecordTopbarActions
          activeTab="view"
          base={customerBase}
          record={record}
          recordId={record.id}
        />
      </Providers>,
    );

    const pin = screen.getByRole("button", { name: "Pin to side panel" });
    fireEvent.click(pin);
    fireEvent.click(pin);

    expect(useSidePanelStore.getState()).toMatchObject({
      activeTabId: "record-rec_customer",
      isOpen: true,
      tabs: [
        {
          id: "record-rec_customer",
          payload: { recordId: "rec_customer" },
          title: "Ada Lovelace",
          type: "record-preview",
        },
      ],
    });
  });

  it("does not offer workspace pinning to an anonymous visitor", () => {
    render(
      <Providers visitorKind="anonymous">
        <RecordTopbarActions
          activeTab="view"
          base={customerBase}
          record={record}
          recordId={record.id}
        />
      </Providers>,
    );

    expect(screen.queryByRole("button", { name: "Pin to side panel" })).toBeNull();
  });

  it("renders a loading state while the canonical record is pending", () => {
    renderPreview(createOrpc(() => new Promise<RecordVO>(() => undefined)));

    expect(screen.getByLabelText("Loading…").getAttribute("data-record-side-panel-loading")).toBe(
      "true",
    );
  });

  it("renders not found when the canonical record cannot be loaded", async () => {
    renderPreview(
      createOrpc(async () => {
        throw new Error("not found");
      }),
      "rec_missing",
    );

    expect(await screen.findByText("Record not found")).toBeTruthy();
    expect(screen.getByText("The requested canonical record does not exist.")).toBeTruthy();
  });

  it("renders the record title, field values, and resolved relation titles", async () => {
    renderPreview(
      createOrpc(async (recordId) => {
        if (recordId === record.id) return record;
        if (recordId === accountRecord.id) return accountRecord;
        throw new Error("not found");
      }),
    );

    expect(await screen.findByRole("heading", { name: "Ada Lovelace" })).toBeTruthy();
    expect(screen.getAllByText("Ada Lovelace")).toHaveLength(1);
    expect(screen.getByText("ada@example.com")).toBeTruthy();
    await waitFor(() => expect(screen.getByText("Analytical Engines")).toBeTruthy());
    expect(screen.queryByRole("button", { name: /delete/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /edit/i })).toBeNull();
  });
});
