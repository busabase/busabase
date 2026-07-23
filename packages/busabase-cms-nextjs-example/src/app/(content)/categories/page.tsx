import type { Metadata } from "next";

import { TaxonomyOverview } from "@/components/taxonomy-pages";
import { listCategories } from "@/lib/content";

export const metadata: Metadata = {
  title: "Categories",
  description: "Active Busabase CMS Categories and their published Posts.",
};

export default async function CategoriesPage() {
  return <TaxonomyOverview kind="categories" items={await listCategories()} />;
}
