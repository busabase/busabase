import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CoreI18nProvider } from "../../../i18n";
import { HtmlFieldPreview } from "./field-preview";

const render = (value: string, fill = false) =>
  renderToStaticMarkup(
    <CoreI18nProvider>
      <HtmlFieldPreview fill={fill} value={value} />
    </CoreI18nProvider>,
  );

const page =
  "<!doctype html><html><head><style>.tabs label{color:#1F3A5F}</style></head><body>" +
  '<input type="radio" name="tab" id="t0" checked><label for="t0">速览</label>' +
  "<script>window.parent.document.title='pwned'</script></body></html>";

describe("HtmlFieldPreview", () => {
  it("renders a whole page in a sandboxed frame with its stylesheet and controls intact", () => {
    const markup = render(page);
    expect(markup).toContain('data-testid="html-document-frame"');
    expect(markup).toContain('sandbox="allow-popups allow-popups-to-escape-sandbox"');
    expect(markup).not.toContain("allow-scripts");
    expect(markup).not.toContain("allow-same-origin");
    expect(markup).toContain('referrerPolicy="no-referrer"');
    // The page travels as srcdoc, untouched by the fragment allowlist.
    expect(markup).toContain("srcDoc=");
    expect(markup).toContain("&lt;style&gt;.tabs label{color:#1F3A5F}&lt;/style&gt;");
    expect(markup).toContain("&lt;input type=&quot;radio&quot;");
  });

  it("keeps rich-text fragments on the sanitized inline path", () => {
    const markup = render("<p>Hello <b>world</b></p><script>alert(1)</script><style>p{}</style>");
    expect(markup).not.toContain("<iframe");
    expect(markup).toContain("busabase-html-field");
    expect(markup).toContain("<b>world</b>");
    expect(markup).not.toContain("<script");
    expect(markup).not.toContain("<style");
  });

  it("stretches the frame to the dialog when asked to fill", () => {
    expect(render(page, true)).toContain("min-h-0 flex-1");
    expect(render(page, false)).toContain("h-[min(70vh,640px)]");
  });
});
