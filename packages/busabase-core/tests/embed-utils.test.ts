import { describe, expect, it } from "vitest";
import type { FieldDef } from "../src/domains/base/field-types";
import {
  embedAspectRatio,
  embedHeight,
  resolveEmbedPreview,
  validateEmbedUrl,
} from "../src/domains/base/utils/embed";

const def = (options?: FieldDef["options"]): FieldDef => ({
  slug: "embed",
  name: "Embed",
  type: "embed",
  options: options ?? {},
});

describe("embed url helpers", () => {
  it("converts YouTube watch, short, and embed URLs to privacy-enhanced embed URLs", () => {
    expect(resolveEmbedPreview("https://www.youtube.com/watch?v=dQw4w9WgXcQ", def())).toMatchObject(
      {
        provider: "youtube",
        embedUrl: "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?rel=0&modestbranding=1",
        label: "YouTube",
      },
    );
    expect(resolveEmbedPreview("https://youtu.be/dQw4w9WgXcQ", def())?.embedUrl).toContain(
      "/embed/dQw4w9WgXcQ",
    );
    expect(
      resolveEmbedPreview("https://www.youtube.com/embed/dQw4w9WgXcQ", def())?.embedUrl,
    ).toContain("/embed/dQw4w9WgXcQ");
    expect(
      resolveEmbedPreview("https://m.youtube.com/shorts/dQw4w9WgXcQ?feature=share", def())
        ?.embedUrl,
    ).toContain("/embed/dQw4w9WgXcQ");
    expect(
      resolveEmbedPreview("https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ", def())?.embedUrl,
    ).toContain("/embed/dQw4w9WgXcQ");
  });

  it("converts Google Drive file URLs to preview URLs", () => {
    expect(resolveEmbedPreview("https://drive.google.com/file/d/abc123/view", def())).toMatchObject(
      {
        provider: "google_drive",
        embedUrl: "https://drive.google.com/file/d/abc123/preview",
        label: "Google Drive",
      },
    );
    expect(resolveEmbedPreview("https://drive.google.com/open?id=abc123", def())?.embedUrl).toBe(
      "https://drive.google.com/file/d/abc123/preview",
    );
    expect(resolveEmbedPreview("https://docs.google.com/file/d/doc123/edit", def())).toMatchObject({
      provider: "google_drive",
      embedUrl: "https://drive.google.com/file/d/doc123/preview",
      hostname: "docs.google.com",
    });
  });

  it("supports generic http(s) URLs unless a provider allowlist blocks them", () => {
    expect(resolveEmbedPreview("https://example.com/embed", def())).toMatchObject({
      provider: "generic",
      embedUrl: "https://example.com/embed",
      label: "example.com",
    });
    expect(
      resolveEmbedPreview("https://example.com/embed", def({ embed: { providers: ["youtube"] } })),
    ).toBeNull();
  });

  it("enforces provider allowlists without blocking the allowed provider", () => {
    const youtubeOnly = def({ embed: { providers: ["youtube"] } });
    expect(resolveEmbedPreview("https://youtu.be/dQw4w9WgXcQ", youtubeOnly)?.provider).toBe(
      "youtube",
    );
    expect(
      resolveEmbedPreview("https://drive.google.com/file/d/abc123/view", youtubeOnly),
    ).toBeNull();

    const driveOnly = def({ embed: { providers: ["google_drive"] } });
    expect(
      resolveEmbedPreview("https://drive.google.com/file/d/abc123/view", driveOnly)?.provider,
    ).toBe("google_drive");
    expect(
      resolveEmbedPreview("https://www.youtube.com/watch?v=dQw4w9WgXcQ", driveOnly),
    ).toBeNull();
  });

  it("rejects non-http URLs and malformed values", () => {
    expect(resolveEmbedPreview("ftp://example.com/file", def())).toBeNull();
    expect(resolveEmbedPreview("not a url", def())).toBeNull();
    expect(resolveEmbedPreview(123, def())).toBeNull();
  });

  it("validates embed values with the display field name", () => {
    expect(validateEmbedUrl("https://www.youtube.com/watch?v=dQw4w9WgXcQ", def())).toBeNull();
    expect(
      validateEmbedUrl("https://example.com/embed", {
        ...def({ embed: { providers: ["youtube"] } }),
        name: { en: "Training video" },
      }),
    ).toBe("Training video must be an embeddable http(s) URL");
  });

  it("reads aspect ratio and fixed height options with stable defaults", () => {
    expect(embedAspectRatio(def())).toBe("16:9");
    expect(embedHeight(def())).toBeUndefined();
    expect(embedAspectRatio(def({ embed: { aspectRatio: "4:3", height: 480 } }))).toBe("4:3");
    expect(embedHeight(def({ embed: { aspectRatio: "1:1", height: 320 } }))).toBe(320);
  });
});
