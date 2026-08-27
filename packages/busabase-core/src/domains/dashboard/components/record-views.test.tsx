import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { BusabaseDashboardApiClient } from "busabase-contract/api-client";
import type { RecordVO } from "busabase-contract/types";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Router } from "wouter";
import { CoreI18nProvider } from "../../../i18n";
import { DashboardVisitorProvider } from "../visitor-context";
import { RecordDetailView } from "./record-views";

Object.assign(globalThis, { React });

const timestamp = "2026-08-26T08:00:00.000Z";
const record = {
  id: "rec_preview",
  baseId: "bas_customers",
  status: "active",
  createdBy: "user_preview",
  headCommitId: "cmt_preview",
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
      {
        id: "fld_name",
        slug: "name",
        name: "Name",
        type: "text",
        required: true,
        options: {},
      },
    ],
  },
  headCommit: {
    id: "cmt_preview",
    baseId: "bas_customers",
    targetType: "base",
    nodeId: "nod_customers",
    operationId: "opr_preview",
    parentCommitId: null,
    payload: { name: "Acme" },
    operation: "record_create",
    message: "Create customer",
    author: "user_preview",
    createdAt: timestamp,
  },
} as unknown as RecordVO;

const client = {
  listRecordChangeRequests: async () => [],
} as unknown as BusabaseDashboardApiClient;

const useStaticLocation = (): [string, (path: string) => void] => [
  "/base/customers/rec_preview",
  () => undefined,
];

const renderRecord = (visitorKind: "anonymous" | "member") =>
  renderToStaticMarkup(
    <QueryClientProvider client={new QueryClient()}>
      <Router hook={useStaticLocation} searchHook={() => ""}>
        <CoreI18nProvider locale="en">
          <DashboardVisitorProvider visitorKind={visitorKind}>
            <RecordDetailView
              baseSlug="customers"
              client={client}
              onDeleteChangeRequest={async () => undefined}
              record={record}
              records={[record]}
            />
          </DashboardVisitorProvider>
        </CoreI18nProvider>
      </Router>
    </QueryClientProvider>,
  );

describe("Record detail layout", () => {
  it("lets anonymous embed content fill the available width", () => {
    const markup = renderRecord("anonymous");

    expect(markup).toContain('class="min-w-0 w-full"');
    expect(markup).not.toContain("max-w-[860px]");
    expect(markup).not.toContain("lg:grid-cols-[minmax(0,1fr)_auto]");
  });

  it("preserves the constrained dashboard layout for members", () => {
    const markup = renderRecord("member");

    expect(markup).toContain("max-w-[860px]");
    expect(markup).toContain("lg:grid-cols-[minmax(0,1fr)_auto]");
  });
});
