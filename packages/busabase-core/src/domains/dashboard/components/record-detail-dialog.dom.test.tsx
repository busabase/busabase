// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { BusabaseDashboardApiClient } from "busabase-contract/api-client";
import type { RecordVO } from "busabase-contract/types";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { CoreI18nProvider } from "../../../i18n";
import { coreMessagesByLocale } from "../../../i18n/catalog";
import type { CoreLocale } from "../../../i18n/locales";
import { SourceViewProvider } from "../helpers/source-view-context";
import { DashboardVisitorProvider } from "../visitor-context";
import { RecordDetailDialog } from "./record-detail-dialog";

vi.mock(
  "previewfile-core/client/embedded/lazy",
  () => import("../../../../tests/mocks/embedded-file-viewer"),
);

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

afterEach(async () => {
  cleanup();
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  for (const trigger of triggers.splice(0)) trigger.remove();
});

function renderDialog(
  locale: CoreLocale = "en",
  visitorKind: "member" | "anonymous" = "member",
  state: {
    record?: RecordVO | null;
    records?: RecordVO[];
    isLoading?: boolean;
    path?: string;
    sourceView?: string | null;
    onClose?: () => void;
  } = {},
) {
  const location = memoryLocation({
    path: state.path ?? "/base/customers/calendar?space=tnl_test",
    record: true,
  });
  const trigger = document.createElement("button");
  trigger.textContent = "Calendar card";
  document.body.appendChild(trigger);
  triggers.push(trigger);
  trigger.focus();

  function Preview() {
    const [open, setOpen] = useState(true);
    const previewRecord = state.record === undefined ? record : state.record;
    const preview = (
      <RecordDetailDialog
        key={previewRecord?.id ?? "loading"}
        baseSlug="customers"
        client={client}
        onClose={() => {
          state.onClose?.();
          setOpen(false);
        }}
        isLoading={state.isLoading}
        onDeleteChangeRequest={async () => undefined}
        record={previewRecord}
        records={state.records ?? [record]}
        returnFocusTo={trigger}
      />
    );
    if (!open) return null;
    return state.sourceView === undefined ? (
      preview
    ) : (
      <SourceViewProvider slug={state.sourceView}>{preview}</SourceViewProvider>
    );
  }

  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const show = () => (
    <QueryClientProvider client={queryClient}>
      <Router hook={location.hook} searchHook={location.searchHook}>
        <CoreI18nProvider locale={locale}>
          <DashboardVisitorProvider visitorKind={visitorKind}>
            <Preview />
          </DashboardVisitorProvider>
        </CoreI18nProvider>
      </Router>
    </QueryClientProvider>
  );
  const view = render(show());
  return { location, trigger, unmount: view.unmount, rerender: () => view.rerender(show()) };
}

const simulateRecordAnimation = () => {
  vi.stubGlobal("CSS", { escape: (value: string) => value });
  const getStyles = window.getComputedStyle.bind(window);
  vi.spyOn(window, "getComputedStyle").mockImplementation((element, pseudoElement) => {
    const styles = getStyles(element, pseudoElement);
    if (element.getAttribute("data-testid") === "record-detail-dialog") {
      Object.defineProperty(styles, "animationName", {
        configurable: true,
        get: () =>
          element.getAttribute("data-state") === "closed"
            ? "busabase-dialog-out"
            : "busabase-dialog-in",
      });
    }
    return styles;
  });
};

const finishRecordAnimation = (dialog: HTMLElement) => {
  const event = new Event("animationend", { bubbles: true });
  Object.defineProperty(event, "animationName", { value: "busabase-dialog-out" });
  fireEvent(dialog, event);
};

