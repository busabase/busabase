import { assertLocaleParamParity } from "ts7-i18n";
import { describe, expect, it } from "vitest";
import de from "~/i18n/de";
import en from "~/i18n/en";
import es from "~/i18n/es";
import fr from "~/i18n/fr";
import ja from "~/i18n/ja";
import ko from "~/i18n/ko";
import pt from "~/i18n/pt";
import vi from "~/i18n/vi";
import zhCN from "~/i18n/zh-CN";
import zhTW from "~/i18n/zh-TW";

describe("ts7-i18n locale param parity", () => {
  it("every locale references exactly the same {param} set as the base locale (en)", () => {
    expect(() =>
      assertLocaleParamParity(en, {
        ja,
        "zh-CN": zhCN,
        "zh-TW": zhTW,
        es,
        ko,
        pt,
        vi,
        fr,
        de,
      }),
    ).not.toThrow();
  });
});
