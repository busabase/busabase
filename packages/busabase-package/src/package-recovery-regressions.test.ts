import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { PACKAGE_FORMAT, type PackageManifest } from "busabase-contract/domains/package/types";
import { describe, expect, it } from "vitest";
import type { PackageClient } from "./client";
import { collectPackageTree } from "./collect";
import { type PackageFiles, readPackageTree } from "./layout-read";
import { renderPackageTree } from "./layout-write";
import type { PackageFileTreeNode, PackageTree } from "./tree";

const manifest: PackageManifest = {
  format: PACKAGE_FORMAT,
  name: "recovery",
  description: "",
  tags: [],
};
const filesWith = (path: string, bytes: Buffer): PackageFiles =>
  new Map([
    ["busabase.json", Buffer.from(JSON.stringify(manifest))],
    [path, bytes],
  ]);

describe("package recovery regressions", () => {
  it("preserves an authored replacement character, but rejects malformed UTF-8 bytes", () => {
    const doc = Buffer.from("A literal replacement character: �\n", "utf8");
    expect(readPackageTree(filesWith("content/report.md", doc)).nodes[0]).toMatchObject({
      type: "doc",
      body: doc.toString("utf8").trimEnd(),
    });
    expect(() =>
      readPackageTree(filesWith("content/report.md", Buffer.from([0x61, 0xc3, 0x28]))),
    ).toThrow("content/report.md is not valid UTF-8 text");
  });

  it("reads records containing U+FFFD without changing their values", () => {
    const files = filesWith(
      "content/reports/base.json",
      Buffer.from(
        JSON.stringify({
          name: "Reports",
          fields: [
            {
              slug: "title",
              name: "Title",
              type: "text",
              required: true,
              position: 0,
              options: {},
            },
          ],
          views: [],
        }),
      ),
    );
    files.set(
      "content/reports/records.ndjson",
      Buffer.from(`${JSON.stringify({ key: "r1", fields: { title: "Original � report" } })}\n`),
    );
    const node = readPackageTree(files).nodes[0];
    expect(node.type).toBe("base");
    if (node.type !== "base") throw new Error("Expected Reports Base");
    expect(node.records[0].fields.title).toBe("Original � report");
  });

  it("round-trips tsconfig.node.json as verbatim file-tree content", () => {
    const bytes = Buffer.from('{"compilerOptions":{"composite":true}}\n');
    const tree: PackageTree = {
      manifest,
      nodes: [
        {
          type: "drive",
          slug: "vite-source",
          name: "Vite source",
          position: 0,
          description: "",
          files: [{ path: "tsconfig.node.json", bytes }],
        },
      ],
    };
    const rendered = renderPackageTree(tree);
    expect(rendered.get("content/vite-source/tsconfig.node.json")).toEqual(bytes);
    const restored = readPackageTree(rendered).nodes[0] as PackageFileTreeNode;
    expect(restored.files).toEqual([{ path: "tsconfig.node.json", bytes }]);
  });

  it("exports binary bytes from assetUrl when the file API returns empty content", async () => {
    const bytes = Buffer.from([0x00, 0xff, 0x80, 0x42]);
    const paths: string[] = [];
    const server = createServer((request, response) => {
      paths.push(request.url ?? "");
      if (request.url !== "/binary") {
        response.writeHead(404).end();
        return;
      }
      response.writeHead(200, { "content-type": "application/octet-stream" });
      response.end(bytes);
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    try {
      const { port } = server.address() as AddressInfo;
      const client = {
        fileTrees: {
          listFiles: async () => [{ path: "sample.bin" }],
          readFile: async () => ({ encoding: "url", content: "", assetUrl: "/binary" }),
        },
      } as unknown as PackageClient;
      const tree = await collectPackageTree(
        client,
        {
          id: "nod_drive",
          slug: "drive",
          type: "drive",
          name: "Drive",
          description: "",
          position: 0,
        },
        { manifest, warn: () => {}, baseUrl: `http://127.0.0.1:${port}` },
      );
      expect((tree.nodes[0] as PackageFileTreeNode).files[0].bytes).toEqual(bytes);
      expect(paths).toEqual(["/binary"]);
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });
});
