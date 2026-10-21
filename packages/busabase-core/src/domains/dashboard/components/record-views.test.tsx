// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { BusabaseDashboardApiClient } from "busabase-contract/api-client";
import type { BusabaseQueryUtils } from "busabase-contract/api-client/react-query";
import type { BaseFieldVO, RecordVO } from "busabase-contract/types";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Router } from "wouter";
import { CoreI18nProvider } from "../../../i18n";
import { validateRecordFields } from "../../base/field-rules";
import { DashboardOrpcProvider } from "../orpc-context";
import { DashboardVisitorProvider } from "../visitor-context";
import { normalizeEditorFieldValue, RecordDetailView, RecordEditorView } from "./record-views";

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

afterEach(cleanup);

const scoreField: BaseFieldVO = {
  id: "score",
  baseId: record.baseId,
  slug: "score",
  name: "Score",
  type: "number",
  required: false,
  options: {},
  position: 1,
};

const recordWithScore = (score: number | null, required = false): RecordVO => ({
  ...record,
  base: { ...record.base, fields: [...record.base.fields, { ...scoreField, required }] },
  headCommit: { ...record.headCommit, payload: { name: "Acme", score } },
});

describe("Numeric editor values", () => {
  it.each([null, undefined, "", "   ", "\t\n"])("normalizes blank %j to null", (value) => {
    const normalized = normalizeEditorFieldValue(scoreField, value);
    expect(normalized).toBeNull();
    expect(validateRecordFields({ score: normalized }, [scoreField])).toEqual([]);
    expect(
      validateRecordFields({ score: normalized }, [{ ...scoreField, required: true }]),
    ).toEqual([expect.objectContaining({ slug: "score", message: "Score is required" })]);
  });

  it.each([
    [0, 0],
    ["0", 0],
    [" 0 ", 0],
    [-3, -3],
    ["-12.5", -12.5],
    ["2.75", 2.75],
    ["1e2", 100],
  ])("normalizes valid %j to %j", (value, expected) => {
    const normalized = normalizeEditorFieldValue(scoreField, value);
    expect(normalized).toBe(expected);
    expect(
      validateRecordFields({ score: normalized }, [{ ...scoreField, required: true }]),
    ).toEqual([]);
  });

  it.each(["invalid", "12px", "1e999", Number.NaN, Infinity, false, true, [1], {}])(
    "preserves invalid %j so optional fields cannot silently clear it",
    (value) => {
      const normalized = normalizeEditorFieldValue(scoreField, value);
      expect(normalized).toBe(value);
      for (const required of [false, true]) {
        expect(validateRecordFields({ score: normalized }, [{ ...scoreField, required }])).toEqual([
          expect.objectContaining({ slug: "score", message: "Score must be a number" }),
        ]);
      }
    },
  );
});

