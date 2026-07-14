import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { highlight } from "fumadocs-core/highlight";
import type { Root } from "fumadocs-core/page-tree";
import type { TableOfContents } from "fumadocs-core/toc";
import { CodeBlock, Pre } from "fumadocs-ui/components/codeblock";
import type { ReactNode } from "react";
import { Fragment } from "react";

export const SUPPORTED_KIT_LOCALES = ["en", "zh-CN"] as const;
export type KitLocale = (typeof SUPPORTED_KIT_LOCALES)[number];

export const KIT_DOCS = [
  { id: "brief", label: { en: "Product Brief", "zh-CN": "产品简报" } },
  { id: "thread", label: { en: "Thread Kit", "zh-CN": "推文素材包" } },
] as const;

export type KitDoc = (typeof KIT_DOCS)[number]["id"];

export const DEFAULT_KIT_PERSONA = "general-ai-enthusiast";
export const DEFAULT_KIT_DOC: KitDoc = "brief";

interface KitPageInput {
  lang: KitLocale;
  persona: string;
  doc: KitDoc;
}

interface KitPage {
  title: string;
  description: string;
  body: string;
  toc: TableOfContents;
}

interface RenderContext {
  lang: KitLocale;
  persona: string;
}

interface MarkdownListItem {
  text: string;
  sourceLine: number;
}

interface ResolvedKitSlug {
  persona: string;
  doc: KitDoc;
  needsRedirect: boolean;
}

const isSafeSegment = (value: string) => /^[A-Za-z0-9_-]+$/.test(value);

const getAppRoot = () => {
  const cwd = process.cwd();
  if (existsSync(join(cwd, "content", "influencer"))) return cwd;

  const workspaceAppRoot = join(cwd, "apps", "busabase");
  if (existsSync(join(workspaceAppRoot, "content", "influencer"))) {
    return workspaceAppRoot;
  }

  return cwd;
};

export const normalizeKitLocale = (value: string): KitLocale | null => {
  const normalized = value.toLowerCase();
  if (normalized === "en") return "en";
  if (normalized === "zh" || normalized === "zh-cn" || value === "zh-CN") return "zh-CN";
  return null;
};

export const isKitDoc = (value: string): value is KitDoc =>
  KIT_DOCS.some((doc) => doc.id === value);

export const kitDocUrl = (lang: KitLocale, persona: string, doc: KitDoc) =>
  `/${lang}/kit/influencer/${persona}/${doc}`;

export const resolveKitSlug = (slug: string[] | undefined): ResolvedKitSlug | null => {
  if (!slug?.length) {
    return { persona: DEFAULT_KIT_PERSONA, doc: DEFAULT_KIT_DOC, needsRedirect: true };
  }
  if (slug.length > 2) return null;

  const [persona] = slug;
  const maybeDoc = slug[1] ?? DEFAULT_KIT_DOC;
  if (!isSafeSegment(persona) || !isKitDoc(maybeDoc)) return null;

  return {
    persona,
    doc: maybeDoc,
    needsRedirect: slug.length === 1,
  };
};

export const getInfluencerKitTree = (lang: KitLocale): Root => ({
  name: "Influencer",
  children: [
    {
      type: "folder",
      name:
        lang === "zh-CN"
          ? "AI 工具推荐者 / AI Agent 构建者"
          : "AI Tool Influencer / AI Agent Builder",
      defaultOpen: true,
      children: KIT_DOCS.map((doc) => ({
        type: "page",
        name: doc.label[lang],
        url: kitDocUrl(lang, DEFAULT_KIT_PERSONA, doc.id),
      })),
    },
  ],
});

const splitFrontmatter = (raw: string) => {
  if (!raw.startsWith("---\n")) return { frontmatter: {} as Record<string, string>, body: raw };

  const end = raw.indexOf("\n---", 4);
  if (end === -1) return { frontmatter: {} as Record<string, string>, body: raw };

  const frontmatterText = raw.slice(4, end).trim();
  const body = raw.slice(end + 4).replace(/^\s*\n/, "");
  const frontmatter: Record<string, string> = {};

  for (const line of frontmatterText.split("\n")) {
    const match = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!match) continue;
    frontmatter[match[1]] = match[2].replace(/^["']|["']$/g, "");
  }

  return { frontmatter, body };
};

const stableKey = (value: string) => {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) | 0;
  }
  return Math.abs(hash).toString(36);
};

