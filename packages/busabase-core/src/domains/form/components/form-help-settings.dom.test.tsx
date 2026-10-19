// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { BusabaseQueryUtils } from "busabase-contract/api-client/react-query";
import type { FormFieldBindingVO, FormVO } from "busabase-contract/types";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FormHelpSettings } from "./form-help-settings";

afterEach(cleanup);
const deliveryBinding: FormFieldBindingVO = {
  inputName: "delivery",
  fieldSlug: "delivery",
  label: "Delivery",
  required: true,
};
const form: FormVO = {
  id: "form",
  nodeId: "node",
  spaceId: "space",
  targetBaseId: "base",
  name: "Delivery",
  description: "",
  bindings: [deliveryBinding],
  boundFields: [
    {
      slug: "delivery",
      name: "Delivery",
      type: "date",
      choices: [],
      help: { description: "Actual date", example: "2026-10-14" },
    },
  ],
  page: {},
  share: { isPublic: false, anonymousSubmit: false },
  submissionCount: 0,
  status: "active",
  createdBy: "actor",
  createdAt: "2026-10-14T00:00:00Z",
  updatedAt: "2026-10-14T00:00:00Z",
};

function renderSettings(
  initialForm: FormVO,
  mutationFn: (input: {
    nodeId: string;
    bindings: FormFieldBindingVO[];
  }) => Promise<FormVO> = vi.fn(async () => initialForm),
) {
  const orpc = {
    forms: { update: { mutationOptions: () => ({ mutationFn }) } },
  } as unknown as BusabaseQueryUtils;
  const onSaved = vi.fn(async () => undefined);
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  const content = (value: FormVO) => (
    <QueryClientProvider client={client}>
      <FormHelpSettings form={value} orpc={orpc} onSaved={onSaved} />
    </QueryClientProvider>
  );
  const view = render(content(initialForm));
  return { mutationFn, onSaved, rerender: (value: FormVO) => view.rerender(content(value)) };
}

