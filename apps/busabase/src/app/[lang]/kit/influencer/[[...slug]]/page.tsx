import { DocsBody, DocsDescription, DocsPage, DocsTitle } from "fumadocs-ui/page";
import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import {
  DEFAULT_KIT_DOC,
  DEFAULT_KIT_PERSONA,
  getInfluencerKitPage,
  kitDocUrl,
  normalizeKitLocale,
  renderInfluencerMarkdown,
  resolveKitSlug,
} from "~/lib/influencer-kit";

interface PageParams {
  lang: string;
  slug?: string[];
}

export const generateStaticParams = () => [
  { lang: "en", slug: [DEFAULT_KIT_PERSONA, "brief"] },
  { lang: "en", slug: [DEFAULT_KIT_PERSONA, "thread"] },
  { lang: "zh-CN", slug: [DEFAULT_KIT_PERSONA, "brief"] },
  { lang: "zh-CN", slug: [DEFAULT_KIT_PERSONA, "thread"] },
];

export const generateMetadata = async ({
  params,
}: {
  params: Promise<PageParams>;
}): Promise<Metadata> => {
  const { lang, slug } = await params;
  const locale = normalizeKitLocale(lang);
  const resolved = resolveKitSlug(slug);
  if (!locale || !resolved || resolved.needsRedirect) return {};

  const page = getInfluencerKitPage({
    lang: locale,
    persona: resolved.persona,
    doc: resolved.doc,
  });
  if (!page) return {};

  return {
    title: page.title,
    description: page.description,
  };
};

export default async function InfluencerPage({ params }: { params: Promise<PageParams> }) {
  const { lang, slug } = await params;
  const locale = normalizeKitLocale(lang);
  if (!locale) notFound();

  const resolved = resolveKitSlug(slug);
  if (!resolved) notFound();
  if (resolved.needsRedirect) redirect(kitDocUrl(locale, resolved.persona, DEFAULT_KIT_DOC));

  const page = getInfluencerKitPage({
    lang: locale,
    persona: resolved.persona,
    doc: resolved.doc,
  });
  if (!page) notFound();

  return (
    <DocsPage toc={page.toc}>
      <DocsTitle>{page.title}</DocsTitle>
      <DocsDescription>{page.description}</DocsDescription>
      <DocsBody>
        {
          await renderInfluencerMarkdown(page.body, {
            lang: locale,
            persona: resolved.persona,
          })
        }
      </DocsBody>
    </DocsPage>
  );
}
