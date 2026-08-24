import { Schema } from "@milkdown/kit/prose/model";
import { describe, expect, it } from "vitest";
import {
  collectDocLinkEmbeds,
  isPlayableVideoUrl,
  parseYouTubeVideo,
  resolveDocLinkEmbed,
} from "../src/domains/doc/components/doc-video";

describe("isPlayableVideoUrl", () => {
  it("accepts the video extensions a Doc can carry", () => {
    for (const url of [
      "https://cdn.example.com/clip.mp4",
      "https://cdn.example.com/clip.webm",
      "https://cdn.example.com/clip.mov",
      "https://cdn.example.com/clip.m4v",
      "https://cdn.example.com/clip.ogv",
      "http://cdn.example.com/clip.mp4",
    ]) {
      expect(isPlayableVideoUrl(url), url).toBe(true);
    }
  });

  it("accepts relative and protocol-relative sources", () => {
    expect(isPlayableVideoUrl("/assets/clip.mp4")).toBe(true);
    expect(isPlayableVideoUrl("clip.mp4")).toBe(true);
    expect(isPlayableVideoUrl("./nested/clip.mp4")).toBe(true);
    expect(isPlayableVideoUrl("//cdn.example.com/clip.mp4")).toBe(true);
  });

  it("ignores a query string or fragment when reading the extension", () => {
    // The migrated Buda kit links carry cache-busting params like `?v=0519`.
    expect(isPlayableVideoUrl("https://cdn.example.com/clip.mp4?v=0519")).toBe(true);
    expect(isPlayableVideoUrl("https://cdn.example.com/clip.mp4#t=10")).toBe(true);
    expect(isPlayableVideoUrl("https://cdn.example.com/clip.mp4?a=1#t=10")).toBe(true);
  });

  it("is case-insensitive about the extension", () => {
    expect(isPlayableVideoUrl("https://cdn.example.com/CLIP.MP4")).toBe(true);
  });

  it("leaves images and other files alone", () => {
    for (const url of [
      "https://cdn.example.com/photo.png",
      "https://cdn.example.com/photo.jpg",
      "https://cdn.example.com/doc.pdf",
      "https://cdn.example.com/clip.mp4.png",
      "https://cdn.example.com/no-extension",
      "https://cdn.example.com/mp4",
    ]) {
      expect(isPlayableVideoUrl(url), url).toBe(false);
    }
  });

  it("refuses sources whose scheme must never reach a media element", () => {
    // A `<video src>` is attached to the live DOM, so the scheme is checked
    // before the element is built rather than trusting the author's Markdown.
    for (const url of [
      "javascript:alert(1)//clip.mp4",
      "data:video/mp4;base64,AAAA",
      "vbscript:msgbox//clip.mp4",
      "file:///etc/passwd.mp4",
    ]) {
      expect(isPlayableVideoUrl(url), url).toBe(false);
    }
  });

  it("treats an absent source as not playable", () => {
    expect(isPlayableVideoUrl(undefined)).toBe(false);
    expect(isPlayableVideoUrl(null)).toBe(false);
    expect(isPlayableVideoUrl("")).toBe(false);
    expect(isPlayableVideoUrl("   ")).toBe(false);
  });
});

// A minimal stand-in for Crepe's schema — only the shapes the link collector
// looks at (blocks, links, the marks that split a link's text).
const schema = new Schema({
  nodes: {
    doc: { content: "block+" },
    paragraph: { group: "block", content: "inline*" },
    blockquote: { group: "block", content: "block+" },
    "image-block": { group: "block", atom: true, attrs: { src: { default: "" } } },
    text: { group: "inline" },
  },
  marks: { link: { attrs: { href: { default: "" } } }, strong: {} },
});

const { doc, paragraph, blockquote } = schema.nodes;
const link = (href: string) => schema.marks.link.create({ href });
const strong = () => schema.marks.strong.create();

describe("collectDocLinkEmbeds", () => {
  it("puts the player after the top-level block holding the link", () => {
    // The shape the migrated Buda kit Docs use: `> 🎥 **[title](clip.mp4)**`.
    const quote = blockquote.create(null, [
      paragraph.create(null, [
        schema.text("🎥 ", []),
        schema.text("Watch the demo", [link("https://cdn.example.com/clip.mp4"), strong()]),
      ]),
    ]);
    const document = doc.create(null, [quote, paragraph.create(null, schema.text("after"))]);

    const embeds = collectDocLinkEmbeds(document);

    expect(embeds).toHaveLength(1);
    expect(embeds[0]?.embed).toEqual({ kind: "video", src: "https://cdn.example.com/clip.mp4" });
    // Right after the blockquote, i.e. before the paragraph that follows it.
    expect(embeds[0]?.pos).toBe(quote.nodeSize);
  });

  it("emits one player per link even when marks split the link text", () => {
    const href = "https://cdn.example.com/clip.mp4";
    const document = doc.create(null, [
      paragraph.create(null, [
        schema.text("Watch ", [link(href)]),
        schema.text("this", [link(href), strong()]),
      ]),
    ]);

    expect(collectDocLinkEmbeds(document)).toHaveLength(1);
  });

  it("keeps two different videos in one block apart", () => {
    const document = doc.create(null, [
      paragraph.create(null, [
        schema.text("one", [link("https://cdn.example.com/a.mp4")]),
        schema.text(" "),
        schema.text("two", [link("https://cdn.example.com/b.mp4")]),
      ]),
    ]);

    expect(collectDocLinkEmbeds(document).map((found) => found.embed.src)).toEqual([
      "https://cdn.example.com/a.mp4",
      "https://cdn.example.com/b.mp4",
    ]);
  });

  it("ignores ordinary links, and images (a node view already plays those)", () => {
    const document = doc.create(null, [
      paragraph.create(null, [schema.text("pricing", [link("https://buda.im/pricing")])]),
      schema.nodes["image-block"].create({ src: "https://cdn.example.com/clip.mp4" }),
    ]);

    expect(collectDocLinkEmbeds(document)).toEqual([]);
  });

  it("gives every player a stable key so playback survives a re-render", () => {
    const document = doc.create(null, [
      paragraph.create(null, [schema.text("a", [link("https://cdn.example.com/a.mp4")])]),
      paragraph.create(null, [schema.text("b", [link("https://cdn.example.com/b.mp4")])]),
    ]);

    const keys = collectDocLinkEmbeds(document).map((found) => found.key);

    expect(new Set(keys).size).toBe(2);
    expect(collectDocLinkEmbeds(document).map((found) => found.key)).toEqual(keys);
  });
});

