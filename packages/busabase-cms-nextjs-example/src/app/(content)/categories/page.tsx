import type { Metadata } from "next";

import { TaxonomyOverview } from "@/components/taxonomy-pages";
import { readCategories, requireCms } from "@/lib/content";

// Not prerendered: the CMS is reachable only at runtime, so building this page
// with an unreachable CMS would bake "no active items" into static output — and
// Next serves that with `s-maxage=31536000`, i.e. a year. Matches /blog and
// /pages, which already opt out for the same reason.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Categories",
  description: "Active Busabase CMS Categories and their published Posts.",
};

export default async function CategoriesPage() {
  return (
    <TaxonomyOverview
      kind="categories"
      items={requireCms(await readCategories(), "the Categories archive")}
    />
  );
}
