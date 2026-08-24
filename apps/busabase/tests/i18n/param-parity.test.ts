import { assertLocaleParamParity } from "ts7-i18n";
import { describe, expect, it } from "vitest";
import en from "~/i18n/en";
import ja from "~/i18n/ja";
import zhCN from "~/i18n/zh-CN";

describe("ts7-i18n locale param parity", () => {
  it("every locale references exactly the same {param} set as the base locale (en)", () => {
    expect(() => assertLocaleParamParity(en, { ja, "zh-CN": zhCN })).not.toThrow();
  });
});
