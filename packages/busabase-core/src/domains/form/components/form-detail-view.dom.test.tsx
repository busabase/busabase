// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { BusabaseQueryUtils } from "busabase-contract/api-client/react-query";
import type { FormVO } from "busabase-contract/types";
import { type ReactNode, useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { CoreI18nProvider, coreMessagesByLocale } from "../../../i18n";
import type { PreviewFullscreenState } from "../../dashboard/components/preview-fullscreen";
import { DashboardVisitorProvider } from "../../dashboard/visitor-context";
import { FormDetailView } from "./form-detail-view";

const customForm: FormVO = {
  id: "form-1",
  nodeId: "node-form-1",
  spaceId: "space-1",
  targetBaseId: "base-1",
  name: "Consultation request",
  description: "Collect the information an advisor needs.",
  bindings: [
    {
      inputName: "name",
      fieldSlug: "name",
      label: "Your name",
      required: true,
    },
  ],
  boundFields: [
    {
      slug: "name",
      name: "Name",
      type: "text",
      choices: [],
    },
  ],
  page: { code: "<main><input name='name' /></main>" },
  share: { isPublic: true, anonymousSubmit: true },
  submissionCount: 0,
  status: "active",
  createdBy: "actor-1",
  createdAt: "2026-09-15T00:00:00.000Z",
  updatedAt: "2026-09-15T00:00:00.000Z",
};

const generatedForm: FormVO = {
  ...customForm,
  id: "form-2",
  nodeId: "node-form-2",
  name: "Generated intake",
  page: {},
  share: { isPublic: false, anonymousSubmit: false },
};

const makeOrpc = (form: FormVO) =>
  ({
    forms: {
      getByNode: {
        queryOptions: () => ({
          queryKey: ["forms", form.nodeId],
          queryFn: async () => form,
        }),
      },
      submit: {
        mutationOptions: () => ({
          mutationFn: async () => ({
            changeRequestId: "cr-1",
            status: "pending_review" as const,
          }),
        }),
      },
    },
    nodes: {
      get: {
        queryOptions: () => ({
          queryKey: ["nodes", form.nodeId],
          queryFn: async () => null,
        }),
      },
    },
  }) as unknown as BusabaseQueryUtils;

function Providers({ children }: { children: ReactNode }) {
  const [client] = useState(
    () => new QueryClient({ defaultOptions: { queries: { retry: false } } }),
  );
  return (
    <QueryClientProvider client={client}>
      <CoreI18nProvider locale="en">
        <DashboardVisitorProvider visitorKind="member">{children}</DashboardVisitorProvider>
      </CoreI18nProvider>
    </QueryClientProvider>
  );
}

function PreviewHarness({ form, previewOnly = false }: { form: FormVO; previewOnly?: boolean }) {
  const [fullscreen, setFullscreen] = useState(false);
  const fullscreenState: PreviewFullscreenState = { fullscreen, setFullscreen };
  return (
    <>
      {!previewOnly ? (
        <button onClick={() => setFullscreen(true)} type="button">
          Test fullscreen
        </button>
      ) : null}
      <FormDetailView
        fullscreenState={fullscreenState}
        orpc={makeOrpc(form)}
        previewOnly={previewOnly}
        slug={form.nodeId}
      />
    </>
  );
}

afterEach(cleanup);

describe("FormDetailView preview parity", () => {
  it("keeps the custom iframe mounted while Code switches into fullscreen Form preview", async () => {
    const messages = coreMessagesByLocale.en;
    const { container } = render(
      <Providers>
        <PreviewHarness form={customForm} />
      </Providers>,
    );

    const frame = await screen.findByTitle(messages.form.tabForm);
    frame.setAttribute("data-test-identity", "custom-form-frame");
    fireEvent.mouseDown(screen.getByRole("tab", { name: messages.form.tabCode }));
    expect(screen.getByText(messages.form.pageSource)).not.toBeNull();
    expect(container.querySelectorAll("iframe")).toHaveLength(1);

    fireEvent.click(screen.getByRole("button", { name: "Test fullscreen" }));

    await waitFor(() => {
      expect(
        screen.getByRole("tab", { name: messages.form.tabForm }).getAttribute("data-state"),
      ).toBe("active");
    });
    expect(container.querySelectorAll("iframe")).toHaveLength(1);
    expect(container.querySelector("iframe")?.getAttribute("data-test-identity")).toBe(
      "custom-form-frame",
    );
    expect(container.querySelector('[data-form-fullscreen="true"]')).not.toBeNull();
    expect(container.querySelector("iframe")?.className).toContain("h-full");
  });

  it("keeps generated field values while the same preview surface enters fullscreen", async () => {
    const { container } = render(
      <Providers>
        <PreviewHarness form={generatedForm} />
      </Providers>,
    );

    const input = await screen.findByRole("textbox", { name: "Your name" });
    fireEvent.change(input, { target: { value: "Ada" } });
    expect((input as HTMLInputElement).value).toBe("Ada");

    fireEvent.click(screen.getByRole("button", { name: "Test fullscreen" }));

    await waitFor(() =>
      expect(container.querySelector('[data-form-fullscreen="true"]')).not.toBeNull(),
    );
    expect((screen.getByRole("textbox", { name: "Your name" }) as HTMLInputElement).value).toBe(
      "Ada",
    );
  });

  it("renders a preview-only Side Panel surface with local fullscreen controls", async () => {
    const messages = coreMessagesByLocale.en;
    const { container } = render(
      <Providers>
        <PreviewHarness form={customForm} previewOnly />
      </Providers>,
    );

    await screen.findByTitle(messages.form.tabForm);
    expect(screen.queryByRole("heading", { name: customForm.name })).toBeNull();
    expect(screen.queryByRole("tab", { name: messages.form.tabCode })).toBeNull();
    expect(screen.getByText(messages.form.tabForm, { selector: "span" })).not.toBeNull();

    fireEvent.click(screen.getByRole("button", { name: messages.airapp.enterFullscreen }));
    await waitFor(() =>
      expect(container.querySelector('[data-form-fullscreen="true"]')).not.toBeNull(),
    );
    expect(container.querySelectorAll("iframe")).toHaveLength(1);

    fireEvent.click(screen.getByRole("button", { name: messages.airapp.exitFullscreen }));
    await waitFor(() =>
      expect(container.querySelector('[data-form-fullscreen="true"]')).toBeNull(),
    );
  });
});
