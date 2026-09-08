import type { Metadata } from "next";
import { notFound } from "next/navigation";

import {
  generateTaxonomyMetadata,
  readTaxonomy,
  TaxonomyArchive,
} from "@/components/taxonomy-pages";
import { cmsPathOptions, requireCms } from "@/lib/content";

interface LocalizedTagPageProps {
  params: Promise<{ locale: string; slug: string }>;
}

const getTag = async (locale: string, slug: string) => {
  if (locale === cmsPathOptions.defaultLocale) return null;
  return requireCms(await readTaxonomy("tags", locale, slug), "a localized Tag archive");
};

export async function generateMetadata({ params }: LocalizedTagPageProps): Promise<Metadata> {
  const { locale, slug } = await params;
  const tag = await getTag(locale, slug);
  return tag ? generateTaxonomyMetadata("tags", tag) : {};
}

export default async function LocalizedTagPage({ params }: LocalizedTagPageProps) {
  const { locale, slug } = await params;
  const tag = await getTag(locale, slug);
  if (!tag) notFound();

  return <TaxonomyArchive kind="tags" taxonomy={tag} />;
}
