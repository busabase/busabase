import { describe, expect, it } from "vitest";
import { buildHtmlPreviewDocument, resolveHtmlPreviewNavigation } from "./html-preview-navigation";

const currentHref = "https://busabase.com/dashboard/demo/html/guide";
const message = (href: string) => ({
  type: "busabase:html-preview:navigate",
  sessionId: "current",
  href,
});
const resolve = (href: string, extra = {}) =>
  resolveHtmlPreviewNavigation({
    data: message(href),
    sessionId: "current",
    currentHref,
    ...extra,
  });

describe("HTML preview navigation destinations", () => {
  it("uses the host's workspace aliases and requires a node detail route", () => {
    const resolveWorkbenchLink = (url: URL) =>
      url.origin === "https://busabase.com" && /^\/dashboard\/(demo|org123)\//.test(url.pathname)
        ? url.pathname.replace(/^\/dashboard\/[^/]+/, "")
        : null;
    expect(
      resolve("https://busabase.com/dashboard/org123/airapp/app?view=1#intro", {
        resolveWorkbenchLink,
      }),
    ).toEqual({
      href: "https://busabase.com/dashboard/org123/airapp/app?view=1#intro",
      inPlace: true,
    });
    expect(
      resolve("https://busabase.com/dashboard/demo/settings", { resolveWorkbenchLink })?.inPlace,
    ).toBe(false);
    expect(
      resolve("https://busabase.com/dashboard/other/base/data", { resolveWorkbenchLink })?.inPlace,
    ).toBe(false);
    expect(
      resolve("https://evil.test/dashboard/demo/doc/read", { resolveWorkbenchLink })?.inPlace,
    ).toBe(false);
  });

  it("public previews fall back only to the exact workspace and origin", () => {
    expect(resolve("https://busabase.com/dashboard/demo/base/data/record/one")?.inPlace).toBe(true);
    for (const href of [
      "https://busabase.com/dashboard/demo-two/airapp/app",
      "https://busabase.com/dashboard/org123/airapp/app",
      "https://other.busabase.com/dashboard/demo/airapp/app",
      "https://busabase.com/dashboard/demo/settings",
      "https://busabase.com/dashboard/demo/airapp/",
    ])
      expect(resolve(href)?.inPlace).toBe(false);
  });

  it("does not override a host resolver's explicit rejection", () => {
    expect(
      resolve("https://busabase.com/dashboard/demo/airapp/app", {
        resolveWorkbenchLink: () => null,
      })?.inPlace,
    ).toBe(false);
  });

  it.each([
    "javascript:alert(1)",
    "data:text/html,hello",
    "file:///tmp/data",
    "//evil.test",
    "https://user:password@busabase.com/",
  ])("rejects unsafe or non-absolute destination %s", (href) => {
    expect(resolve(href)).toBeNull();
  });

  it("rejects stale and unexpected bridge payloads", () => {
    for (const data of [
      null,
      [],
      { ...message(currentHref), sessionId: "previous" },
      { ...message(currentHref), extra: true },
      { ...message(currentHref), type: "other" },
    ]) {
      expect(resolveHtmlPreviewNavigation({ data, sessionId: "current", currentHref })).toBeNull();
    }
  });
});

describe("HTML preview document injection", () => {
  it("keeps the authored document verbatim around a script in its head", () => {
    const source =
      '<!doctype html><html lang="zh"><head data-custom="yes"><title>Guide</title></head><body><a href="../airapp/app">Open</a></body></html>';
    const document = buildHtmlPreviewDocument(source, {
      parentHref: currentHref,
      sessionId: "one",
    });
    expect(
      document.startsWith('<!doctype html><html lang="zh"><head data-custom="yes"><script>'),
    ).toBe(true);
    expect(document.replace(/<script>[\s\S]*?<\/script>/, "")).toBe(source);
  });

  it("preserves a fragment and a doctype without an explicit head", () => {
    for (const source of ["<main>你好</main>", "<!doctype html><main>hello</main>"]) {
      const document = buildHtmlPreviewDocument(source, {
        parentHref: currentHref,
        sessionId: "one",
      });
      expect(document.replace(/<script>[\s\S]*?<\/script>/, "")).toBe(source);
      if (source.startsWith("<!doctype"))
        expect(document.startsWith("<!doctype html><script>")).toBe(true);
    }
  });

  it("cannot terminate the injected script through configuration", () => {
    const document = buildHtmlPreviewDocument("<main>Safe</main>", {
      parentHref: `${currentHref}?q=</script><script>bad()`,
      sessionId: "one",
    });
    expect(document.match(/<\/script>/g)).toHaveLength(1);
    expect(document).toContain("\\u003c/script>");
  });
});
