/**
 * Cover-image demo fixture — a real, decodable PNG (not a text buffer dressed
 * up with an image mime type). Every other "image" in the demo dataset
 * (`BLOG_COVERS`/`cover_image` field values in `dataset.ts`) is a plain string
 * URL that was never written through the attachment/asset pipeline, so the
 * dump round-trip test never exercised a real binary image. This fixture is
 * seeded through the exact same `createAsset`-shaped path as
 * `seedFileNodesIfMissing`/`seedGrepDemoFixture` (see `logic/seed.ts`'s
 * `seedImageAssetFixture`), so it is real end to end: real bytes in storage,
 * a real `attachments` row, a real `busabase_assets` row, and a real
 * `busabase_asset_usages` row wired to a Blog Posts record's `cover_image`
 * field — not a string literal.
 */

/**
 * The smallest possible valid PNG: a 1x1 fully-transparent pixel. Bytes are
 * the well-known minimal PNG (8-byte signature + IHDR + IDAT + IEND chunks,
 * each with a correct CRC32), so any real PNG decoder accepts it.
 */
export const buildMinimalPngBuffer = (): Buffer =>
  Buffer.from(
    "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000b49444154789c636000020000" +
      "0500017a5eab3f0000000049454e44ae426082",
    "hex",
  );

export const COVER_IMAGE_FIXTURE_FILE_NAME = "ai-agent-workflows-cover-demo.png";
