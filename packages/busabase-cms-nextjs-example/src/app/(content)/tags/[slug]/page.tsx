import type { Metadata } from "next";
import { notFound } from "next/navigation";

import {
  generateTaxonomyMetadata,
  readTaxonomy,
  TaxonomyArchive,
} from "@/components/taxonomy-pages";
import { cmsPathOptions, requireCms } from "@/lib/content";

interface TagArchivePageProps {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({ params }: TagArchivePageProps): Promise<Metadata> {
  const { slug } = await params;
  const tag = requireCms(
    await readTaxonomy("tags", cmsPathOptions.defaultLocale, slug),
    "a Tag archive",
  );
  return tag ? generateTaxonomyMetadata("tags", tag) : {};
}

export default async function TagArchivePage({ params }: TagArchivePageProps) {
  const { slug } = await params;
  const tag = requireCms(
    await readTaxonomy("tags", cmsPathOptions.defaultLocale, slug),
    "a Tag archive",
  );
  if (!tag) notFound();

  return <TaxonomyArchive kind="tags" taxonomy={tag} />;
}
