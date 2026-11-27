/**
 * The whole `/llms.txt` + `/llms-full.txt` pair a marketing app serves, in one place.
 *
 * An app supplies only what is really its own — the hand-written brand text, how it loads its
 * content index (CMS Pages/Posts, bundled MDX posts), its Fumadocs docs `source`, and its base
 * URL — and gets back the two GET handlers. Its route files keep nothing but the
 * `export const revalidate = <literal>` Next requires to be written there.
 *
 * - `/llms.txt`: brand intro, then the Fumadocs-generated docs index, then the content index.
 * - `/llms-full.txt`: optional short intro, then the processed Markdown of every docs page, then
 *   the content index.
 *
 * Historically a failed docs/content generator is omitted. Apps with runtime response wrappers
 * can opt into strict docs so an incomplete documentation file is never cached as successful.
 *
 * Lives in `openlib/seo` next to the index formatter it builds on. It is kept off the
 * `openlib/seo` barrel because it imports `fumadocs-core/source` at runtime, which the pure
 * JSON-LD/index helpers there do not need.
 */
import { type LoaderConfig, type LoaderOutput, llms, type Page } from "fumadocs-core/source";
import { notFound } from "next/navigation";
import {
  countUnresolvedLlmsImages,
  needsLlmsImageSources,
  resolveLlmsImageSources,
  restoreLlmsImageSources,
} from "./llms-images";
import { appendLlmsIndex, type LlmsIndexContent, withLlmsIndex } from "./llms-index";

/** Text that may refer to the site's own URLs. */
export type LlmsText = string | ((baseUrl: string) => string);

export interface LlmsRoutesOptions<C extends LoaderConfig = LoaderConfig> {
  /** Absolute origin — the app's `appConfig.url`. A trailing slash is dropped. */
  baseUrl: string;
  /** Hand-written opening of `/llms.txt`, served byte for byte. */
  intro: LlmsText;
  /** Hand-written opening of `/llms-full.txt`, before the full docs text. Optional. */
  fullIntro?: LlmsText;
  /** What the site publishes outside the docs (CMS Pages, blog posts). Omit for none. */
  loadIndex?: () => LlmsIndexContent | Promise<LlmsIndexContent>;
  /** The Fumadocs docs loader (`source` from `src/lib/source.ts`). Omit for no docs sections. */
  docsSource?: LoaderOutput<C>;
  /** Heading of the generated docs index in `/llms.txt`. Default `Documentation`. */
  docsHeading?: string;
  /** Title for a docs page that has none (virtual OpenAPI pages). Default `Documentation`. */
  docsTitleFallback?: string;
  /** The docs source's default (fallback) language. Default `en`. */
  defaultLanguage?: string;
  /** Keep legacy exports by default; fail mode also validates compiled image references. */
  docsErrorMode?: "omit" | "fail";
}

export interface LlmsRoutes {
  /** GET handler for `/llms.txt`. */
  llmsTxt: () => Promise<Response>;
  /** GET handler for `/llms-full.txt`. */
  llmsFullTxt: () => Promise<Response>;
  /** One docs page as Markdown — the body of `/llms.mdx/docs/…` and each `/llms-full.txt` part. */
  docText: (page: Page) => Promise<string>;
  /**
   * GET handler for `/llms.mdx/docs/[[...slug]]` and `/llms.mdx/[lang]/docs/[[...slug]]` — the
   * page behind a docs URL ending in `.mdx` (the docs page's "Copy Markdown"). 404 when the
   * page does not exist in that locale.
   */
  docMarkdown: (params: Promise<{ lang?: string; slug?: string[] }>) => Promise<Response>;
}

const TEXT_HEADERS = { "Content-Type": "text/plain; charset=utf-8" } as const;
const MARKDOWN_HEADERS = { "Content-Type": "text/markdown; charset=utf-8" } as const;

const resolveText = (text: LlmsText | undefined, baseUrl: string): string =>
  typeof text === "function" ? text(baseUrl) : (text ?? "");

/** `a` and `b` with one blank line between them; either may be empty. */
const joinBlocks = (a: string, b: string): string => (a ? appendLlmsIndex(a, b) : b);

type ProcessedTextData = { getText: (type: "processed") => Promise<string> };

const hasProcessedText = (data: object): data is ProcessedTextData =>
  "getText" in data && typeof data.getText === "function";

type DocsPhase =
  | "processed-text"
  | "image-sources"
  | "image-validation"
  | "index"
  | "pages"
  | "lookup";

/** Deliberately carries no upstream error, filesystem path, body or authored expression. */
export class LlmsDocsGenerationError extends Error {
  readonly pageUrl?: string;

