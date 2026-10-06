/**
 * The generated part of an app's `/llms.txt` and `/llms-full.txt`: link sections for the
 * content the site publishes — comparisons, guides, solutions, blog posts.
 *
 * Every app's llms file opens with hand-written text that must stay byte-for-byte as it is.
 * What the site publishes afterwards — CMS Pages and Posts, bundled MDX blog posts — used to
 * be missing, because nobody maintains a list by hand. This module turns that content into
 * llms.txt sections and appends them after the static text.
 *
 * Pure and isomorphic. The entries come from the caller: CMS apps get them from
 * `busabase-cms-sdk` (`listCmsIndexEntriesOrFallback` / `selectCmsIndexEntries`), MDX-only apps
 * from their fumadocs blog source via {@link toLocalLlmsIndexEntries}. Both produce the same
 * {@link LlmsIndexEntry} shape, so every app renders through the same code.
 */

/** One listable page. Structurally a superset-compatible view of busabase-cms-sdk's `CmsIndexEntry`. */
export interface LlmsIndexEntry {
  /** Canonical path on this site, e.g. `/compare/busabase-vs-notion`. */
  canonicalPath: string;
  /** Locale-free path segments, e.g. `["compare", "busabase-vs-notion"]`. */
  segments: readonly string[];
  title: string;
  description?: string | null;
  /** Posts: sort key when set. A fumadocs YAML `date:` arrives as a `Date`. */
  publishedAt?: string | Date | null;
  /** Posts: sort key when there is no `publishedAt`. */
  updatedAt?: string | Date | null;
}

export interface LlmsIndexContent {
  /** Blog posts; only those under `/blog/…` are listed. */
  posts?: readonly LlmsIndexEntry[];
  /** Pages, grouped by URL family; anything under `/blog` is skipped. */
  pages?: readonly LlmsIndexEntry[];
}

export interface LlmsIndexOptions {
  /** Absolute origin, no trailing slash (`https://busabase.com`). */
  baseUrl: string;
  /** How many of the newest posts to list. Default {@link LLMS_BLOG_POST_LIMIT}. */
  blogPostLimit?: number;
}

export interface LlmsIndexLink {
  title: string;
  url: string;
  description: string | null;
}

export interface LlmsIndexSection {
  heading: string;
  links: LlmsIndexLink[];
  /** Render titles only — for long, secondary lists under `## Optional`. */
  titlesOnly?: boolean;
}

export const LLMS_BLOG_POST_LIMIT = 20;

/** Programmatic "Knowledge Base for <agent>" landing pages — one per agent, so there are dozens. */
const AGENT_KNOWLEDGE_BASE_PREFIX = "knowledge-base-for-";

type PageGroup = "comparisons" | "guides" | "solutions" | "agentKnowledgeBases";

const PAGE_GROUP_ORDER: readonly { group: PageGroup; heading: string }[] = [
  { group: "comparisons", heading: "Comparisons" },
  { group: "guides", heading: "Guides" },
  { group: "solutions", heading: "Solutions" },
];

/**
 * Which section a Page belongs to, from its locale-free path segments. Sections are keyed
 * by URL family rather than by a list of slugs, so the next `/compare/…` page lands in
 * Comparisons on its own.
 */
const classifyPage = (segments: readonly string[]): PageGroup => {
  const [first = ""] = segments;
  if (first === "compare") return "comparisons";
  if (first === "solutions" || first === "use-cases") return "solutions";
  if (segments.length === 1 && first.startsWith(AGENT_KNOWLEDGE_BASE_PREFIX)) {
    return "agentKnowledgeBases";
  }
  return "guides";
};

/** One line of prose: descriptions can carry newlines, which would break a list item. */
const oneLine = (value: string | null | undefined): string | null => {
  const text = value?.replace(/\s+/g, " ").trim();
  return text ? text : null;
};

/** Brackets in a title would end the Markdown link text early. */
const escapeLinkText = (value: string): string => value.replace(/([[\]\\])/g, "\\$1");

const timestamp = (value: string | Date | null | undefined): number => {
  if (!value) return 0;
  const parsed = value instanceof Date ? value.getTime() : Date.parse(value);
  return Number.isNaN(parsed) ? 0 : parsed;
};

interface Candidate {
  entry: LlmsIndexEntry;
  url: string;
}

/** Entries with a title, one per URL (the first wins). */
const toCandidates = (entries: readonly LlmsIndexEntry[], baseUrl: string): Candidate[] => {
  const seen = new Set<string>();
  const candidates: Candidate[] = [];
  for (const entry of entries) {
    if (!oneLine(entry.title)) continue;
    const url = `${baseUrl}${entry.canonicalPath}`;
    if (seen.has(url)) continue;
    seen.add(url);
    candidates.push({ entry, url });
  }
  return candidates;
};

const toLink = ({ entry, url }: Candidate): LlmsIndexLink => ({
  title: oneLine(entry.title) ?? url,
  url,
  description: oneLine(entry.description),
});

/** Section hub (`/compare`) first, then its pages in path order — stable across requests. */
const byHubThenPath = (a: Candidate, b: Candidate): number => {
  const depth = a.entry.segments.length - b.entry.segments.length;
  if (a.entry.segments[0] === b.entry.segments[0] && depth !== 0) return depth;
  return a.entry.canonicalPath.localeCompare(b.entry.canonicalPath);
};

