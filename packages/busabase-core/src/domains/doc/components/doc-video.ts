import { nodeViewCtx, SchemaReady } from "@milkdown/kit/core";
import type { Ctx, MilkdownPlugin } from "@milkdown/kit/ctx";
import type { Node as ProseNode } from "@milkdown/kit/prose/model";
import { Plugin, PluginKey } from "@milkdown/kit/prose/state";
import { Decoration, DecorationSet, type NodeViewConstructor } from "@milkdown/kit/prose/view";
import { $prose } from "@milkdown/kit/utils";

/**
 * Video playback for Doc nodes.
 *
 * Markdown has no video primitive, so a `.mp4` can only arrive as an image
 * (`![caption](clip.mp4)`), as raw HTML (`<video src="clip.mp4">`), or as an
 * ordinary link (`[Watch the demo](clip.mp4)`). Milkdown renders the first as
 * `<img src="clip.mp4">` (a broken-image icon), the second as escaped text,
 * and the third as a link out of the page, so none of them play. This module
 * teaches the Doc renderer to hand all three to a real `<video>` element.
 *
 * Everything here is render-only: no schema, parser, or serializer is touched,
 * so the Markdown a Doc round-trips through the editor is byte-identical to
 * what it was before. A video is still an image node (or an html node) in the
 * document — it just draws itself as a player.
 */

const VIDEO_EXTENSIONS = [".mp4", ".webm", ".ogv", ".ogg", ".mov", ".m4v"];

/**
 * Only http(s) and protocol-relative sources are playable. Anything else —
 * notably `javascript:` and `data:` — is rejected rather than handed to a
 * `<video>` element we then attach to the DOM.
 */
function hasSafeScheme(src: string): boolean {
  const trimmed = src.trim();
  if (trimmed.startsWith("//") || trimmed.startsWith("/")) return true;
  // A bare relative path ("clip.mp4", "./clip.mp4") carries no scheme at all.
  if (!/^[a-zA-Z][a-zA-Z\d+\-.]*:/.test(trimmed)) return true;
  return /^https?:/i.test(trimmed);
}

/** Path portion only — `clip.mp4?v=2#t=10` must still read as `.mp4`. */
function pathOf(src: string): string {
  return src.trim().split("#")[0].split("?")[0].toLowerCase();
}

export function isPlayableVideoUrl(src: string | null | undefined): boolean {
  if (!src) return false;
  if (!hasSafeScheme(src)) return false;
  const path = pathOf(src);
  return VIDEO_EXTENSIONS.some((extension) => path.endsWith(extension));
}

/**
 * Builds the player. `controls` is always on — a Doc reader has no other way
 * to start playback — while autoplay is deliberately never set: these render
 * inline in a document, and several may be on screen at once.
 */
function createVideoElement(src: string, caption?: string): HTMLVideoElement {
  const video = document.createElement("video");
  video.src = src;
  video.controls = true;
  video.preload = "metadata";
  video.playsInline = true;
  video.className = "milkdown-video-block";
  if (caption) video.title = caption;
  return video;
}

/**
 * A ProseMirror node view for an image node that points at a video.
 *
 * `ignoreMutation` keeps ProseMirror from re-rendering the node every time the
 * browser mutates the player's own DOM (buffering, controls, fullscreen); a
 * re-render would restart playback. `update` returns false on a src change so
 * ProseMirror rebuilds the view rather than leaving a stale source attached.
 */
function videoNodeView(node: ProseNode): ReturnType<NodeViewConstructor> {
  const src = String(node.attrs.src ?? "");
  const caption = node.attrs.caption ? String(node.attrs.caption) : undefined;
  const dom = createVideoElement(src, caption);

  return {
    dom,
    ignoreMutation: () => true,
    update: (updatedNode) =>
      updatedNode.type === node.type && String(updatedNode.attrs.src ?? "") === src,
    destroy: () => {
      dom.pause();
      dom.removeAttribute("src");
      dom.load();
    },
  };
}

/**
 * Pulls the `src` out of a raw `<video>` tag, either from the tag itself or
 * from a nested `<source>`.
 *
 * The value is read with a scoped regex rather than by parsing the fragment
 * into live DOM: the html node holds author-supplied text, so nothing here may
 * reach `innerHTML`. Only the URL is extracted, and it still has to clear
 * `isPlayableVideoUrl` before a player is built — every other attribute of the
 * original tag is dropped rather than forwarded.
 */
