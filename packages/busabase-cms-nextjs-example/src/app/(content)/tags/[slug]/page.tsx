import type { Metadata } from "next";
import { notFound } from "next/navigation";

import {
  generateTaxonomyMetadata,
  getTaxonomy,
  TaxonomyArchive,
} from "@/components/taxonomy-pages";
import { cmsPathOptions } from "@/lib/content";

interface TagArchivePageProps {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({ params }: TagArchivePageProps): Promise<Metadata> {
  const { slug } = await params;
  const tag = await getTaxonomy("tags", cmsPathOptions.defaultLocale, slug);
  return tag ? generateTaxonomyMetadata("tags", tag) : {};
}

export default async function TagArchivePage({ params }: TagArchivePageProps) {
  const { slug } = await params;
  const tag = await getTaxonomy("tags", cmsPathOptions.defaultLocale, slug);
  if (!tag) notFound();

  return <TaxonomyArchive kind="tags" taxonomy={tag} />;
}
