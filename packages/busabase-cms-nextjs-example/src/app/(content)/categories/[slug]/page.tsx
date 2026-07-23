import type { Metadata } from "next";
import { notFound } from "next/navigation";

import {
  generateTaxonomyMetadata,
  getTaxonomy,
  TaxonomyArchive,
} from "@/components/taxonomy-pages";
import { cmsPathOptions } from "@/lib/content";

interface CategoryArchivePageProps {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({ params }: CategoryArchivePageProps): Promise<Metadata> {
  const { slug } = await params;
  const category = await getTaxonomy("categories", cmsPathOptions.defaultLocale, slug);
  return category ? generateTaxonomyMetadata("categories", category) : {};
}

export default async function CategoryArchivePage({ params }: CategoryArchivePageProps) {
  const { slug } = await params;
  const category = await getTaxonomy("categories", cmsPathOptions.defaultLocale, slug);
  if (!category) notFound();

  return <TaxonomyArchive kind="categories" taxonomy={category} />;
}
