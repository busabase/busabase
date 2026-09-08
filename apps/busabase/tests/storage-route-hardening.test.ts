import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  serveStoredObject: vi.fn(),
}));

vi.mock("openlib/storage/dev-routes", () => ({
  createDevAttachmentRoute: () => ({ GET: mocks.serveStoredObject }),
}));

import { GET as devAttachmentGET } from "../src/app/api/dev/attachment/[...key]/route";
import { GET as storageGET } from "../src/app/api/storage/[...key]/route";

// Both mounts serve the same objects; which one is live depends on where
// STORAGE_URL's `base_url=` points, so both must harden identically.
const routes = [
  { GET: storageGET, name: "/api/storage" },
  { GET: devAttachmentGET, name: "/api/dev/attachment" },
];

const request = (get: (typeof routes)[number]["GET"]) => {
  const key = ["attachments", "probe"];
  return get(new Request(`http://localhost:15419/${key.join("/")}`), {
    params: Promise.resolve({ key }),
  });
};

const storedAs = (contentType: string, body = "payload") => {
  mocks.serveStoredObject.mockResolvedValue(
    new Response(body, {
      headers: {
        "Cache-Control": "public, max-age=31536000, immutable",
        "Content-Type": contentType,
      },
    }),
  );
};

describe.each(routes)("stored object hardening on $name", ({ GET }) => {
  beforeEach(() => vi.clearAllMocks());

  it("sandboxes types a browser would execute as a top-level document", async () => {
    for (const contentType of [
      "image/svg+xml",
      "text/html",
      "text/html; charset=utf-8",
      "application/xhtml+xml",
      "text/xml",
      "application/xml",
    ]) {
      storedAs(contentType);
      const response = await request(GET);

      expect(response.headers.get("content-security-policy")).toBe("sandbox");
      expect(response.headers.get("x-content-type-options")).toBe("nosniff");
      // The payload and its type still come back, so `<img>` previews of an SVG
      // keep working — CSP only constrains it once it becomes a document.
      expect(response.headers.get("content-type")).toBe(contentType);
      expect(await response.text()).toBe("payload");
    }
  });

  it("leaves ordinary media untouched", async () => {
    for (const contentType of ["image/png", "application/pdf", "text/plain", "video/mp4"]) {
      storedAs(contentType);
      const response = await request(GET);

      expect(response.headers.get("content-security-policy")).toBeNull();
      expect(response.headers.get("x-content-type-options")).toBeNull();
      expect(response.headers.get("content-type")).toBe(contentType);
      expect(response.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
    }
  });
});
