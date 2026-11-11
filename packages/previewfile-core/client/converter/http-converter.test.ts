import { afterEach, describe, expect, it, vi } from "vitest";
import { createHttpConverter } from "./http-converter";

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

const input = {
  fileUrl: "https://files.example/deck.pptx",
  fileName: "deck.pptx",
  mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
};

describe("createHttpConverter", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("posts to the same-origin convert route with cookies by default", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({ success: true, outputUrl: "/api/convert/pdf-file/conversions/a.pdf" }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await createHttpConverter().convertToPdf(input);

    expect(result).toEqual({ pdfUrl: "/api/convert/pdf-file/conversions/a.pdf" });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/convert");
    expect(init).toMatchObject({ method: "POST", credentials: "include" });
    expect(JSON.parse(String(init.body))).toEqual({ ...input, outputFormat: "pdf" });
  });

  it("lets a host on another origin rewrite URLs and requests", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({ success: true, outputUrl: "/api/convert/pdf-file/conversions/a.pdf" }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const converter = createHttpConverter({
      resolveApiUrl: (path) => `https://server.example${path}`,
      resolveOutputUrl: (path) => `https://server.example${path}`,
      prepareRequest: (init) => ({
        ...init,
        credentials: "omit",
        headers: { ...(init.headers as Record<string, string>), authorization: "Bearer t" },
      }),
    });
    const result = await converter.convertToPdf(input);

    expect(result.pdfUrl).toBe("https://server.example/api/convert/pdf-file/conversions/a.pdf");
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://server.example/api/convert");
    expect(init).toMatchObject({ credentials: "omit", headers: { authorization: "Bearer t" } });
  });

  it("surfaces the route's error message", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse({ success: false, error: "Conversion service temporarily unavailable" }, 503),
      ),
    );

    await expect(createHttpConverter().convertToPdf(input)).rejects.toThrow(
      "Conversion service temporarily unavailable",
    );
  });

  it("reports a non-JSON reply instead of a JSON parse error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response("<html>gateway</html>", {
            status: 502,
            statusText: "Bad Gateway",
            headers: { "content-type": "text/html; charset=utf-8" },
          }),
      ),
    );

    await expect(createHttpConverter().convertToPdf(input)).rejects.toThrow(
      "Conversion service returned text/html instead of JSON (502 Bad Gateway)",
    );
  });

  it("adds host-specific fields from the viewer's input", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({ success: true, outputUrl: "/api/f/abc123/pdf" }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await createHttpConverter({
      extraBody: ({ metadata }) => ({ shortUrl: metadata?.shortUrl }),
    }).convertToPdf({ ...input, metadata: { shortUrl: "abc123" } });

    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toMatchObject({
      shortUrl: "abc123",
      fileName: "deck.pptx",
    });
  });
});