  constructor(
    readonly phase: DocsPhase,
    pageUrl?: string,
    readonly unresolvedImageCount?: number,
  ) {
    super(
      phase === "image-validation"
        ? "Unresolved compiled documentation image"
        : "Documentation generation failed",
    );
    this.name = "LlmsDocsGenerationError";
    this.pageUrl = safePageUrl(pageUrl);
  }
}

const safePageUrl = (url: string | undefined): string | undefined => {
  if (!url) return undefined;
  try {
    // Page identity is public routing information. Queries, fragments and credentials never log.
    const parsed = new URL(url, "https://docs.invalid");
    return parsed.protocol === "http:" || parsed.protocol === "https:"
      ? parsed.pathname
      : undefined;
  } catch {
    return undefined;
  }
};

const logDocsFailure = (error: unknown, phase: DocsPhase, pageUrl?: string) => {
  const metadata = error instanceof LlmsDocsGenerationError ? error : undefined;
  console.warn("[llms.txt] Documentation generation failed", {
    phase: metadata?.phase ?? phase,
    pageUrl: safePageUrl(metadata?.pageUrl ?? pageUrl),
    unresolvedImageCount: metadata?.unresolvedImageCount,
  });
};

/**
 * A Fumadocs page as Markdown for LLMs: `# Title (url)` and its processed Markdown (needs
 * `postprocess.includeProcessedMarkdown: true` in source.config.ts). Virtual OpenAPI pages may
 * provide their own processed text; otherwise they retain the title/description fallback.
 * Strict image validation is opt-in for apps with the corresponding image compiler plugin.
 */
export const getLlmsDocText = async (
  page: Page,
  titleFallback = "Documentation",
  strictImages = false,
): Promise<string> => {
  const { data } = page;
  if (!hasProcessedText(data)) {
    const description = data.description ? `\n\n${data.description}` : "";
    return `# ${data.title ?? titleFallback} (${page.url})${description}`;
  }
  let processed: string;
  try {
    processed = await data.getText("processed");
  } catch {
    throw new LlmsDocsGenerationError("processed-text", page.url);
  }
  const needsSources = needsLlmsImageSources(processed);
  // Apps which have not opted into strict Docs retain their existing unmapped exports.
  if (!strictImages && !needsSources)
    return `# ${data.title ?? titleFallback} (${page.url})\n\n${processed}`;
  let assets: unknown;
  if (needsSources) {
    try {
      assets = await resolveLlmsImageSources(data);
    } catch {
      throw new LlmsDocsGenerationError("image-sources", page.url);
    }
  }
  const restored = restoreLlmsImageSources(processed, assets);
  const unresolvedImageCount = strictImages
    ? countUnresolvedLlmsImages(restored)
    : Number(needsLlmsImageSources(restored));
  if (unresolvedImageCount)
    throw new LlmsDocsGenerationError("image-validation", page.url, unresolvedImageCount);
  return `# ${data.title ?? titleFallback} (${page.url})\n\n${restored}`;
};

/**
 * Whether `page` really exists in its own locale. Fumadocs' `fallbackLanguage` serves an
 * untranslated locale the default-locale file itself, so a fallback page shares that file's
 * `data` object; only a distinct `data` is a real translation. Same rule as the sitemap and
 * hreflang (`busabase-cms-sdk` `hasOwnLocalPage`).
 */
const isOwnLocalePage = <C extends LoaderConfig>(
  docsSource: LoaderOutput<C>,
  page: Page,
  language: string | undefined,
  defaultLanguage: string,
): boolean => {
  if (!language || language === defaultLanguage) return true;
  return page.data !== docsSource.getPage(page.slugs, defaultLanguage)?.data;
};

type TreeNode = ReturnType<LoaderOutput<LoaderConfig>["getPageTree"]>["children"][number];
type PageNode = Extract<TreeNode, { type: "page" }>;

/** The page tree of `language` without its fallback pages (and folders left empty by that). */
const pruneFallbackNodes = <C extends LoaderConfig>(
  docsSource: LoaderOutput<C>,
  nodes: readonly TreeNode[],
  language: string,
  defaultLanguage: string,
): TreeNode[] => {
  const isOwn = (node: PageNode) => {
    const page = docsSource.getNodePage(node, language);
    return Boolean(page && isOwnLocalePage(docsSource, page, language, defaultLanguage));
  };
  const kept = nodes.flatMap((node): TreeNode[] => {
    if (node.type === "page") return isOwn(node) ? [node] : [];
    if (node.type === "folder") {
      const index = node.index && isOwn(node.index) ? node.index : undefined;
      const children = pruneFallbackNodes(docsSource, node.children, language, defaultLanguage);
      return index || children.length > 0 ? [{ ...node, index, children }] : [];
    }
    return [node];
  });
  // A separator only makes sense when something real follows it.
  return kept.filter(
    (node, i) => node.type !== "separator" || kept.slice(i + 1).some((n) => n.type !== "separator"),
  );
};

