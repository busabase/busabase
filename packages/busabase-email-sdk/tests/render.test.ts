import { describe, expect, it } from "vitest";
import { renderEmail } from "../src/render.js";
import type { EmailMessage } from "../src/types.js";

const base = {
  from: "Sales <sales@example.com>",
  to: "buyer@example.net",
  subject: "Business follow-up",
};

describe("renderEmail", () => {
  it("renders Markdown links, headings, and external images with readable plaintext", async () => {
    const result = await renderEmail({
      ...base,
      markdown:
        "## What happens next?\n\n[→ View the case](https://example.com/article#case)\n\n![Assistant](https://example.com/assistant.png)",
    });
    expect(result.html).toContain("<h2>What happens next?</h2>");
    expect(result.html).toContain('src="https://example.com/assistant.png"');
    expect(result.text).toContain("→ View the case");
    expect(result.text).toContain("https://example.com/article#case");
    expect(result.text).not.toContain("##");
    expect(result.text).not.toContain("](");
    expect(result.html).toContain("text-decoration:underline");
    expect(result).not.toHaveProperty("markdown");
  });

  it("keeps explicit plaintext and prefers explicit HTML over Markdown", async () => {
    const result = await renderEmail({
      ...base,
      text: "Custom fallback",
      html: "<p>Handwritten</p>",
      markdown: "Ignored",
    });
    expect(result.text).toBe("Custom fallback");
    expect(result.html).toBe("<p>Handwritten</p>");
  });

  it("removes executable markup, unsafe links and image protocols", async () => {
    const result = await renderEmail({
      ...base,
      markdown:
        '<script>alert(1)</script>\n\n<a href="javascript:alert(2)" onclick="run()">Unsafe</a>\n\n<img src="file:///etc/passwd"><img src="//tracker.example.com/x"><img src="data:image/svg+xml,bad"><img src="https://example.com/photo.png" onerror="run()">',
    });
    expect(result.html).not.toMatch(
      /<script|javascript:|onclick|file:|src="\/\/|data:image|onerror/,
    );
    expect(result.html).toContain('src="https://example.com/photo.png"');
  });

  it("allows useful email layout styles and removes CSS URLs", async () => {
    const result = await renderEmail({
      ...base,
      html: '<p style="color: #123456; font-size: 16px; background-image: url(https://example.com/t)">Hello &amp; welcome</p>',
    });
    expect(result.html).toContain("color:#123456");
    expect(result.html).not.toContain("background-image");
    expect(result.text).toBe("Hello & welcome");
  });

  it("keeps only absolute HTTP(S) and CID image sources", async () => {
    const result = await renderEmail({
      ...base,
      html: '<p>Images</p><img src="images/case.png"><img src="/images/case.png"><img src="#case"><img src="http:"><img src="//example.com/case.png"><img src="https://example.com/case.png"><img src="http://example.com/photo.png"><img src="cid:case@example.com">',
    });
    expect(result.html?.match(/<img\b/g)).toHaveLength(3);
    expect(result.html).toContain('src="https://example.com/case.png"');
    expect(result.html).toContain('src="http://example.com/photo.png"');
    expect(result.html).toContain('src="cid:case@example.com"');
    expect(result.html).not.toContain('src="images/');
    expect(result.html).not.toContain('src="/images/');
  });

  it.each<Partial<EmailMessage>>([
    { subject: "Hello\r\nBcc: hidden@example.com" },
    { to: ["buyer@example.com\nBcc: hidden@example.com"] },
    { from: "sales@example.com\0" },
    { replyTo: "sales@example.com\rInjected: yes" },
    { references: ["<original@example.com>\nInjected: yes"] },
    { headers: { "X-Campaign": "123\r\nInjected: yes" } },
    { headers: { "Bad:Name": "value" } },
    { headers: { Bcc: "hidden@example.com" } },
    { attachments: [{ filename: "report.pdf\r\nInjected: yes", content: "PDF" }] },
  ])("rejects injected or conflicting headers: %j", async (extra) => {
    await expect(renderEmail({ ...base, text: "Hello", ...extra })).rejects.toThrow();
  });

  it("rejects empty content and content removed by sanitization", async () => {
    await expect(renderEmail({ ...base })).rejects.toThrow("content");
    await expect(renderEmail({ ...base, text: "  " })).rejects.toThrow("content");
    await expect(renderEmail({ ...base, html: "<script>gone()</script>" })).rejects.toThrow(
      "content",
    );
  });
});
