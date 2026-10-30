import type React from "react";
import { renderToReadableStream } from "react-dom/server.edge";
import { describe, expect, it, vi } from "vitest";

// `useSearchParams()` suspends a static page during prerender; model that with a
// promise that resolves after the shell has been flushed, so the stream carries
// both the fallback and the resolved segment — exactly what Next streams.
// The timer starts on the first render, not at import, so it cannot have
// fired before the stream even begins.
let settled = false;
let pending: Promise<void> | undefined;

vi.mock("next/navigation", () => ({
  usePathname: () => "/connect-agents",
  useSearchParams: () => {
    if (settled) return new URLSearchParams();
    pending ??= new Promise<void>((resolve) => {
      setTimeout(() => {
        settled = true;
        resolve();
      }, 20);
    });
    throw pending;
  },
}));
vi.mock("fumadocs-ui/provider/next", () => ({
  RootProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

const { LangLayoutClient } = await import("./lang-layout-client");

const readAll = async (stream: ReadableStream<Uint8Array>) => {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let html = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return html;
    html += decoder.decode(value, { stream: true });
  }
};

describe("LangLayoutClient", () => {
  it("streams the page once even when the progress provider suspends", async () => {
    // A whole document, as Next renders it: React only emits the fallback and the
    // hidden resolved segment separately once there is a shell to flush.
    const stream = await renderToReadableStream(
      <html lang="en">
        <body>
          <LangLayoutClient lang="en" provider={() => ({ locale: "en" })}>
            <main>
              <h1>Connect Hermes Agent to Busabase</h1>
            </main>
          </LangLayoutClient>
        </body>
      </html>,
    );
    const html = await readAll(stream);
    expect(html.match(/<h1\b/g) ?? []).toHaveLength(1);
  });
});
