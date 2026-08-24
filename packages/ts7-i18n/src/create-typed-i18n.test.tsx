// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { createTypedI18n } from "./create-typed-i18n";

interface BaseTranslation {
  common: { save: string; greet: "Hi {name}" };
}

describe("createTypedI18n — React Provider / useI18nContext", () => {
  it("throws when useI18nContext is called outside a Provider", () => {
    const i18n = createTypedI18n<"en", BaseTranslation>();
    function Consumer() {
      i18n.useI18nContext();
      return null;
    }
    expect(() => render(<Consumer />)).toThrow(/must be used within its Provider/);
  });

  it("throws when Provider is mounted with an unloaded locale", () => {
    const i18n = createTypedI18n<"en", BaseTranslation>();
    expect(() =>
      render(
        <i18n.Provider locale="en">
          <div />
        </i18n.Provider>,
      ),
    ).toThrow(/not loaded/);
  });

  it("renders translated text once the locale is loaded, and re-renders on locale switch", () => {
    const i18n = createTypedI18n<"en" | "zh-CN", BaseTranslation>({
      en: { common: { save: "Save", greet: "Hi {name}" } },
      "zh-CN": { common: { save: "保存", greet: "你好 {name}" } },
    });

    function Consumer() {
      const { LL } = i18n.useI18nContext();
      return <div data-testid="greet">{LL.common.greet({ name: "Kelly" })}</div>;
    }

    const { rerender } = render(
      <i18n.Provider locale="en">
        <Consumer />
      </i18n.Provider>,
    );
    expect(screen.getByTestId("greet").textContent).toBe("Hi Kelly");

    rerender(
      <i18n.Provider locale="zh-CN">
        <Consumer />
      </i18n.Provider>,
    );
    expect(screen.getByTestId("greet").textContent).toBe("你好 Kelly");
  });

  it("createTypedI18n's registry half (loadLocale/getTranslations) still works directly", () => {
    const i18n = createTypedI18n<"en", BaseTranslation>();
    i18n.loadLocale("en", { common: { save: "Save", greet: "Hi {name}" } });
    expect(i18n.getTranslations("en").common.save()).toBe("Save");
  });
});