function videoSrcFromRawHtml(value: string): string | null {
  const html = value.trim();
  if (!/^<video[\s>]/i.test(html)) return null;

  const openingTag = html.slice(0, html.indexOf(">") + 1);
  const direct = openingTag.match(/\ssrc\s*=\s*("([^"]*)"|'([^']*)')/i);
  const fromSource = html.match(/<source\b[^>]*?\ssrc\s*=\s*("([^"]*)"|'([^']*)')/i);
  const match = direct ?? fromSource;
  if (!match) return null;

  const src = match[2] ?? match[3] ?? "";
  return isPlayableVideoUrl(src) ? src : null;
}

/** `</video>` left over when remark splits an inline tag pair into two nodes. */
function isVideoClosingTag(value: string): boolean {
  return /^<\/video\s*>$/i.test(value.trim());
}

/**
 * Renders a raw `<video>` tag written in Markdown as a real player.
 *
 * Markdown keeps raw HTML as opaque text and Milkdown's html node draws it
 * escaped, so `<video src="clip.mp4">` reads as literal markup today. This
 * view special-cases exactly that tag — reconstructing a fresh `<video>` from
 * the extracted, scheme-checked URL — and leaves every other html node
 * rendering as escaped text, unchanged.
 */
export function htmlVideoNodeView(node: ProseNode): ReturnType<NodeViewConstructor> {
  const value = String(node.attrs.value ?? "");
  const src = videoSrcFromRawHtml(value);

  if (src) {
    const dom = createVideoElement(src);
    return {
      dom,
      ignoreMutation: () => true,
      update: (updatedNode) => String(updatedNode.attrs.value ?? "") === value,
      destroy: () => {
        dom.pause();
        dom.removeAttribute("src");
        dom.load();
      },
    };
  }

  const span = document.createElement("span");
  span.dataset.type = "html";
  span.dataset.value = value;
  // When remark splits `<video src="…"></video>` into an opening and a closing
  // node, the opener above became a player; drawing its orphaned `</video>`
  // partner as text would leave stray markup beside it. The node itself (and
  // so the Markdown it serializes back to) is untouched — only its display is.
  span.textContent = isVideoClosingTag(value) ? "" : value;
  return { dom: span, ignoreMutation: () => true };
}

/** Image node types that can carry a video URL in their `src` attribute. */
const IMAGE_NODE_NAMES = ["image-block", "image-inline", "image"] as const;

/**
 * Shape of a `nodeViewCtx` entry. Milkdown declares this tuple but does not
 * export it, so it is restated here rather than reaching into its internals.
 */
type NodeViewEntry = [nodeId: string, view: NodeViewConstructor];

/**
 * Wraps whichever node views are already registered for the image nodes.
 *
 * Milkdown builds ProseMirror's `nodeViews` with
 * `Object.fromEntries(ctx.get(nodeViewCtx))`, so the last entry for a given
 * node name wins. This plugin appends entries that check the node's `src`
 * first: a video URL draws a player, and anything else is delegated to the
 * view that was already there — which is what keeps Crepe's image block
 * (caption editing, resize handles, the upload placeholder) intact for
 * ordinary images.
 *
 * It must therefore be registered *after* the features whose views it wraps —
 * i.e. `crepe.editor.use(docVideoPlugin)` on an already-constructed Crepe.
 */
export const docVideoPlugin: MilkdownPlugin = (ctx: Ctx) => async () => {
  await ctx.wait(SchemaReady);

  ctx.update(nodeViewCtx, (views) => {
    const previousFor = (name: string): NodeViewConstructor | undefined => {
      for (let index = views.length - 1; index >= 0; index -= 1) {
        const [registeredName, view] = views[index];
        if (registeredName === name) return view as NodeViewConstructor;
      }
      return undefined;
    };

    const wrapped: NodeViewEntry[] = IMAGE_NODE_NAMES.map((name): NodeViewEntry => {
      const fallback = previousFor(name);
      const nodeView: NodeViewConstructor = (node, view, getPos, decorations, innerDeco) => {
        if (isPlayableVideoUrl(node.attrs.src as string | undefined)) {
          return videoNodeView(node);
        }
        if (fallback) return fallback(node, view, getPos, decorations, innerDeco);
        // No prior view: fall back to ProseMirror's own `toDOM` output by
        // rendering the plain image ourselves rather than crashing.
        const img = document.createElement("img");
        img.src = String(node.attrs.src ?? "");
        if (node.attrs.alt) img.alt = String(node.attrs.alt);
        return { dom: img };
      };
      return [name, nodeView];
    });

    const htmlView: NodeViewEntry = ["html", htmlVideoNodeView as NodeViewConstructor];
    return [...views, ...wrapped, htmlView];
  });
};

