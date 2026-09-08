import { notFound, permanentRedirect } from "next/navigation";

import { readLandingPageByPreviewRoute, requireCms } from "@/lib/content";

interface LandingPagePreviewProps {
  params: Promise<{ slug: string[] }>;
}

export default async function LandingPagePreview({ params }: LandingPagePreviewProps) {
  const { slug } = await params;
  const page = requireCms(
    await readLandingPageByPreviewRoute(slug.join("/")),
    "a CMS Page preview",
  );
  if (!page) notFound();

  permanentRedirect(page.path);
}
