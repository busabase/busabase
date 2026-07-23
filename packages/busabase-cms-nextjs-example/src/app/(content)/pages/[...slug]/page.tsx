import { notFound, permanentRedirect } from "next/navigation";

import { getLandingPageByPreviewRoute } from "@/lib/content";

interface LandingPagePreviewProps {
  params: Promise<{ slug: string[] }>;
}

export default async function LandingPagePreview({ params }: LandingPagePreviewProps) {
  const { slug } = await params;
  const page = await getLandingPageByPreviewRoute(slug.join("/"));
  if (!page) notFound();

  permanentRedirect(page.path);
}