/**
 * Position just after the top-level block containing `pos` — where a player
 * for a link inside that block is drawn.
 */
function blockEndPos(doc: ProseNode, pos: number): number | null {
  const resolved = doc.resolve(pos);
  // depth 0 means `pos` is already a top-level node's own position.
  if (resolved.depth === 0) {
    const node = doc.nodeAt(pos);
    return node ? pos + node.nodeSize : null;
  }
  return resolved.after(1);
}

/** YouTube's video ids are exactly 11 characters of this alphabet. */
const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/;

const YOUTUBE_HOSTS = ["youtube.com", "youtu.be", "youtube-nocookie.com"];

/** `?t=90`, `?t=90s`, `?t=1m30s`, `?start=90` — YouTube accepts all of these. */
function parseStartSeconds(raw: string | null): number | null {
  if (!raw) return null;
  if (/^\d+$/.test(raw)) return Number(raw);
  const match = raw.match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/i);
  if (!match || !match.slice(1).some(Boolean)) return null;
  const [hours, minutes, seconds] = match.slice(1).map((part) => Number(part ?? 0) || 0);
  return hours * 3600 + minutes * 60 + seconds;
}

/**
 * Reads a YouTube video id out of a link, or null if the link is not a single
 * playable video.
 *
 * Matching is on the *shape of the path*, never on the host alone: a Doc that
 * links `youtube.com/@buda-ai` is pointing at a channel, and `/playlist`,
 * `/results` and a bare profile URL are not videos either. Turning any of
 * those into a player would misrepresent what the author linked.
 */
export function parseYouTubeVideo(raw: string | null | undefined): {
  videoId: string;
  start: number | null;
} | null {
  const trimmed = raw?.trim();
  if (!trimmed) return null;

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null; // relative or malformed — never a YouTube link
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;

  const host = url.hostname.toLowerCase().replace(/^(www|m|music)\./, "");
  if (!YOUTUBE_HOSTS.includes(host)) return null;

  const segments = url.pathname.split("/").filter(Boolean);
  const videoId =
    host === "youtu.be"
      ? segments[0]
      : url.pathname === "/watch"
        ? (url.searchParams.get("v") ?? undefined)
        : ["shorts", "embed", "live", "v"].includes(segments[0] ?? "")
          ? segments[1]
          : undefined;

  if (!videoId || !YOUTUBE_ID.test(videoId)) return null;

  return {
    videoId,
    start: parseStartSeconds(url.searchParams.get("t") ?? url.searchParams.get("start")),
  };
}

/**
 * What a link should draw, if anything.
 *
 * `kind` decides the element: a media file gets a `<video>`, a YouTube link
 * gets an `<iframe>` (YouTube serves a page, not a file, so a media element
 * cannot play it). Both carry a ready-to-use `src`.
 */
export type DocLinkEmbed = { kind: "video" | "youtube"; src: string };

/**
 * The single place that decides whether a URL is playable and how. Adding
 * another provider (Bilibili, Vimeo) is a branch here; nothing else changes.
 */
export function resolveDocLinkEmbed(href: string | null | undefined): DocLinkEmbed | null {
  const trimmed = href?.trim();
  if (!trimmed) return null;
  if (isPlayableVideoUrl(trimmed)) return { kind: "video", src: trimmed };

  const youtube = parseYouTubeVideo(trimmed);
  if (!youtube) return null;
  // `-nocookie` is YouTube's own privacy-enhanced host: same player, but it
  // sets no tracking cookie until playback actually starts.
  const src = new URL(`https://www.youtube-nocookie.com/embed/${youtube.videoId}`);
  if (youtube.start !== null) src.searchParams.set("start", String(youtube.start));
  return { kind: "youtube", src: src.toString() };
}

