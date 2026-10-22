import { describe, expect, it } from "vitest";
import { parseStorageUrl } from "./s3";

/**
 * `ssl` is a three-state flag, not a two-state one.
 *
 * The endpoint protocol is what gets signed into every presigned URL, and those
 * URLs are handed straight to the browser. So an `ssl` value that is silently
 * ignored does not fail loudly on the server — it produces `http://` links on an
 * HTTPS page, where the browser blocks every upload as Mixed Content. There is
 * no error anywhere pointing back at `STORAGE_URL`, which is what makes the
 * omission expensive to diagnose. These tests pin the protocol each spelling
 * resolves to.
 */
describe("parseStorageUrl SSL handling", () => {
  const endpointFor = (url: string) => parseStorageUrl(url).endpoint;

  it("keeps provider defaults when ssl is absent", () => {
    // minio:// means "S3, path-style, no TLS" — the historical tag for a
    // loopback SeaweedFS/MinIO that has no certificate.
    expect(endpointFor("minio://key:secret@127.0.0.1:9000/bucket")).toBe("http://127.0.0.1:9000");
    // s3:// and r2:// are hosted providers that are always TLS.
    expect(endpointFor("s3://key:secret@example.com/bucket")).toBe("https://example.com");
  });

  it("lets an explicit ssl=true turn TLS on for minio://", () => {
    // The regression this guards: `ssl=true` used to be read only as "not the
    // string false", then ANDed with the provider default, so a minio:// URL
    // asking for TLS still produced http://.
    expect(endpointFor("minio://key:secret@example.com/bucket?ssl=true")).toBe(
      "https://example.com",
    );
  });

  it("lets an explicit ssl=false turn TLS off for s3://", () => {
    expect(endpointFor("s3://key:secret@example.com:9000/bucket?ssl=false")).toBe(
      "http://example.com:9000",
    );
  });

  it("preserves the port and drops it when absent", () => {
    // No port means the protocol default (443 / 80), so the endpoint must not
    // grow a stray `:8333`-style suffix that would then be signed.
    expect(endpointFor("s3://key:secret@example.com/bucket?ssl=true")).toBe("https://example.com");
    expect(endpointFor("minio://key:secret@example.com:8333/bucket?ssl=true")).toBe(
      "https://example.com:8333",
    );
  });

  it("combines ssl with the other params relevant to a same-origin proxy", () => {
    expect(
      parseStorageUrl(
        "s3://key:secret@example.com/bucket?ssl=true&force_path_style=true&auto_create=true",
      ),
    ).toMatchObject({
      endpoint: "https://example.com",
      forcePathStyle: true,
      autoCreateBucket: true,
    });
  });
});
