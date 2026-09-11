import { getNodeType } from "busabase-contract/domains";
import type { NodeIcon } from "busabase-contract/types";
import {
  AppWindow,
  CodeXml,
  File,
  FileText,
  Folder,
  Form,
  HardDrive,
  type LucideIcon,
  type LucideProps,
  PenTool,
  Sparkles,
  Table2,
  Workflow,
} from "lucide-react";
import { createElement, forwardRef, useId } from "react";

/**
 * Maps a node-type definition's platform-neutral `icon` id (declared in each
 * domain's definition.ts) to a concrete lucide-react component. Single source of
 * truth for node icons on web — used by the sidebar tree and the New dialog.
 * Shared by every Busabase host (open-source `apps/busabase` + cloud `busabase-dashboard`).
 */
const ICON_BY_ID: Record<string, LucideIcon> = {
  folder: Folder,
  form: Form,
  table: Table2,
  sparkles: Sparkles,
  "hard-drive": HardDrive,
  "app-window": AppWindow,
  file: File,
  "file-text": FileText,
  "pen-tool": PenTool,
  workflow: Workflow,
  "code-xml": CodeXml,
};

export const nodeIconForId = (iconId: string | undefined): LucideIcon =>
  (iconId ? ICON_BY_ID[iconId] : undefined) ?? Folder;

export const nodeIconForType = (type: string): LucideIcon => nodeIconForId(getNodeType(type)?.icon);

/** A node's resolved avatar — a custom emoji/image, or a fallback to its type icon. */
export type ResolvedNodeIcon =
  | { kind: "emoji"; value: string }
  | { kind: "image"; url: string; shape: "app" | "square" }
  | { kind: "type"; Icon: LucideIcon };

/**
 * Resolves a node's DISPLAY icon: its own custom `icon` (emoji or
 * cropped/uploaded image) when set, otherwise its node-type default
 * (`nodeIconForType`) — same fallback every host already renders for a node
 * with no custom icon, so this is purely additive.
 */
export const resolveNodeIcon = (node: {
  type: string;
  icon?: NodeIcon | null;
}): ResolvedNodeIcon => {
  if (node.icon?.type === "emoji" && node.icon.value) {
    return { kind: "emoji", value: node.icon.value };
  }
  if (node.icon?.type === "attachment" && node.icon.url) {
    return {
      kind: "image",
      url: node.icon.url,
      shape: node.type === "airapp" ? "app" : "square",
    };
  }
  return { kind: "type", Icon: nodeIconForType(node.type) };
};

/**
 * A node's real avatar (custom emoji / uploaded image) with its type icon as
 * the fallback — the ONE place every "show this node's own identity" list
 * item resolves its icon from, so a custom icon set anywhere in the app
 * renders identically everywhere that node is shown: the Search dialog's
 * Recent/Skills/Apps tabs, the Home page's Recently Visited cards, and any
 * future list of the same kind. Before this was shared, the Recent tab and
 * the Home page's recent list each called `nodeIconForType` directly and so
 * could only ever show the generic type icon — a node with a custom emoji
 * would show it in the Skills/Apps tabs and silently lose it the moment the
 * same node appeared in Recent.
 *
 * Written with `createElement` rather than JSX so this stays a `.ts` module
 * (this file already does that for `nodeIconGlyph` below, for the same
 * reason: some importers are type-only and shouldn't need a JSX toolchain).
 * A caller free to choose its own markup renders this directly; `NodeAvatar`
 * itself only decides WHICH visual to show, never its size or shape — the
 * caller wraps it in whatever fixed-size box its own layout needs (see
 * `SearchResultRow`'s `size-7` slot for one example).
 */
export const NodeAvatar = (props: { node: { type: string; icon?: NodeIcon | null } }) => {
  const resolved = resolveNodeIcon(props.node);
  if (resolved.kind === "emoji") {
    return createElement("span", { className: "text-[15px] leading-none" }, resolved.value);
  }
  if (resolved.kind === "image") {
    return createElement("img", {
      alt: "",
      className: "size-full object-cover",
      src: resolved.url,
    });
  }
  return createElement(resolved.Icon, { className: "size-4" });
};

/**
 * Wraps a `ResolvedNodeIcon` into a real `LucideIcon`-shaped component — a
 * `forwardRef` around an actual `<svg viewBox="0 0 24 24">`, the same output
 * shape lucide-react's own icons produce — so call sites constrained to the
 * `LucideIcon` component TYPE (e.g. `NavItem.icon` in the shared
 * `openlib/ui/dashboard` sidebar, which many apps besides Busabase depend on
 * and which this package must not widen) can render a custom emoji/image
 * avatar without any change to that shared type. The forwarded ref is a real
 * `SVGSVGElement` — unlike lucide's own icons it is never actually read by any
 * current caller, but the type is genuinely satisfied, not cast around.
 *
 * Prefer rendering a `ResolvedNodeIcon` directly (a plain `<img>`/emoji `span`)
 * wherever the call site is free to choose its own markup (e.g.
 * `AppLauncherItem`) — this wrapper exists only for the `LucideIcon`-typed seam.
 */
export const nodeIconGlyph = (resolved: ResolvedNodeIcon): LucideIcon => {
  if (resolved.kind === "type") return resolved.Icon;
  if (resolved.kind === "emoji") {
    const { value } = resolved;
    const EmojiGlyph = forwardRef<SVGSVGElement, LucideProps>(({ className, size = 24 }, ref) =>
      createElement(
        "svg",
        {
          ref,
          xmlns: "http://www.w3.org/2000/svg",
          width: size,
          height: size,
          viewBox: "0 0 24 24",
          className,
          "aria-hidden": "true",
        },
        createElement("text", { x: 12, y: 17, textAnchor: "middle", fontSize: 15 }, value),
      ),
    );
    EmojiGlyph.displayName = "NodeEmojiIconGlyph";
    return EmojiGlyph;
  }
  const { shape, url } = resolved;
  const roundedImage = shape === "app";
  const ImageGlyph = forwardRef<SVGSVGElement, LucideProps>(({ className, size = 24 }, ref) => {
    const clipId = useId();
    const image = createElement("image", {
      key: "image",
      href: url,
      width: 24,
      height: 24,
      preserveAspectRatio: "xMidYMid slice",
      ...(roundedImage ? { clipPath: `url(#${clipId})` } : {}),
    });

    return createElement(
      "svg",
      {
        ref,
        xmlns: "http://www.w3.org/2000/svg",
        width: size,
        height: size,
        viewBox: "0 0 24 24",
        className,
        "aria-hidden": "true",
      },
      roundedImage
        ? [
            createElement(
              "defs",
              { key: "defs" },
              createElement(
                "clipPath",
                { id: clipId },
                createElement("rect", { width: 24, height: 24, rx: 5, ry: 5 }),
              ),
            ),
            image,
          ]
        : image,
    );
  });
  ImageGlyph.displayName = "NodeImageIconGlyph";
  return ImageGlyph;
};
