import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  CoreI18nProvider,
  type CoreMessagesTransformer,
  useCoreI18n,
  useCoreMessages,
} from "../src/i18n";
import { coreMessagesByLocale } from "../src/i18n/catalog";

function GuideCopy() {
  const contextual = useCoreI18n();
  const explicit = useCoreMessages("zh-CN");
  return createElement("p", null, `${contextual.emptyGuide.body}|${explicit.emptyGuide.body}`);
}

const vikaCopy: CoreMessagesTransformer = (messages) => ({
  ...messages,
  emptyGuide: {
    ...messages.emptyGuide,
    body: messages.emptyGuide.body.replace("Busabase", "VikaBase"),
  },
});

function provider(children: ReactNode, transformMessages?: CoreMessagesTransformer) {
  const props = { locale: "zh-CN", transformMessages, children };
  return createElement(CoreI18nProvider, props);
}

describe("host dashboard copy overlays", () => {
  it("keeps Busabase as the default in both context and explicit-locale readers", () => {
    const markup = renderToStaticMarkup(provider(createElement(GuideCopy)));
    expect(markup).toContain("Busabase 可以手动使用");
    expect(markup).not.toContain("VikaBase");
  });

  it("inherits the host overlay through nested dashboard providers without altering shared catalogs", () => {
    const raw = coreMessagesByLocale["zh-CN"].emptyGuide.body;
    const markup = renderToStaticMarkup(provider(provider(createElement(GuideCopy)), vikaCopy));
    expect(markup.match(/VikaBase 可以手动使用/g)).toHaveLength(2);
    expect(markup).not.toContain("Busabase");
    expect(coreMessagesByLocale["zh-CN"].emptyGuide.body).toBe(raw);
    const unrelatedHost = renderToStaticMarkup(provider(createElement(GuideCopy)));
    expect(unrelatedHost).not.toContain("VikaBase");
  });
});
