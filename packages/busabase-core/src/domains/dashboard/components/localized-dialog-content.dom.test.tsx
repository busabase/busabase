// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { Dialog, DialogTitle } from "kui/dialog";
import * as React from "react";
import { afterEach, describe, expect, it } from "vitest";
import { CoreI18nProvider, coreMessagesByLocale } from "../../../i18n";
import { DialogContent } from "./localized-dialog-content";

Object.assign(globalThis, { React });

afterEach(cleanup);

describe("dashboard dialog close control", () => {
  it.each(["zh-CN", "ja"] as const)("uses the %s locale for its accessible name", (locale) => {
    render(
      <CoreI18nProvider locale={locale}>
        <Dialog defaultOpen>
          <DialogContent>
            <DialogTitle>Title</DialogTitle>
          </DialogContent>
        </Dialog>
      </CoreI18nProvider>,
    );

    expect(
      screen.getByRole("button", { name: coreMessagesByLocale[locale].common.close }),
    ).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Close" })).toBeNull();
  });

  it("respects dialogs that provide their own close control", () => {
    render(
      <Dialog defaultOpen>
        <DialogContent showCloseButton={false}>
          <DialogTitle>Title</DialogTitle>
        </DialogContent>
      </Dialog>,
    );

    expect(screen.queryByRole("button", { name: "Close" })).toBeNull();
  });
});
