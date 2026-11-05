import type { Page } from "@playwright/test";

// Split transport delivery to avoid local proxy buffering and allow explicit
// per-procedure failure injection. Every ordinary response is still real HTTP.
export async function splitBatches(page: Page) {
  await page.addInitScript(() => {
    const fetchReal = window.fetch.bind(window);
    window.fetch = async (input, init) => {
      const request = new Request(input, init);
      if (!new URL(request.url).pathname.endsWith("/__batch__") || request.method !== "POST")
        return fetchReal(request);
      const items = (await request.clone().json()) as Array<{
        url: string;
        method?: string;
        headers?: Record<string, string>;
        body: unknown;
      }>;
      const encoder = new TextEncoder();
      return new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            void Promise.all(
              items.map(async (item, index) => {
                const headers = new Headers(request.headers);
                headers.delete("x-orpc-batch");
                for (const [key, value] of Object.entries(item.headers ?? {}))
                  headers.set(key, value);
                const response = await fetchReal(new URL(item.url, request.url), {
                  method: item.method ?? request.method,
                  headers,
                  credentials: request.credentials,
                  signal: request.signal,
                  body: JSON.stringify(item.body),
                });
                controller.enqueue(
                  encoder.encode(
                    `event: message\ndata: ${JSON.stringify({
                      index,
                      status: response.status,
                      headers: Object.fromEntries(response.headers.entries()),
                      body: await response.json(),
                    })}\n\n`,
                  ),
                );
              }),
            ).then(
              () => controller.close(),
              (error: unknown) => controller.error(error),
            );
          },
        }),
        { status: 200, headers: { "content-type": "text/event-stream" } },
      );
    };
  });
}