describe("record detail dialog", () => {
  it("preserves the URL source on record links when no view provider is mounted", () => {
    renderDialog("en", "member", {
      path: "/base/customers/calendar?space=tnl_test&fromView=calendar",
    });
    const link = screen.getByRole("link", { name: "Open full page" });
    expect(
      new URL(link.getAttribute("href") ?? "", "http://localhost").searchParams.get("fromView"),
    ).toBe("calendar");
  });

  it("honors an explicit no-source provider instead of inheriting another Base's URL source", () => {
    renderDialog("en", "member", {
      path: "/base/other/board?space=tnl_test&demo=1&view=review&fromView=board",
      sourceView: null,
    });
    const link = screen.getByRole("link", { name: "Open full page" });
    const href = new URL(link.getAttribute("href") ?? "", "http://localhost");
    expect(href.pathname).toBe("/base/customers/rec_dialog");
    expect(Object.fromEntries(href.searchParams)).toEqual({
      space: "tnl_test",
      demo: "1",
      view: "review",
    });
  });

  it.each(["relation", "lookup"] as const)(
    "shows all 21 %s values and opens all 22 from a list icon",
    (kind) => {
      const linked = Array.from(
        { length: 22 },
        (_, index): RecordVO => ({
          ...record,
          id: `rec_many_${index}`,
          headCommit: { ...record.headCommit, payload: { name: `Customer ${index + 1}` } },
        }),
      );
      const makeRecord = (count: number): RecordVO => {
        const field = {
          ...record.base.fields[0],
          id: "fld_many",
          slug: "many",
          name: "Many values",
          type: kind,
          options:
            kind === "lookup"
              ? {
                  lookup: {
                    relationFieldSlug: "customers",
                    targetFieldSlug: "name",
                    rollup: "values" as const,
                  },
                }
              : {},
        };
        return {
          ...record,
          base: { ...record.base, fields: [...record.base.fields, field] },
          headCommit: {
            ...record.headCommit,
            payload: {
              ...record.headCommit.payload,
              many: kind === "relation" ? linked.slice(0, count).map((item) => item.id) : [],
            },
          },
          ...(kind === "lookup"
            ? {
                computedFields: {
                  many: {
                    status: "ready",
                    value: linked.slice(0, count).map((item) => item.headCommit.payload.name),
                    targetField: record.base.fields[0],
                    sources: [],
                    dependencyVersion: "v1",
                  },
                },
              }
            : {}),
        } as RecordVO;
      };
      renderDialog("en", "member", { record: makeRecord(21), records: linked });
      expect(screen.queryByTestId("record-collection-count-many")).toBeNull();
      expect(document.querySelector('[data-record-field-slug="many"]')?.textContent).toContain(
        "Customer 21",
      );
      cleanup();
      renderDialog("en", "member", { record: makeRecord(22), records: linked });
      const count = screen.getByTestId("record-collection-count-many");
      expect(count.getAttribute("aria-label")).toContain("22");
      expect(count.textContent).toBe("");
      expect(count.parentElement?.textContent).toContain("Customer 20");
      expect(screen.queryByTestId("lookup-sources-many")).toBeNull();
      expect(document.querySelector('[data-record-field-slug="many"]')?.textContent).toContain(
        "Customer 20",
      );
      expect(document.querySelector('[data-record-field-slug="many"]')?.textContent).not.toContain(
        "Customer 21",
      );
      fireEvent.click(count);
      const dialog = screen.getByTestId("record-collection-dialog");
      expect(dialog.textContent).toContain("Customer 22");
      expect(dialog.textContent).toContain("Customer 1");
      if (kind === "lookup") {
        expect(within(dialog).getByTestId("lookup-sources-many")).toBeTruthy();
      }
    },
  );

  it.each(["sum", "values"] as const)(
    "keeps lookup provenance reachable for a small %s result",
    (rollup) => {
      const targetField = {
        ...record.base.fields[0],
        type: "number" as const,
        slug: "fee",
        name: "Fee",
      };
      const field = {
        ...record.base.fields[0],
        slug: "course_fees",
        name: "Course fees",
        type: "lookup" as const,
        options: {
          lookup: { relationFieldSlug: "courses", targetFieldSlug: "fee", rollup },
        },
      };
      renderDialog("en", "member", {
        record: {
          ...record,
          base: { ...record.base, fields: [record.base.fields[0], field] },
          computedFields: {
            course_fees: {
              status: "ready",
              value: rollup === "sum" ? 30 : [10, 20],
              targetField,
              sourceBaseId: "bas_courses",
              sourceBaseSlug: "courses",
              sources: [
                {
                  recordId: "rec_biology",
                  title: "Biology",
                  value: 10,
                  headCommitId: "cmt_biology",
                },
                { recordId: "rec_math", title: "Math", value: 20, headCommitId: "cmt_math" },
              ],
              dependencyVersion: "v1",
            },
          },
        },
      });
      expect(screen.queryByTestId("record-collection-count-course_fees")).toBeNull();
      fireEvent.click(screen.getByTestId("lookup-sources-course_fees"));
      const dialog = screen.getByTestId("lookup-source-dialog");
      const biology = within(dialog).getByRole("link", { name: "Biology" });
      expect(biology.getAttribute("href")).toContain("/base/courses/rec_biology");
      expect(within(dialog).getByRole("link", { name: "Math" })).toBeTruthy();
      expect(dialog.textContent).toContain("10");
      expect(dialog.textContent).toContain("20");
    },
  );

  it("keeps unavailable lookup feedback instead of showing a stale count", () => {
    const field = { ...record.base.fields[0], slug: "unavailable", type: "lookup", options: {} };
    renderDialog("en", "member", {
      record: {
        ...record,
        base: { ...record.base, fields: [record.base.fields[0], field] },
        computedFields: {
          unavailable: {
            status: "inaccessible",
            value: Array.from({ length: 21 }, () => "Hidden"),
            sources: [],
            dependencyVersion: "v1",
          },
        },
      } as RecordVO,
    });
    expect(screen.queryByTestId("record-collection-count-unavailable")).toBeNull();
    expect(screen.queryByText("Hidden")).toBeNull();
    expect(screen.getByRole("status").textContent).toContain("Source unavailable or access denied");
  });

  it("keeps every linked record readable in a wrapping detail field", () => {
    const linkedRecords = Array.from(
      { length: 19 },
      (_, index): RecordVO => ({
        ...record,
        id: `rec_related_${index}`,
        headCommit: { ...record.headCommit, payload: { name: `Customer ${index + 1}` } },
      }),
    );
    renderDialog("en", "member", {
      records: linkedRecords,
      record: {
        ...record,
        base: {
          ...record.base,
          fields: [
            ...record.base.fields,
            {
              id: "fld_related",
              baseId: record.baseId,
              required: false,
              position: 2,
              slug: "related",
              name: "Related",
              type: "relation",
              options: { targetBaseId: record.baseId, multiple: true },
            },
          ],
        },
        headCommit: {
          ...record.headCommit,
          payload: {
            ...record.headCommit.payload,
            related: linkedRecords.map((linked) => linked.id),
          },
        },
      },
    });
    const section = screen
      .getByTestId("record-detail-dialog")
      .querySelector('[data-record-field-slug="related"]') as HTMLElement;
    for (const linked of linkedRecords) {
      expect(
        within(section).getByRole("link", { name: linked.headCommit.payload.name as string }),
      ).toBeTruthy();
    }
    const chip = within(section).getByRole("link", { name: "Customer 19" });
    const list = chip.parentElement as HTMLElement;
    expect(list.classList.contains("flex-wrap")).toBe(true);
    expect(list.classList.contains("inline")).toBe(false);
    expect(list.parentElement?.classList.contains("truncate")).toBe(false);
  });

  it("shows every attachment in details and previews the final file", () => {
    const files = Array.from({ length: 12 }, (_, index) => ({
      id: `att_${index}`,
      fileName: `attachment-${index}.pdf`,
      url: `https://example.com/attachment-${index}.pdf`,
      mimeType: "application/pdf",
      size: 10,
    }));
    renderDialog("en", "member", {
      record: {
        ...record,
        base: {
          ...record.base,
          fields: [
            ...record.base.fields,
            {
              id: "fld_files",
              baseId: record.baseId,
              slug: "files",
              name: "Files",
              type: "attachment",
              options: {},
              required: false,
              position: 2,
            },
          ],
        },
        headCommit: { ...record.headCommit, payload: { ...record.headCommit.payload, files } },
      },
    });
    const detail = screen.getByTestId("record-detail-dialog");
    for (const file of files) {
      expect(within(detail).getByRole("link", { name: file.fileName })).toBeTruthy();
    }
    fireEvent.click(within(detail).getByRole("link", { name: files[11]?.fileName }));
    const preview = screen.getByTestId("attachment-preview-dialog");
    expect(within(preview).getByRole("heading", { name: files[11]?.fileName })).toBeTruthy();
    expect(within(preview).getByTestId("embedded-file-preview").getAttribute("data-url")).toBe(
      files[11]?.url,
    );
    expect(preview.querySelector('[data-previewfile-type="pdf"]')).toBeTruthy();
  });

  it("shows a drive field as a read-only folder tree and opens a file from it", () => {
    const file = (id: string, path?: string) => ({
      id,
      fileName: (path ?? id).split("/").at(-1),
      url: `https://example.com/${id}`,
      mimeType: "application/pdf",
      size: 10,
      ...(path ? { path } : {}),
    });
    const withDrive = (docs: unknown): RecordVO => ({
      ...record,
      base: {
        ...record.base,
        fields: [
          ...record.base.fields,
          {
            id: "fld_docs",
            baseId: record.baseId,
            slug: "docs",
            name: "Documents",
            type: "drive",
            options: {},
            required: false,
            position: 2,
          },
        ],
      },
      headCommit: { ...record.headCommit, payload: { ...record.headCommit.payload, docs } },
    });
    renderDialog("en", "member", {
      record: withDrive([
        file("ast_main", "contracts/2026/main.pdf"),
        file("ast_quote", "contracts/quote.pdf"),
        // A ref with no path sits at the root under its file name.
        file("readme.pdf"),
      ]),
    });
    const section = screen
      .getByTestId("record-detail-dialog")
      .querySelector('[data-record-field-slug="docs"]') as HTMLElement;
    const tree = within(section).getByRole("tree");
    expect(
      within(tree)
        .getAllByRole("treeitem")
        .map((item) => item.textContent),
    ).toEqual(["contracts", "2026", "main.pdf", "quote.pdf", "readme.pdf"]);
    // Read-only: no rename or remove, only download.
    expect(within(tree).queryByRole("button", { name: "Actions for folder contracts" })).toBeNull();
    fireEvent.pointerDown(within(tree).getByRole("button", { name: "Actions for main.pdf" }), {
      button: 0,
      ctrlKey: false,
      pointerType: "mouse",
    });
    expect(screen.getAllByRole("menuitem").map((item) => item.textContent)).toEqual([
      "Download file",
    ]);
    fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });

    fireEvent.click(within(tree).getByRole("treeitem", { name: "quote.pdf" }));
    const preview = screen.getByTestId("drive-file-preview-dialog");
    expect(within(preview).getByRole("heading", { name: "quote.pdf" })).toBeTruthy();
    expect(within(preview).getByRole("link", { name: "Download file" })).toBeTruthy();
    expect(within(preview).getByTestId("embedded-file-preview").getAttribute("data-url")).toBe(
      "https://example.com/ast_quote",
    );
  });

  it("shows an empty drive field as the usual placeholder", () => {
    renderDialog("en", "member", {
      record: {
        ...record,
        base: {
          ...record.base,
          fields: [
            ...record.base.fields,
            {
              id: "fld_docs",
              baseId: record.baseId,
              slug: "docs",
              name: "Documents",
              type: "drive",
              options: {},
              required: false,
              position: 2,
            },
          ],
        },
      } as RecordVO,
    });
    const section = screen
      .getByTestId("record-detail-dialog")
      .querySelector('[data-record-field-slug="docs"]') as HTMLElement;
    expect(within(section).queryByRole("tree")).toBeNull();
    expect(within(section).getByText("-")).toBeTruthy();
  });

  it("shows a loading state, not a not-found message, until the full record arrives", () => {
    renderDialog("en", "member", { record: null, isLoading: true });
    const dialog = screen.getByTestId("record-detail-dialog");
    expect(within(dialog).queryByText(coreMessagesByLocale.en.recordView.recordNotFoundTitle)).toBe(
      null,
    );
    expect(dialog.querySelector("[aria-hidden]")).not.toBeNull();
  });

  it("still reports not found once loading has settled without a record", () => {
    renderDialog("en", "member", { record: null, isLoading: false });
    expect(
      within(screen.getByTestId("record-detail-dialog")).getByText(
        coreMessagesByLocale.en.recordView.recordNotFoundTitle,
      ),
    ).toBeTruthy();
  });

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
    expect(within(dialog).queryByRole("button", { name: "Copy link" })).toBeNull();
    expect(within(dialog).getByText("Read the same record details here")).toBeTruthy();
  });

  it.each(["en", "zh-CN"] as const)(
    "copies the record's own page address from the header in %s",
    async (locale) => {
      const writeText = vi.fn(async () => undefined);
      Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
      renderDialog(locale, "member", {
        path: "/base/customers/calendar?space=tnl_test&record=rec_dialog",
      });
      const dialog = screen.getByRole("dialog", { name: "Acme follow-up" });
      const label = coreMessagesByLocale[locale].share.copyLink;
      const copy = within(dialog).getByRole("button", { name: label });
      // A quiet icon: named for screen readers and by its tooltip, no visible text.
      expect(copy.textContent).toBe("");
      expect(copy.getAttribute("title")).toBe(label);

      fireEvent.click(copy);
      await waitFor(() =>
        expect(writeText).toHaveBeenCalledWith(
          `${window.location.origin}/base/nod_customers/rec_dialog`,
        ),
      );
      // The dialog's own `?record=` stays on the view; the full page drops it.
      expect(
        within(dialog)
          .getByRole("link", { name: coreMessagesByLocale[locale].recordView.openFullPage })
          .getAttribute("href"),
      ).toBe("/base/customers/rec_dialog?space=tnl_test");
    },
  );

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

  it("waits for the record exit before notifying the parent and restoring focus", async () => {
    simulateRecordAnimation();
    const onClose = vi.fn();
    const { trigger } = renderDialog("en", "member", { onClose });
    const dialog = screen.getByTestId("record-detail-dialog");

    fireEvent.click(within(dialog).getByRole("button", { name: "Close" }));

    expect(dialog.isConnected).toBe(true);
    expect(dialog.getAttribute("data-state")).toBe("closed");
    expect(onClose).not.toHaveBeenCalled();
    expect(document.activeElement).not.toBe(trigger);

    finishRecordAnimation(dialog);

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(screen.queryByTestId("record-detail-dialog")).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it("notifies once without an animation event when motion is disabled", async () => {
    const onClose = vi.fn();
    const { trigger } = renderDialog("en", "member", { onClose });
    const dialog = screen.getByTestId("record-detail-dialog");

    fireEvent.click(within(dialog).getByRole("button", { name: "Close" }));

    expect(dialog.isConnected).toBe(false);
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(document.activeElement).toBe(trigger);
  });

  it.each(["open", "closing", "closed"] as const)(
    "does not notify after external unmount while %s",
    async (phase) => {
      simulateRecordAnimation();
      const onClose = vi.fn();
      const { unmount } = renderDialog("en", "member", { onClose });
      const dialog = screen.getByTestId("record-detail-dialog");
      if (phase !== "open") fireEvent.click(within(dialog).getByRole("button", { name: "Close" }));
      if (phase === "closed") finishRecordAnimation(dialog);

      unmount();
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });

      expect(onClose).not.toHaveBeenCalled();
    },
  );

  it.each(["open", "closing", "closed"] as const)(
    "keeps the next record open after a key switch while %s",
    async (phase) => {
      simulateRecordAnimation();
      const onClose = vi.fn();
      const state = { record, onClose };
      const { rerender } = renderDialog("en", "member", state);
      const firstDialog = screen.getByTestId("record-detail-dialog");
      if (phase !== "open")
        fireEvent.click(within(firstDialog).getByRole("button", { name: "Close" }));
      if (phase === "closed") finishRecordAnimation(firstDialog);
      state.record = {
        ...record,
        id: "rec_next",
        headCommit: { ...record.headCommit, payload: { name: "Next customer" } },
      };

      rerender();
      const nextDialog = screen.getByRole("dialog", { name: "Next customer" });
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });

      expect(firstDialog.isConnected).toBe(false);
      expect(nextDialog.getAttribute("data-state")).toBe("open");
      expect(nextDialog.contains(document.activeElement)).toBe(true);
      expect(onClose).not.toHaveBeenCalled();
    },
  );
});