const headingId = (value: string) => `h-${stableKey(value)}`;

const stripInlineMarkdown = (value: string) =>
  value
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1");

const getToc = (body: string): TableOfContents =>
  body
    .split(/\r?\n/)
    .map((line) => line.trim().match(/^(#{2,3})\s+(.+)$/))
    .filter((match): match is RegExpMatchArray => Boolean(match))
    .map((match) => {
      const title = stripInlineMarkdown(match[2]);
      return {
        title,
        url: `#${headingId(title)}`,
        depth: match[1].length,
      };
    });

export const getInfluencerKitPage = (input: KitPageInput): KitPage | null => {
  if (!isSafeSegment(input.persona)) return null;

  const filePath = join(
    getAppRoot(),
    "content",
    "influencer",
    input.lang,
    input.persona,
    `${input.doc}.mdx`,
  );

  if (!existsSync(filePath)) return null;

  const raw = readFileSync(filePath, "utf8");
  const { frontmatter, body } = splitFrontmatter(raw);

  return {
    title:
      frontmatter.title || KIT_DOCS.find((doc) => doc.id === input.doc)?.label[input.lang] || "Kit",
    description: frontmatter.description || "",
    body,
    toc: getToc(body),
  };
};

const resolveHref = (href: string, context: RenderContext) => {
  if (href === "./brief" || href === "brief") {
    return kitDocUrl(context.lang, context.persona, "brief");
  }
  if (href === "./thread" || href === "thread") {
    return kitDocUrl(context.lang, context.persona, "thread");
  }
  return href;
};

const publicAssetExists = (src: string) => {
  if (!src.startsWith("/")) return false;
  const relative = src.slice(1);
  if (relative.includes("..") || relative.includes("\\") || relative.includes(":")) return false;
  return existsSync(join(getAppRoot(), "public", relative));
};

const renderInline = (text: string, context: RenderContext): ReactNode[] => {
  const nodes: ReactNode[] = [];
  const tokenPattern = /(`[^`]+`|\*\*[^*]+\*\*|\[[^\]]+\]\([^)]+\)|https?:\/\/[^\s<)]+)/g;
  let cursor = 0;

  for (const match of text.matchAll(tokenPattern)) {
    const token = match[0];
    const index = match.index ?? 0;

    if (index > cursor) nodes.push(text.slice(cursor, index));

    if (token.startsWith("`")) {
      nodes.push(<code key={`${index}-code`}>{token.slice(1, -1)}</code>);
    } else if (token.startsWith("**")) {
      nodes.push(
        <strong key={`${index}-strong`}>{renderInline(token.slice(2, -2), context)}</strong>,
      );
    } else if (token.startsWith("http")) {
      nodes.push(
        <a key={`${index}-url`} href={token}>
          {token}
        </a>,
      );
    } else {
      const linkMatch = token.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
      if (linkMatch) {
        const [, label, href] = linkMatch;
        nodes.push(
          <a key={`${index}-link`} href={resolveHref(href, context)}>
            {label}
          </a>,
        );
      } else {
        nodes.push(token);
      }
    }

    cursor = index + token.length;
  }

  if (cursor < text.length) nodes.push(text.slice(cursor));
  return nodes;
};

const renderHeading = (level: number, content: string, key: string, context: RenderContext) => {
  const label = stripInlineMarkdown(content);
  const children = renderInline(content, context);
  const className = "scroll-mt-24";
  if (level <= 2) {
    return (
      <h2 key={key} id={headingId(label)} className={className}>
        {children}
      </h2>
    );
  }
  if (level === 3) {
    return (
      <h3 key={key} id={headingId(label)} className={className}>
        {children}
      </h3>
    );
  }
  return (
    <h4 key={key} id={headingId(label)} className={className}>
      {children}
    </h4>
  );
};

const renderImage = (line: string, key: string, context: RenderContext) => {
  const match = line.match(/^!\[([^\]]*)\]\(([^)]+)\)$/);
  if (!match) return null;

  const [, alt, src] = match;
  if (!publicAssetExists(src)) {
    return (
      <p key={key} className="text-sm text-muted-foreground">
        {context.lang === "zh-CN" ? "素材路径" : "Asset path"}: <code>{src}</code>
      </p>
    );
  }

  return <img key={key} src={src} alt={alt} loading="lazy" />;
};