describe("form guidance overrides", () => {
  it("stops overriding remote help after the local edit is reverted", () => {
    const initial = {
      ...form,
      bindings: [{ ...deliveryBinding, help: "Original instructions" }],
    };
    const view = renderSettings(initial);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Temporary edit" } });
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Original instructions" } });
    view.rerender({
      ...initial,
      bindings: [{ ...deliveryBinding, help: "Remote instructions" }],
    });
    expect(screen.getByDisplayValue("Remote instructions")).toBeTruthy();
    expect(
      (screen.getByRole("button", { name: "Save instructions" }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it("merges help edits onto current bindings after another administrator changes mappings, required flags and membership", async () => {
    const initial: FormVO = {
      ...form,
      bindings: [
        ...form.bindings,
        { inputName: "removed", fieldSlug: "removed", help: "Old removed help" },
        { inputName: "untouched", fieldSlug: "untouched", help: "Old untouched help" },
      ],
    };
    const mutationFn = vi.fn(
      async (_input: { nodeId: string; bindings: FormFieldBindingVO[] }) => initial,
    );
    const view = renderSettings(initial, mutationFn);
    fireEvent.click(screen.getAllByLabelText("Customize for this form")[0] as HTMLInputElement);
    fireEvent.change(
      screen.getByLabelText("Filling instructions", { selector: "#form-help-delivery" }),
      {
        target: { value: "Draft instructions" },
      },
    );
    const latest: FormVO = {
      ...initial,
      bindings: [
        { inputName: "added", fieldSlug: "added", required: true, help: "New binding help" },
        { inputName: "untouched", fieldSlug: "untouched", help: "Updated untouched help" },
        { ...deliveryBinding, fieldSlug: "new-mapping", required: false, label: "New label" },
      ],
    };
    view.rerender(latest);
    expect(screen.queryByDisplayValue("Old removed help")).toBeNull();
    expect(screen.getByDisplayValue("Updated untouched help")).toBeTruthy();
    expect(screen.getByDisplayValue("Draft instructions")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Save instructions" }));
    await waitFor(() => expect(view.onSaved).toHaveBeenCalled());
    expect(mutationFn.mock.calls[0]?.[0]).toEqual({
      nodeId: form.nodeId,
      bindings: latest.bindings.map((binding) =>
        binding.inputName === "delivery" ? { ...binding, help: "Draft instructions" } : binding,
      ),
    });
  });

  it("preserves explicitly returning to inherited help across refetch", async () => {
    const initial = { ...form, bindings: [{ ...deliveryBinding, help: "Old override" }] };
    const mutationFn = vi.fn(
      async (_input: { nodeId: string; bindings: FormFieldBindingVO[] }) => initial,
    );
    const view = renderSettings(initial, mutationFn);
    fireEvent.click(screen.getByLabelText("Customize for this form"));
    view.rerender({
      ...initial,
      bindings: [{ ...deliveryBinding, required: false, help: "New override" }],
    });
    expect(screen.queryByRole("textbox")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Save instructions" }));
    await waitFor(() => expect(view.onSaved).toHaveBeenCalled());
    expect(mutationFn.mock.calls[0]?.[0].bindings).toEqual([
      { ...initial.bindings[0], required: false, help: undefined },
    ]);
  });

  it("discards drafts for removed bindings and when switching forms", () => {
    const view = renderSettings(form);
    fireEvent.click(screen.getByLabelText("Customize for this form"));
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Deleted draft" } });
    view.rerender({ ...form, bindings: [] });
    view.rerender(form);
    expect(screen.queryByRole("textbox")).toBeNull();
    fireEvent.click(screen.getByLabelText("Customize for this form"));
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Other form draft" } });
    view.rerender({ ...form, id: "other", nodeId: "other-node" });
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(
      (screen.getByRole("button", { name: "Save instructions" }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it("retries a failed save using the latest binding settings and clears the successful draft", async () => {
    const mutationFn = vi
      .fn(async (_input: { nodeId: string; bindings: FormFieldBindingVO[] }) => form)
      .mockRejectedValueOnce(new Error("Network unavailable"));
    const view = renderSettings(form, mutationFn);
    fireEvent.click(screen.getByLabelText("Customize for this form"));
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Retry draft" } });
    fireEvent.click(screen.getByRole("button", { name: "Save instructions" }));
    await screen.findByRole("alert");
    const latest = { ...form, bindings: [{ ...deliveryBinding, required: false }] };
    view.rerender(latest);
    expect(screen.getByDisplayValue("Retry draft")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Save instructions" }));
    await waitFor(() => expect(view.onSaved).toHaveBeenCalledTimes(1));
    expect(mutationFn.mock.calls[1]?.[0]).toEqual({
      nodeId: form.nodeId,
      bindings: [{ ...latest.bindings[0], help: "Retry draft" }],
    });
    expect(
      (screen.getByRole("button", { name: "Save instructions" }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it("saves only form bindings, retains label/required and supports intentionally hiding a description", async () => {
    const mutationFn = vi.fn(
      async (_input: { nodeId: string; bindings: FormFieldBindingVO[] }) => form,
    );
    const orpc = {
      forms: { update: { mutationOptions: () => ({ mutationFn }) } },
    } as unknown as BusabaseQueryUtils;
    const onSaved = vi.fn(async () => undefined);
    render(
      <QueryClientProvider client={new QueryClient()}>
        <FormHelpSettings form={form} orpc={orpc} onSaved={onSaved} />
      </QueryClientProvider>,
    );
    fireEvent.click(screen.getByLabelText("Customize for this form"));
    fireEvent.change(screen.getByLabelText("Filling instructions"), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Save instructions" }));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(mutationFn.mock.calls[0]?.[0]).toEqual({
      nodeId: "node",
      bindings: [{ ...form.bindings[0], help: "" }],
    });
  });

  it("preserves unsaved instructions across refetch and retains drafts after a failed save", async () => {
    const mutationFn = vi.fn(async () => {
      throw new Error("Network unavailable");
    });
    const orpc = {
      forms: { update: { mutationOptions: () => ({ mutationFn }) } },
    } as unknown as BusabaseQueryUtils;
    const onSaved = vi.fn(async () => undefined);
    const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
    const view = render(
      <QueryClientProvider client={client}>
        <FormHelpSettings form={form} orpc={orpc} onSaved={onSaved} />
      </QueryClientProvider>,
    );
    fireEvent.click(screen.getByLabelText("Customize for this form"));
    fireEvent.change(screen.getByLabelText("Filling instructions"), {
      target: { value: "Draft instructions" },
    });
    view.rerender(
      <QueryClientProvider client={client}>
        <FormHelpSettings
          form={{ ...form, bindings: form.bindings.map((binding) => ({ ...binding })) }}
          orpc={orpc}
          onSaved={onSaved}
        />
      </QueryClientProvider>,
    );
    expect((screen.getByLabelText("Filling instructions") as HTMLTextAreaElement).value).toBe(
      "Draft instructions",
    );
    fireEvent.click(screen.getByRole("button", { name: "Save instructions" }));
    await screen.findByRole("alert");
    expect((screen.getByLabelText("Filling instructions") as HTMLTextAreaElement).value).toBe(
      "Draft instructions",
    );
    expect(onSaved).not.toHaveBeenCalled();
  });
});