describe("parseYouTubeVideo", () => {
  it("reads the id out of every link shape YouTube hands out", () => {
    for (const url of [
      "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      "https://youtube.com/watch?v=dQw4w9WgXcQ&feature=share",
      "https://m.youtube.com/watch?v=dQw4w9WgXcQ",
      "https://music.youtube.com/watch?v=dQw4w9WgXcQ",
      "https://youtu.be/dQw4w9WgXcQ",
      "https://www.youtube.com/shorts/dQw4w9WgXcQ",
      "https://www.youtube.com/embed/dQw4w9WgXcQ",
      "https://www.youtube.com/live/dQw4w9WgXcQ",
      "http://www.youtube.com/v/dQw4w9WgXcQ",
    ]) {
      expect(parseYouTubeVideo(url)?.videoId, url).toBe("dQw4w9WgXcQ");
    }
  });

  it("reads the start timestamp in each format YouTube writes it", () => {
    expect(parseYouTubeVideo("https://youtu.be/dQw4w9WgXcQ?t=90")?.start).toBe(90);
    expect(parseYouTubeVideo("https://youtu.be/dQw4w9WgXcQ?t=90s")?.start).toBe(90);
    expect(parseYouTubeVideo("https://youtu.be/dQw4w9WgXcQ?t=1m30s")?.start).toBe(90);
    expect(parseYouTubeVideo("https://youtu.be/dQw4w9WgXcQ?t=1h2m3s")?.start).toBe(3723);
    expect(parseYouTubeVideo("https://www.youtube.com/watch?v=dQw4w9WgXcQ&start=42")?.start).toBe(
      42,
    );
    expect(parseYouTubeVideo("https://youtu.be/dQw4w9WgXcQ")?.start).toBeNull();
  });

  it("refuses YouTube URLs that are not a single video", () => {
    for (const url of [
      // The Product Brief Doc links exactly this — a channel, not a video.
      "https://www.youtube.com/@buda-ai",
      "https://www.youtube.com/playlist?list=PL123",
      "https://www.youtube.com/results?search_query=buda",
      "https://www.youtube.com/c/SomeChannel",
      "https://www.youtube.com/watch?list=PL123",
      "https://www.youtube.com/watch?v=too-short",
      "https://www.youtube.com/shorts/",
    ]) {
      expect(parseYouTubeVideo(url), url).toBeNull();
    }
  });

  it("refuses look-alike hosts and non-http schemes", () => {
    expect(parseYouTubeVideo("https://notyoutube.com/watch?v=dQw4w9WgXcQ")).toBeNull();
    expect(parseYouTubeVideo("https://youtube.com.evil.test/watch?v=dQw4w9WgXcQ")).toBeNull();
    expect(parseYouTubeVideo("javascript:alert(1)//youtube.com/watch?v=dQw4w9WgXcQ")).toBeNull();
    expect(parseYouTubeVideo("/watch?v=dQw4w9WgXcQ")).toBeNull();
    expect(parseYouTubeVideo(null)).toBeNull();
  });
});

describe("resolveDocLinkEmbed", () => {
  it("sends a media file to a <video> and YouTube to the no-cookie embed host", () => {
    expect(resolveDocLinkEmbed("https://cdn.example.com/clip.mp4")).toEqual({
      kind: "video",
      src: "https://cdn.example.com/clip.mp4",
    });
    expect(resolveDocLinkEmbed("https://www.youtube.com/watch?v=dQw4w9WgXcQ")).toEqual({
      kind: "youtube",
      src: "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ",
    });
    expect(resolveDocLinkEmbed("https://youtu.be/dQw4w9WgXcQ?t=1m30s")).toEqual({
      kind: "youtube",
      src: "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?start=90",
    });
  });

  it("leaves an ordinary link alone", () => {
    expect(resolveDocLinkEmbed("https://buda.im/pricing")).toBeNull();
    expect(resolveDocLinkEmbed("https://www.youtube.com/@buda-ai")).toBeNull();
    expect(resolveDocLinkEmbed("")).toBeNull();
  });
});

describe("collectDocLinkEmbeds with a YouTube link", () => {
  it("draws a player for a video link and nothing for a channel link", () => {
    const document = doc.create(null, [
      paragraph.create(null, [
        schema.text("watch", [link("https://www.youtube.com/watch?v=dQw4w9WgXcQ")]),
      ]),
      paragraph.create(null, [
        schema.text("our channel", [link("https://www.youtube.com/@buda-ai")]),
      ]),
    ]);

    const embeds = collectDocLinkEmbeds(document);

    expect(embeds).toHaveLength(1);
    expect(embeds[0]?.embed).toEqual({
      kind: "youtube",
      src: "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ",
    });
  });
});
