import { redirect } from "next/navigation";
import {
  DEFAULT_KIT_DOC,
  DEFAULT_KIT_PERSONA,
  kitDocUrl,
  normalizeKitLocale,
  resolveKitSlug,
} from "~/lib/influencer-kit";

interface PageParams {
  slug?: string[];
}

export const generateStaticParams = () => [
  { slug: [DEFAULT_KIT_PERSONA, "brief"] },
  { slug: [DEFAULT_KIT_PERSONA, "thread"] },
];

export default async function LegacyInfluencerKitPage({ params }: { params: Promise<PageParams> }) {
  const { slug } = await params;

  if (!slug?.length) {
    redirect(kitDocUrl("en", DEFAULT_KIT_PERSONA, DEFAULT_KIT_DOC));
  }

  const legacyLocale = normalizeKitLocale(slug[0]);
  if (legacyLocale) {
    const resolved = resolveKitSlug(slug.slice(1));
    redirect(
      resolved
        ? kitDocUrl(legacyLocale, resolved.persona, resolved.doc)
        : kitDocUrl(legacyLocale, DEFAULT_KIT_PERSONA, DEFAULT_KIT_DOC),
    );
  }

  const resolved = resolveKitSlug(slug);
  redirect(
    resolved
      ? kitDocUrl("en", resolved.persona, resolved.doc)
      : kitDocUrl("en", DEFAULT_KIT_PERSONA, DEFAULT_KIT_DOC),
  );
}
