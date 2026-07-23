import type { Metadata } from "next";

import { TaxonomyOverview } from "@/components/taxonomy-pages";
import { listTags } from "@/lib/content";

export const metadata: Metadata = {
  title: "Tags",
  description: "Active Busabase CMS Tags and their published Posts.",
};

export default async function TagsPage() {
  return <TaxonomyOverview kind="tags" items={await listTags()} />;
}