describe("Record editor draft", () => {
  function editor(
    recordValue: RecordVO,
    submit = vi.fn().mockResolvedValue(undefined),
    onError = vi.fn(),
  ) {
    return (
      <Router hook={useStaticLocation} searchHook={() => ""}>
        <CoreI18nProvider locale="en">
          <RecordEditorView
            base={recordValue.base}
            client={client}
            mode="edit"
            record={recordValue}
            records={[recordValue]}
            onSubmitError={onError}
            onSubmitUpdate={submit}
          />
        </CoreI18nProvider>
      </Router>
    );
  }
  it.each([
    ["", null],
    ["0", 0],
    ["-12.5", -12.5],
  ])(
    "saves edited numeric input %j as %j without resending untouched fields",
    async (input, value) => {
      const submit = vi.fn().mockResolvedValue(undefined);
      render(editor(recordWithScore(80), submit));
      fireEvent.change(screen.getByLabelText("Score"), { target: { value: input } });
      fireEvent.click(screen.getByRole("button", { name: "Update Now" }));
      await waitFor(() => expect(submit).toHaveBeenCalledTimes(1));
      expect(submit.mock.calls[0]?.[1]).toEqual({ score: value });
    },
  );
  it("does not turn a cleared required number into zero to bypass validation", async () => {
    const submit = vi.fn().mockResolvedValue(undefined);
    const onError = vi.fn();
    render(editor(recordWithScore(80, true), submit, onError));
    fireEvent.change(screen.getByLabelText("Score"), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Update Now" }));
    expect(onError).toHaveBeenLastCalledWith(expect.stringContaining("Score"));
    expect(submit).not.toHaveBeenCalled();
  });
  it("a background refresh does not erase a dirty draft, but another record resets it", () => {
    const view = render(editor(record));
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Draft name" } });
    view.rerender(
      editor({ ...record, headCommit: { ...record.headCommit, payload: { name: "Server name" } } }),
    );
    expect((screen.getByLabelText("Name") as HTMLInputElement).value).toBe("Draft name");
    view.rerender(
      editor({
        ...record,
        id: "rec_other",
        headCommit: { ...record.headCommit, payload: { name: "Another record" } },
      }),
    );
    expect((screen.getByLabelText("Name") as HTMLInputElement).value).toBe("Another record");
  });
  it("failed saves preserve the draft and allow retry", async () => {
    const submit = vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValue(undefined);
    const onError = vi.fn();
    render(editor(record, submit, onError));
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Keep me" } });
    fireEvent.click(screen.getByRole("button", { name: "Update Now" }));
    await waitFor(() => expect(onError).toHaveBeenCalledWith("offline"));
    expect((screen.getByLabelText("Name") as HTMLInputElement).value).toBe("Keep me");
    fireEvent.click(screen.getByRole("button", { name: "Update Now" }));
    await waitFor(() => expect(submit).toHaveBeenCalledTimes(2));
    expect(submit.mock.calls[1]?.[1]).toEqual({ name: "Keep me" });
  });
  it("sends only edited fields so a refreshed untouched value cannot be overwritten", async () => {
    const submit = vi.fn().mockResolvedValue(undefined);
    const withScore = {
      ...record,
      base: {
        ...record.base,
        fields: [
          ...record.base.fields,
          {
            id: "score",
            slug: "score",
            name: "Score",
            type: "number",
            required: false,
            options: {},
            position: 1,
          },
        ],
      },
      headCommit: { ...record.headCommit, payload: { name: "Original", score: 80 } },
    } as RecordVO;
    const view = render(editor(withScore, submit));
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Draft name" } });
    view.rerender(
      editor(
        {
          ...withScore,
          headCommitId: "cmt_refreshed",
          headCommit: { ...withScore.headCommit, payload: { name: "Original", score: 90 } },
        },
        submit,
      ),
    );
    fireEvent.click(screen.getByRole("button", { name: "Update Now" }));
    await waitFor(() => expect(submit).toHaveBeenCalledTimes(1));
    expect(submit.mock.calls[0]?.[1]).toEqual({ name: "Draft name" });
    expect(submit.mock.calls[0]?.[0].headCommitId).toBe("cmt_preview");
  });
  it("cancelling the discard prompt keeps the editor draft", () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    render(editor(record));
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Keep me" } });
    fireEvent.click(screen.getByRole("link", { name: "Cancel" }));
    expect(confirm).toHaveBeenCalledWith("Discard unsaved changes and leave this record?");
    expect((screen.getByLabelText("Name") as HTMLInputElement).value).toBe("Keep me");
    confirm.mockRestore();
  });
});

const renderRecordShare = (publicState: "private" | "public" | "inherited") => {
  const baseNode = {
    id: record.base.nodeId,
    children: [],
    shared: publicState === "public",
    sharedViaAncestor: publicState === "inherited",
  };
  const orpc = {
    nodes: {
      list: {
        queryOptions: () => ({ queryKey: ["nodes", "list"], queryFn: async () => [baseNode] }),
      },
    },
  } as unknown as BusabaseQueryUtils;
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <DashboardOrpcProvider orpc={orpc}>
        <Router hook={useStaticLocation} searchHook={() => ""}>
          <CoreI18nProvider locale="en">
            <DashboardVisitorProvider visitorKind="member">
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
      </DashboardOrpcProvider>
    </QueryClientProvider>,
  );
  fireEvent.click(screen.getByRole("button", { name: "Share" }));
};

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

describe("Record sharing", () => {
  it("keeps the internal link copyable without offering a QR before public sharing is active", async () => {
    renderRecordShare("private");
    expect(await screen.findByRole("dialog")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Copy link" })).toBeTruthy();
    await waitFor(() => expect(screen.queryByRole("button", { name: "QR code" })).toBeNull());
  });

  it.each(["public", "inherited"] as const)(
    "offers the record QR when its Base is %s",
    async (publicState) => {
      renderRecordShare(publicState);
      expect(await screen.findByRole("button", { name: "QR code" })).toBeTruthy();
    },
  );
});