const isBlockStart = (line: string) =>
  /^(#{2,6}\s|```|---$|>\s?|-\s|\d+\.\s|!\[[^\]]*\]\([^)]+\))/.test(line);

export const renderInfluencerMarkdown = async (body: string, context: RenderContext) => {
  const lines = body.replace(/\r\n/g, "\n").split("\n");
  const blocks: ReactNode[] = [];
  let index = 0;

  while (index < lines.length) {
    const trimmed = lines[index].trim();

    if (!trimmed) {
      index += 1;
      continue;
    }

    if (trimmed.startsWith("```")) {
      const language = trimmed.slice(3).trim();
      const code: string[] = [];
      index += 1;
      while (index < lines.length && !lines[index].trim().startsWith("```")) {
        code.push(lines[index]);
        index += 1;
      }
      index += 1;
      const blockKey = `code-${index}`;
      const highlighted = await highlight(code.join("\n"), {
        lang: language || "text",
        components: {
          pre: (props) => (
            <CodeBlock {...props}>
              <Pre>{props.children}</Pre>
            </CodeBlock>
          ),
        },
      });
      blocks.push(<Fragment key={blockKey}>{highlighted}</Fragment>);
      continue;
    }

    if (trimmed === "---") {
      blocks.push(<hr key={`hr-${index}`} />);
      index += 1;
      continue;
    }

    const heading = trimmed.match(/^(#{2,6})\s+(.+)$/);
    if (heading) {
      blocks.push(renderHeading(heading[1].length, heading[2], `heading-${index}`, context));
      index += 1;
      continue;
    }

    const image = renderImage(trimmed, `image-${index}`, context);
    if (image) {
      blocks.push(image);
      index += 1;
      continue;
    }

    if (trimmed.startsWith(">")) {
      const quote: MarkdownListItem[] = [];
      while (index < lines.length && lines[index].trim().startsWith(">")) {
        quote.push({
          text: lines[index].trim().replace(/^>\s?/, ""),
          sourceLine: index,
        });
        index += 1;
      }
      blocks.push(
        <blockquote key={`quote-${index}`}>
          {quote.map((item) => (
            <p key={`${item.sourceLine}-${stableKey(item.text)}`}>
              {renderInline(item.text, context)}
            </p>
          ))}
        </blockquote>,
      );
      continue;
    }

    if (/^-\s/.test(trimmed)) {
      const items: MarkdownListItem[] = [];
      while (index < lines.length && /^-\s/.test(lines[index].trim())) {
        items.push({
          text: lines[index].trim().replace(/^-\s/, ""),
          sourceLine: index,
        });
        index += 1;
      }
      blocks.push(
        <ul key={`ul-${index}`}>
          {items.map((item) => (
            <li key={`${item.sourceLine}-${stableKey(item.text)}`}>
              {renderInline(item.text, context)}
            </li>
          ))}
        </ul>,
      );
      continue;
    }

    if (/^\d+\.\s/.test(trimmed)) {
      const items: MarkdownListItem[] = [];
      while (index < lines.length && /^\d+\.\s/.test(lines[index].trim())) {
        items.push({
          text: lines[index].trim().replace(/^\d+\.\s/, ""),
          sourceLine: index,
        });
        index += 1;
      }
      blocks.push(
        <ol key={`ol-${index}`}>
          {items.map((item) => (
            <li key={`${item.sourceLine}-${stableKey(item.text)}`}>
              {renderInline(item.text, context)}
            </li>
          ))}
        </ol>,
      );
      continue;
    }

    const paragraph: string[] = [trimmed];
    index += 1;
    while (index < lines.length && lines[index].trim() && !isBlockStart(lines[index].trim())) {
      paragraph.push(lines[index].trim());
      index += 1;
    }

    blocks.push(<p key={`p-${index}`}>{renderInline(paragraph.join(" "), context)}</p>);
  }

  return blocks;
};