/** Newest first; `publishedAt` when set, else the last update. */
const byNewest = (a: Candidate, b: Candidate): number =>
  timestamp(b.entry.publishedAt ?? b.entry.updatedAt) -
    timestamp(a.entry.publishedAt ?? a.entry.updatedAt) ||
  a.entry.canonicalPath.localeCompare(b.entry.canonicalPath);

/** Group Posts and Pages into llms.txt sections. Empty sections are omitted. */
export const buildLlmsIndexSections = (
  { posts = [], pages = [] }: LlmsIndexContent,
  { baseUrl, blogPostLimit = LLMS_BLOG_POST_LIMIT }: LlmsIndexOptions,
): LlmsIndexSection[] => {
  const blogPosts = toCandidates(posts, baseUrl)
    .filter(({ entry }) => entry.segments[0] === "blog" && entry.segments.length > 1)
    .sort(byNewest)
    .slice(0, blogPostLimit);

  const pageGroups = new Map<PageGroup, Candidate[]>();
  for (const candidate of toCandidates(pages, baseUrl)) {
    // A Page stored under /blog would be served by the blog route, not as a page.
    if (candidate.entry.segments[0] === "blog") continue;
    const group = classifyPage(candidate.entry.segments);
    pageGroups.set(group, [...(pageGroups.get(group) ?? []), candidate]);
  }

  const sections: LlmsIndexSection[] = [
    ...PAGE_GROUP_ORDER.map(({ heading, group }) => ({
      heading,
      links: (pageGroups.get(group) ?? []).sort(byHubThenPath).map(toLink),
    })),
    { heading: "Blog", links: blogPosts.map(toLink) },
    // The llms.txt convention: an "Optional" section holds links an agent can skip when
    // it is short on context. One page per agent product belongs there.
    {
      heading: "Optional",
      titlesOnly: true,
      links: (pageGroups.get("agentKnowledgeBases") ?? []).sort(byHubThenPath).map(toLink),
    },
  ];

  return sections.filter((section) => section.links.length > 0);
};

/** Markdown for the sections, or `""` when there is nothing to list. */
export const renderLlmsIndexSections = (sections: readonly LlmsIndexSection[]): string =>
  sections
    .map(({ heading, links, titlesOnly }) =>
      [
        `## ${heading}`,
        "",
        ...links.map(({ title, url, description }) =>
          !titlesOnly && description
            ? `- [${escapeLinkText(title)}](${url}): ${description}`
            : `- [${escapeLinkText(title)}](${url})`,
        ),
      ].join("\n"),
    )
    .join("\n\n");

/**
 * The hand-written text, byte for byte, followed by the generated sections after one blank
 * line. With nothing to list this returns the static text unchanged. A static text that
 * already ends in a newline gets only as many more as it takes to leave one blank line.
 */
export const appendLlmsIndex = (staticText: string, generated: string): string => {
  if (!generated) return staticText;
  const separator = staticText.endsWith("\n\n") ? "" : staticText.endsWith("\n") ? "\n" : "\n\n";
  return `${staticText}${separator}${generated}`;
};

/** `staticText` followed by the sections for `content`. */
export const buildLlmsIndexText = (
  staticText: string,
  content: LlmsIndexContent,
  options: LlmsIndexOptions,
): string =>
  appendLlmsIndex(staticText, renderLlmsIndexSections(buildLlmsIndexSections(content, options)));

/**
 * What a route calls: `staticText` followed by the index built from whatever `loadContent`
 * returns. Nothing about the generated part is worth failing — or emptying — the file over:
 * if loading or formatting throws, the static text is served alone.
 */
export const withLlmsIndex = async (
  staticText: string,
  loadContent: () => LlmsIndexContent | Promise<LlmsIndexContent>,
  options: LlmsIndexOptions,
): Promise<string> => {
  try {
    return buildLlmsIndexText(staticText, await loadContent(), options);
  } catch (error) {
    console.warn("[llms.txt] Could not build the content index; serving the static text", error);
    return staticText;
  }
};

/** The slice of a fumadocs page an index reads. */
export interface LocalLlmsIndexPage {
  url: string;
  data: {
    title?: string;
    description?: string;
    /** Frontmatter `date:` — a `Date` once YAML parses it. */
    date?: string | Date;
    lastModified?: string | Date;
  };
}

/**
 * Bundled MDX pages (a fumadocs `loader().getPages(locale)` result) as index entries. Pass
 * the default-locale pages: their `url` is the English canonical path.
 */
export const toLocalLlmsIndexEntries = (pages: readonly LocalLlmsIndexPage[]): LlmsIndexEntry[] =>
  pages.flatMap((page) => {
    const canonicalPath = page.url.replace(/\/+$/, "") || "/";
    if (!canonicalPath.startsWith("/")) return [];
    return [
      {
        canonicalPath,
        segments: canonicalPath.split("/").filter(Boolean),
        title: page.data.title ?? "",
        description: page.data.description ?? null,
        publishedAt: page.data.date ?? null,
        updatedAt: page.data.lastModified ?? null,
      },
    ];
  });

/**
 * Several entry lists as one, in priority order: the first list to claim a path wins (a CMS
 * Post and the bundled MDX file it replaced are one page, listed once).
 */
export const mergeLlmsIndexEntries = (
  ...lists: readonly (readonly LlmsIndexEntry[])[]
): LlmsIndexEntry[] => {
  const seen = new Set<string>();
  return lists.flat().filter((entry) => {
    if (seen.has(entry.canonicalPath)) return false;
    seen.add(entry.canonicalPath);
    return true;
  });
};
