import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRouterClient } from "@orpc/server";
import { storage } from "openlib/storage";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runWithBusabaseContext, runWithEmbedContext } from "../src/context";
import { buildAssetContentUrl } from "../src/domains/assets/utils/asset-content-url";
import { createEmbedAssetRouteHandler } from "../src/domains/embed-links/asset-route";
import {
  embedCapabilityCookieName,
  encodeEmbedCapability,
} from "../src/domains/embed-links/capability";
import { resolveEmbedLink, resolveEmbedRequestContext } from "../src/domains/embed-links/logic";
import { busabaseRouter } from "../src/router";

/**
 * The embedded Node Detail view reads a Doc's images, a readme's images and a
 * File's download through `/embed/:publicId/assets/:assetId/raw`, authorized by
 * the link instead of a session. Against a real router + PGLite + local storage.
 */

type Client = ReturnType<typeof createRouterClient<typeof busabaseRouter, Record<never, never>>>;

const MIGRATIONS_CWD = path.resolve(__dirname, "../../../apps/busabase");

describe("Embed Link asset reads", () => {
  let dataDir = "";
  let storageDir = "";
  let originalCwd = "";
  let client: Client;
  const GET = createEmbedAssetRouteHandler();

  const upload = async (fileName: string, seed: string) => {
    const bytes = Buffer.alloc(97, seed);
    const contentHash = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
    const req = await client.assets.createUploadUrl({
      fileName,
      mimeType: "image/png",
      sizeBytes: bytes.length,
      contentHash,
    });
    await storage.uploadFileToKey(bytes, req.storageKey, "image/png");
    await client.assets.confirm({
      storageKey: req.storageKey,
      fileName,
      mimeType: "image/png",
      sizeBytes: bytes.length,
      contentHash,
    });
    const asset = (await client.assets.list()).find((a) => a.contentHash === contentHash);
    if (!asset) throw new Error(`upload of ${fileName} did not register an asset`);
    return asset;
  };

  const request = (publicId: string, assetId: string, query: string, cookie?: string) =>
    GET(
      new Request(`http://localhost:15419/embed/${publicId}/assets/${assetId}/raw${query}`, {
        headers: cookie ? { cookie } : {},
      }),
      { params: Promise.resolve({ publicId, assetId }) },
    );

  beforeAll(async () => {
    originalCwd = process.cwd();
    process.chdir(MIGRATIONS_CWD);
    dataDir = await mkdtemp(path.join(os.tmpdir(), "busabase-embed-assets-db-"));
    storageDir = await mkdtemp(path.join(os.tmpdir(), "busabase-embed-assets-storage-"));
    process.env.PG_DATABASE_URL = `pglite://${dataDir}`;
    process.env.STORAGE_URL = `local:${storageDir}?base_url=/api/test/storage`;
    client = createRouterClient(busabaseRouter);
  });

  afterAll(async () => {
    delete process.env.PG_DATABASE_URL;
    delete process.env.STORAGE_URL;
    if (originalCwd) process.chdir(originalCwd);
    for (const dir of [dataDir, storageDir]) {
      if (dir) await rm(dir, { recursive: true, force: true });
    }
  });

  it("serves the shared Doc's image to the link holder, and nothing the Doc does not mount", async () => {
    // One real actor uploads, writes the Doc and creates the link — as on
    // Cloud, where the link's creator is also the owner of their own staging
    // uploads. The link must not inherit that ownership.
    const owner = <T>(fn: () => Promise<T>) =>
      runWithBusabaseContext({ actorId: "usr_embed_owner" }, fn);
    const image = await owner(() => upload("diagram.png", "a"));
    const staged = await owner(() => upload("not-yet-used.png", "b"));
    const doc = await owner(() =>
      client.docs.create({
        autoMerge: true,
        slug: "embedded-runbook",
        name: "Embedded Runbook",
        body: `# Runbook\n\n![diagram](${buildAssetContentUrl(image.id)})\n`,
      }),
    );
    if (!("node" in doc)) throw new Error("expected a materialized Doc");
    const created = await owner(() =>
      client.embedLinks.create({
        type: "node",
        typeId: doc.node.id,
        expiresInMinutes: 30,
        framePolicy: { mode: "anywhere", allowedOrigins: [] },
      }),
    );
    const secret = new URL(created.url).searchParams.get("token") ?? "";

    // The page gets identity only; content is read by the Node Detail views.
    await expect(resolveEmbedLink(created.id, secret)).resolves.toMatchObject({
      type: "node",
      node: { id: doc.node.id, type: "doc", slug: "embedded-runbook", name: "Embedded Runbook" },
    });

    // An iframe (or a sandboxed readme frame) passes the token on the URL.
    const preview = await request(created.id, image.id, `?token=${secret}`);
    expect(preview.status).toBe(302);
    expect(preview.headers.get("location")).toContain("/api/test/storage/");
    expect(preview.headers.get("cache-control")).toBe("private, no-store");
    expect(preview.headers.get("referrer-policy")).toBe("no-referrer");

    // A top-level visit already holds the `/embed/:publicId`-scoped cookie.
    const cookie = `${embedCapabilityCookieName(created.id)}=${encodeURIComponent(
      encodeEmbedCapability(created.id, secret),
    )}`;
    expect((await request(created.id, image.id, "", cookie)).status).toBe(302);

    const download = await request(
      created.id,
      image.id,
      `?token=${secret}&download=1&filename=diagram.png`,
    );
    expect(download.status).toBe(200);
    expect(download.headers.get("content-disposition")).toContain("attachment");
    expect(download.headers.get("cache-control")).toBe("private, no-store");

    // An upload no node mounts is the creator's staging object, not the Doc's.
    expect((await request(created.id, staged.id, `?token=${secret}`)).status).toBe(404);
    // So is it through the RPC surface the text preview uses.
    const context = await resolveEmbedRequestContext(created.id, secret);
    if (!context) throw new Error("expected a live embed context");
    await expect(
      runWithEmbedContext(context, () =>
        createRouterClient(busabaseRouter).assets.readTextLines({
          assetId: staged.id,
          startLine: 1,
          endLine: 10,
        }),
      ),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });

    // No capability, a wrong one, or another link's id: the same neutral 404.
    expect((await request(created.id, image.id, "")).status).toBe(404);
    expect((await request(created.id, image.id, `?token=${"x".repeat(43)}`)).status).toBe(404);
    expect((await request("emb_Abcdefghijklmno1", image.id, `?token=${secret}`)).status).toBe(404);

    await owner(() => client.embedLinks.revoke({ id: created.id }));
    expect((await request(created.id, image.id, `?token=${secret}`)).status).toBe(404);
  });

  it("serves only the linked record's attachments, never another row's assets in the same Base", async () => {
    const own = await upload("shared-record.png", "record-own");
    const sibling = await upload("sibling-record.png", "record-other");
    const base = await client.bases.create({
      autoMerge: true,
      slug: "record-asset-scope",
      name: "Private attachments",
      fields: [
        { slug: "title", name: "Title", type: "text" },
        { slug: "file", name: "File", type: "attachment" },
      ],
    });
    const ref = (asset: typeof own) => ({
      id: asset.id,
      assetId: asset.id,
      url: asset.url,
      attachmentId: asset.attachmentId,
      fileName: asset.fileName,
      mimeType: asset.mimeType,
      size: asset.size,
    });
    const target = await client.bases.createChangeRequest({
      baseId: base.id,
      fields: { title: "Shared record", file: [ref(own)] },
      autoMerge: true,
    });
    await client.bases.createChangeRequest({
      baseId: base.id,
      fields: { title: "Sibling record", file: [ref(sibling)] },
      autoMerge: true,
    });
    const link = await client.embedLinks.create({
      type: "record-detail",
      typeId: target.id,
      expiresInMinutes: 30,
    });
    const secret = new URL(link.url).searchParams.get("token") ?? "";
    expect((await request(link.id, own.id, `?token=${secret}`)).status).toBe(302);
    expect((await request(link.id, sibling.id, `?token=${secret}`)).status).toBe(404);
    const active = await resolveEmbedRequestContext(link.id, secret);
    expect(active?.embedRecordScope?.recordId).toBe(target.id);
    if (!active) throw new Error("expected scoped record context");
    const { resolveAssetContent } = await import("../src/domains/assets/logic/asset-content-logic");
    await expect(
      runWithEmbedContext(active, () => resolveAssetContent(sibling.id)),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
