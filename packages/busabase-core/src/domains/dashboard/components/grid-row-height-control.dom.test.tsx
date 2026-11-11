// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CoreI18nProvider } from "../../../i18n";
import { GridRowHeightControl } from "./grid-row-height-control";
import { SubmitPermissionProvider } from "./split-submit-button";

afterEach(cleanup);

describe("row height control", () => {
  it("submits only the chosen preset through the immediate write action", async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(
      <CoreI18nProvider locale="en">
        <SubmitPermissionProvider permissionLevel="write">
          <GridRowHeightControl value="medium" onSubmit={onSubmit} />
        </SubmitPermissionProvider>
      </CoreI18nProvider>,
    );
    fireEvent.click(screen.getByTestId("row-height-control"));
    expect((screen.getByTestId("row-height-option-medium") as HTMLInputElement).checked).toBe(true);
    fireEvent.click(screen.getByTestId("row-height-option-tall"));
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith("tall", true));
    await waitFor(() => expect(screen.queryByRole("radio")).toBeNull());
  });

  it("keeps the old value and enables retry after a failed write", async () => {
    const onSubmit = vi
      .fn()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValue(undefined);
    render(
      <CoreI18nProvider locale="en">
        <SubmitPermissionProvider permissionLevel="write">
          <GridRowHeightControl value="medium" onSubmit={onSubmit} />
        </SubmitPermissionProvider>
      </CoreI18nProvider>,
    );
    fireEvent.click(screen.getByTestId("row-height-control"));
    fireEvent.click(screen.getByTestId("row-height-option-short"));
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("Try again"));
    expect(screen.getByTestId("row-height-control").getAttribute("aria-describedby")).toBe(
      screen.getByRole("alert").id,
    );
    expect(screen.getByTestId("row-height-control").getAttribute("aria-label")).toBe(
      "Row height: Medium",
    );
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(2));
  });

  it("offers only review submission for a proposer and reports its pending state", async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(
      <CoreI18nProvider locale="en">
        <SubmitPermissionProvider permissionLevel="changeRequest">
          <GridRowHeightControl value="medium" onSubmit={onSubmit} />
        </SubmitPermissionProvider>
      </CoreI18nProvider>,
    );
    fireEvent.click(screen.getByTestId("row-height-control"));
    fireEvent.click(screen.getByTestId("row-height-option-extra-tall"));
    expect(screen.queryByRole("button", { name: "Apply" })).toBeNull();
    await act(async () =>
      fireEvent.click(screen.getByRole("button", { name: "Submit for review" })),
    );
    expect(onSubmit).toHaveBeenCalledWith("extra-tall", false);
    expect(screen.getByRole("status").textContent).toContain("after approval and merge");
    expect(screen.getByTestId("row-height-control").getAttribute("aria-describedby")).toBe(
      screen.getByRole("status").id,
    );
    expect(screen.getByTestId("row-height-control").getAttribute("title")).toContain(
      "after approval and merge",
    );
    expect(screen.getByTestId("row-height-control").getAttribute("aria-label")).toBe(
      "Row height: Medium",
    );
  });

  it("localizes the choices and action", () => {
    render(
      <CoreI18nProvider locale="zh-CN">
        <GridRowHeightControl value="medium" onSubmit={vi.fn()} />
      </CoreI18nProvider>,
    );
    fireEvent.click(screen.getByTestId("row-height-control"));
    expect(screen.getByRole("radio", { name: "超高" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "应用" })).toBeTruthy();
  });
});
