import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { fetchPublicUrl, isPublicAddress, PublicFetchError } from "./public-fetch";

describe("isPublicAddress", () => {
  it.each(["8.8.8.8", "1.1.1.1", "93.184.215.14", "2606:4700:4700::1111"])(
    "allows %s",
    (address) => {
      expect(isPublicAddress(address)).toBe(true);
    },
  );

  it.each([
    ["loopback", "127.0.0.1"],
    ["private 10/8", "10.1.2.3"],
    ["private 172.16/12", "172.20.0.1"],
    ["private 192.168/16", "192.168.1.1"],
    ["cloud metadata", "169.254.169.254"],
    ["Alibaba Cloud metadata (CGNAT)", "100.100.100.200"],
    ["this network", "0.0.0.0"],
    ["benchmarking", "198.18.0.1"],
    ["multicast", "224.0.0.1"],
    ["broadcast", "255.255.255.255"],
    ["IPv6 loopback", "::1"],
    ["IPv6 unique local", "fd00::1"],
    ["IPv6 link-local", "fe80::1"],
    ["IPv4-mapped loopback", "::ffff:127.0.0.1"],
    ["NAT64 of metadata", "64:ff9b::a9fe:a9fe"],
    ["6to4", "2002:7f00:1::1"],
    ["not an IP", "example.com"],
  ])("refuses %s (%s)", (_label, address) => {
    expect(isPublicAddress(address)).toBe(false);
  });
});

describe("fetchPublicUrl", () => {
  let server: http.Server;
  let port: number;
  let hits: string[];

  beforeEach(async () => {
    hits = [];
    server = http.createServer((req, res) => {
      hits.push(`${req.method} ${req.url} host=${req.headers.host}`);
      if (req.url === "/to-metadata") {
        res.writeHead(302, { location: "http://metadata.example/latest/meta-data/" });
        res.end();
      } else if (req.url === "/loop") {
        res.writeHead(302, { location: "/loop" });
        res.end();
      } else if (req.url === "/big") {
        res.writeHead(200, { "content-type": "application/octet-stream" });
        res.write(Buffer.alloc(600));
        res.end(Buffer.alloc(600));
      } else {
        res.writeHead(200, {
          "content-type": "text/plain",
          "last-modified": "Wed, 01 Oct 2026 08:00:00 GMT",
        });
        res.end("public file");
      }
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    port = (server.address() as AddressInfo).port;
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  // Loopback stands in for "a public host" here; everything else keeps the real rule.
  const asPublic = {
    lookup: async (hostname: string) =>
      hostname === "metadata.example"
        ? [{ address: "169.254.169.254", family: 4 as const }]
        : [{ address: "127.0.0.1", family: 4 as const }],
    isPublicAddress: (address: string) => address === "127.0.0.1" || isPublicAddress(address),
  };

  it("refuses a private address without connecting", async () => {
    await expect(fetchPublicUrl(`http://127.0.0.1:${port}/secret`)).rejects.toMatchObject({
      reason: "blocked-address",
    });
    expect(hits).toEqual([]);
  });

  it("refuses a name that resolves to a private address", async () => {
    await expect(
      fetchPublicUrl(`http://files.example:${port}/doc.pptx`, undefined, {
        lookup: async () => [{ address: "10.0.0.5", family: 4 }],
      }),
    ).rejects.toBeInstanceOf(PublicFetchError);
    expect(hits).toEqual([]);
  });

  it("refuses localhost-style names and non-HTTP schemes outright", async () => {
    await expect(fetchPublicUrl("http://localhost/")).rejects.toMatchObject({
      reason: "blocked-address",
    });
    await expect(fetchPublicUrl("http://db.internal/")).rejects.toMatchObject({
      reason: "blocked-address",
    });
    await expect(fetchPublicUrl("file:///etc/passwd")).rejects.toMatchObject({
      reason: "unsupported-protocol",
    });
  });

  it("connects to the checked address, not a second lookup of the name", async () => {
    const response = await fetchPublicUrl(
      `http://files.example:${port}/doc.pptx`,
      undefined,
      asPublic,
    );

    expect(await response.text()).toBe("public file");
    // files.example does not exist; the request reached this server only
    // through the pinned address, with the original Host header.
    expect(hits).toEqual([`GET /doc.pptx host=files.example:${port}`]);
  });

  it("checks every redirect target", async () => {
    await expect(
      fetchPublicUrl(`http://files.example:${port}/to-metadata`, undefined, asPublic),
    ).rejects.toMatchObject({ reason: "blocked-address" });
    expect(hits).toEqual([`GET /to-metadata host=files.example:${port}`]);
  });

  it("stops after too many redirects", async () => {
    await expect(
      fetchPublicUrl(`http://files.example:${port}/loop`, undefined, {
        ...asPublic,
        maxRedirects: 2,
      }),
    ).rejects.toMatchObject({ reason: "too-many-redirects" });
  });

  it("answers HEAD with headers and no body", async () => {
    const response = await fetchPublicUrl(
      `http://files.example:${port}/doc.pptx`,
      { method: "HEAD" },
      asPublic,
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("last-modified")).toBe("Wed, 01 Oct 2026 08:00:00 GMT");
    expect(response.body).toBeNull();
  });

  it("enforces a size limit on streamed bodies", async () => {
    const response = await fetchPublicUrl(`http://files.example:${port}/big`, undefined, {
      ...asPublic,
      maxBytes: 1000,
    });

    await expect(response.arrayBuffer()).rejects.toThrow();
  });
});
