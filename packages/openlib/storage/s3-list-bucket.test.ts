import { createServer, type Server } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { S3Storage } from "./s3";

/** The real AWS serializer/deserializer talks HTTP; no storage methods are stubbed. */
describe("S3 initial listing", () => {
  let server: Server | undefined;

  afterEach(async () => {
    if (!server) return;
    server.closeAllConnections();
    await new Promise<void>((resolve) => server?.close(() => resolve()));
  });

  const setup = async (autoCreateBucket: boolean, forbidden = false) => {
    const requests: Array<{ method: string; query: URLSearchParams }> = [];
    let bucketExists = false;
    server = createServer((request, response) => {
      const query = new URL(request.url ?? "/", "http://localhost").searchParams;
      requests.push({ method: request.method ?? "", query });
      if (request.method === "HEAD") {
        response.writeHead(forbidden ? 403 : bucketExists ? 200 : 404).end();
      } else if (request.method === "PUT") {
        bucketExists = true;
        request.resume();
        response.writeHead(200).end();
      } else if (!bucketExists) {
        response.writeHead(404, { "content-type": "application/xml" });
        response.end(
          "<Error><Code>NoSuchBucket</Code><Message>Bucket does not exist</Message></Error>",
        );
      } else {
        response.writeHead(200, { "content-type": "application/xml" });
        response.end(
          '<ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/">' +
            "<Name>fresh-backup</Name><IsTruncated>true</IsTruncated>" +
            "<NextContinuationToken>next-page</NextContinuationToken>" +
            "<Contents><Key>busabase/dump-staging-v1/receipt.json</Key><Size>17</Size>" +
            "<LastModified>2026-11-11T00:00:00.000Z</LastModified></Contents></ListBucketResult>",
        );
      }
    });
    await new Promise<void>((resolve) => server?.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Expected a TCP address");
    const storage = new S3Storage({
      provider: "s3",
      endpoint: `http://127.0.0.1:${address.port}`,
      bucketName: "fresh-backup",
      accessKeyId: "test-key",
      secretAccessKey: "test-secret",
      region: "us-east-1",
      forcePathStyle: true,
      autoCreateBucket,
    });
    return { storage, requests };
  };

  it("creates an explicitly auto-created bucket before its initial recovery scan", async () => {
    const { storage, requests } = await setup(true);
    const result = await storage.listObjects("busabase/dump-staging-v1/", 7, "previous-page");

    expect(requests.map((request) => request.method)).toEqual(["HEAD", "PUT", "GET"]);
    expect(requests[2].query.get("prefix")).toBe("busabase/dump-staging-v1/");
    expect(requests[2].query.get("max-keys")).toBe("7");
    expect(requests[2].query.get("continuation-token")).toBe("previous-page");
    expect(result).toEqual({
      objects: [
        {
          key: "busabase/dump-staging-v1/receipt.json",
          size: 17,
          lastModified: new Date("2026-11-11T00:00:00.000Z"),
        },
      ],
      isTruncated: true,
      nextContinuationToken: "next-page",
    });
  });

  it("preserves a missing-bucket error when auto creation was not requested", async () => {
    const { storage, requests } = await setup(false);
    await expect(storage.listObjects("busabase/dump-staging-v1/")).rejects.toMatchObject({
      name: "NoSuchBucket",
    });
    expect(requests.map((request) => request.method)).toEqual(["GET"]);
  });

  it("does not create a bucket when its metadata check is forbidden", async () => {
    const { storage, requests } = await setup(true, true);
    await expect(storage.listObjects("busabase/dump-staging-v1/")).rejects.toMatchObject({
      $metadata: { httpStatusCode: 403 },
    });
    expect(requests.map((request) => request.method)).toEqual(["HEAD"]);
  });
});
