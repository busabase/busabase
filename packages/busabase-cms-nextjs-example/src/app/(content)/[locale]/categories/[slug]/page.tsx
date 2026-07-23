import type { Metadata } from "next";
import { notFound } from "next/navigation";

import {
  generateTaxonomyMetadata,
  getTaxonomy,
  TaxonomyArchive,
} from "@/components/taxonomy-pages";
import { cmsPathOptions } from "@/lib/content";

interface LocalizedCategoryPageProps {
  params: Promise<{ locale: string; slug: string }>;
}

const getCategory = async (locale: string, slug: string) => {
  if (locale === cmsPathOptions.defaultLocale) return null;
  return getTaxonomy("categories", locale, slug);
};

export async function generateMetadata({ params }: LocalizedCategoryPageProps): Promise<Metadata> {
  const { locale, slug } = await params;
  const category = await getCategory(locale, slug);
  return category ? generateTaxonomyMetadata("categories", category) : {};
}

export default async function LocalizedCategoryPage({ params }: LocalizedCategoryPageProps) {
  const { locale, slug } = await params;
  const category = await getCategory(locale, slug);
  if (!category) notFound();

  return <TaxonomyArchive kind="categories" taxonomy={category} />;
}