/**
 * The Fumadocs docs index — every locale, in the loader's language order, as `llms().index()`
 * renders it — without its leading `# Documentation` title: it sits under the caller's
 * `## <heading>` instead. A non-default locale lists only its real translations (its fallback
 * pages are the default-locale files again); a locale left with no pages is skipped, and a
 * source with no pages at all yields `""`.
 */
export const getLlmsDocsIndex = <C extends LoaderConfig>(
  docsSource: LoaderOutput<C>,
  defaultLanguage = "en",
): string => {
  const generator = llms(docsSource);
  const languages = docsSource.getLanguages();
  const renderLanguage = (language: string): string => {
    if (language === defaultLanguage) return generator.index(language);
    const tree = docsSource.getPageTree(language);
    const children = pruneFallbackNodes(docsSource, tree.children, language, defaultLanguage);
    if (children.length === 0) return "";
    const title = typeof tree.name === "string" ? tree.name : "";
    return [`# ${title}`, "", ...children.map((node) => generator.indexNode(node, language))].join(
      "\n",
    );
  };
  const parts =
    languages.length > 0
      ? languages
          .filter(({ pages }) => pages.length > 0)
          .map(({ language }) => renderLanguage(language))
          .filter(Boolean)
      : docsSource.getPages().length > 0
        ? [generator.index()]
        : [];
  // The caller supplies the only H1. Keep subsequent locale headings as
  // subsections instead of injecting additional document titles.
  return parts
    .join("\n\n")
    .replace(/^# [^\n]*\s*/, "")
    .replace(/^# /gm, "### ");
};

const docsUnavailable = () =>
  new Response("Documentation temporarily unavailable", {
    status: 503,
    headers: { ...TEXT_HEADERS, "Cache-Control": "no-store", "Retry-After": "60" },
  });

/** Only Docs failures use this boundary; brand text and other program errors still propagate. */
const orEmpty = async (
  generate: () => string | Promise<string>,
  mode: "omit" | "fail",
  phase: DocsPhase,
) => {
  try {
    return await generate();
  } catch (error) {
    logDocsFailure(error, phase);
    if (mode === "fail") {
      return docsUnavailable();
    }
    return "";
  }
};

export const createLlmsRoutes = <C extends LoaderConfig>({
  baseUrl: rawBaseUrl,
  intro,
  fullIntro,
  loadIndex,
  docsSource,
  docsHeading = "Documentation",
  docsTitleFallback = "Documentation",
  defaultLanguage = "en",
  docsErrorMode = "omit",
}: LlmsRoutesOptions<C>): LlmsRoutes => {
  const baseUrl = rawBaseUrl.replace(/\/+$/, "");
  const docText = (page: Page) => getLlmsDocText(page, docsTitleFallback, docsErrorMode === "fail");

  const withContentIndex = (text: string) =>
    loadIndex ? withLlmsIndex(text, loadIndex, { baseUrl }) : Promise.resolve(text);

  const respond = async (text: string) =>
    new Response(await withContentIndex(text), { headers: TEXT_HEADERS });

  return {
    docText,
    docMarkdown: async (params) => {
      const { lang, slug } = await params;
      let page: Page | undefined;
      try {
        page = docsSource?.getPage(slug, lang);
      } catch (error) {
        if (docsErrorMode === "fail") {
          logDocsFailure(error, "lookup");
          return docsUnavailable();
        }
        throw error;
      }
      if (!page) notFound();
      try {
        return new Response(await docText(page), { headers: MARKDOWN_HEADERS });
      } catch (error) {
        if (docsErrorMode === "fail") {
          logDocsFailure(error, "processed-text", page.url);
          return docsUnavailable();
        }
        throw error;
      }
    },
    llmsTxt: async () => {
      const docsIndex = docsSource
        ? await orEmpty(() => getLlmsDocsIndex(docsSource, defaultLanguage), docsErrorMode, "index")
        : "";
      if (docsIndex instanceof Response) return docsIndex;
      const docsSection = docsIndex ? `## ${docsHeading}\n\n${docsIndex}` : "";
      return respond(joinBlocks(resolveText(intro, baseUrl), docsSection));
    },
    llmsFullTxt: async () => {
      const docsText = docsSource
        ? await orEmpty(
            async () => {
              // Real translations only: a fallback page is the default-locale text again.
              const pages = docsSource
                .getPages()
                .filter((page) => isOwnLocalePage(docsSource, page, page.locale, defaultLanguage));
              const texts = await Promise.all(pages.map(docText));
              return texts.join("\n\n");
            },
            docsErrorMode,
            "pages",
          )
        : "";
      if (docsText instanceof Response) return docsText;
      return respond(joinBlocks(resolveText(fullIntro, baseUrl), docsText));
    },
  };
};