export interface DocLinkEmbedMatch {
  embed: DocLinkEmbed;
  /** Where the player is inserted (after the block that holds the link). */
  pos: number;
  /** Stable identity, so ProseMirror reuses the player's DOM across updates
   * instead of rebuilding it — a rebuild restarts playback, and for an iframe
   * it reloads the whole embed. Keyed by ordinal rather than position so that
   * typing (which moves every position after the caret) does not count as a
   * change. */
  key: string;
}

/**
 * Finds every link that should draw a player, mapped to the position right
 * after the block that mentions it.
 *
 * Only links: images and raw `<video>` tags are already drawn as players by
 * the node views above, and re-handling them here would stack two players on
 * the same clip.
 */
export function collectDocLinkEmbeds(doc: ProseNode): DocLinkEmbedMatch[] {
  const matches: DocLinkEmbedMatch[] = [];
  const seen = new Set<string>();

  doc.descendants((node, pos) => {
    if (!node.isText) return true;
    const href = node.marks.find((mark) => mark.type.name === "link")?.attrs.href;
    if (typeof href !== "string") return false;
    const embed = resolveDocLinkEmbed(href);
    if (!embed) return false;
    const at = blockEndPos(doc, pos);
    if (at === null) return false;
    // One link can span several text nodes (`**[title](clip.mp4)**` splits on
    // the strong mark) — collapse those into a single player.
    const spot = `${at}|${embed.src}`;
    if (seen.has(spot)) return false;
    seen.add(spot);
    matches.push({ embed, pos: at, key: `${matches.length}|${embed.src}` });
    return false;
  });

  return matches;
}

/**
 * Renders a player under any block containing a link to a video.
 *
 * A link is a mark, not a node, so the node-view trick used above does not
 * apply; this contributes *widget decorations* instead. Same guarantee though:
 * a decoration lives in the view layer only, so the document — and the
 * Markdown it serializes back to — is untouched. The link itself stays where
 * the author put it and reads as the player's caption, which is also the only
 * thing left to click when an embed cannot load (YouTube is unreachable from
 * mainland China, where the iframe renders as an empty box).
 */
export const docVideoLinkPlugin = $prose(() => {
  let cachedDoc: ProseNode | null = null;
  let cachedSet: DecorationSet | null = null;

  return new Plugin({
    key: new PluginKey("busabase-doc-video-link"),
    props: {
      decorations: (state) => {
        // Also called for selection-only changes; caching by doc identity keeps
        // typing free of the walk.
        if (cachedDoc === state.doc && cachedSet) return cachedSet;
        cachedDoc = state.doc;
        cachedSet = DecorationSet.create(
          state.doc,
          collectDocLinkEmbeds(state.doc).map((match) =>
            Decoration.widget(match.pos, () => wrapEmbedForLink(match.embed), {
              key: match.key,
              side: 1,
              ignoreSelection: true,
              // The player sits inside the contenteditable surface; without
              // this ProseMirror handles the clicks meant for its controls.
              stopEvent: () => true,
            }),
          ),
        );
        return cachedSet;
      },
    },
  });
});

/**
 * The YouTube player. `loading="lazy"` matters more than it looks: a Doc can
 * hold a dozen embeds, and each one is a megabyte of third-party player code —
 * without it, opening the document fetches all of them at once.
 */
function createYouTubeFrame(src: string): HTMLIFrameElement {
  const frame = document.createElement("iframe");
  frame.src = src;
  frame.className = "milkdown-video-embed";
  frame.loading = "lazy";
  frame.title = "YouTube video player";
  frame.allow =
    "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share";
  frame.allowFullscreen = true;
  frame.referrerPolicy = "strict-origin-when-cross-origin";
  return frame;
}

/** The player, in a wrapper marked non-editable so clicks reach its controls. */
function wrapEmbedForLink(embed: DocLinkEmbed): HTMLElement {
  const container = document.createElement("div");
  container.contentEditable = "false";
  container.append(
    embed.kind === "youtube" ? createYouTubeFrame(embed.src) : createVideoElement(embed.src),
  );
  return container;
}
