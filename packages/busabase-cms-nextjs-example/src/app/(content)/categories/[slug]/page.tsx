import type { Metadata } from "next";
import { notFound } from "next/navigation";

import {
  generateTaxonomyMetadata,
  readTaxonomy,
  TaxonomyArchive,
} from "@/components/taxonomy-pages";
import { cmsPathOptions, requireCms } from "@/lib/content";

interface CategoryArchivePageProps {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({ params }: CategoryArchivePageProps): Promise<Metadata> {
  const { slug } = await params;
  const category = requireCms(
    await readTaxonomy("categories", cmsPathOptions.defaultLocale, slug),
    "a Category archive",
  );
  return category ? generateTaxonomyMetadata("categories", category) : {};
}

export default async function CategoryArchivePage({ params }: CategoryArchivePageProps) {
  const { slug } = await params;
  const category = requireCms(
    await readTaxonomy("categories", cmsPathOptions.defaultLocale, slug),
    "a Category archive",
  );
  if (!category) notFound();

  return <TaxonomyArchive kind="categories" taxonomy={category} />;
}
