import { renderDashboardPage } from "../dashboard-page";

interface DashboardCatchAllPageProps {
  params: Promise<{
    slug?: string[];
  }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export const dynamic = "force-dynamic";

export default async function DashboardCatchAllPage({
  params,
  searchParams,
}: DashboardCatchAllPageProps) {
  const { slug } = await params;
  const resolvedSearchParams = await searchParams;
  const initialPath = slug?.length ? `/${slug.join("/")}` : "/inbox";
  const query = new URLSearchParams();

  for (const [key, value] of Object.entries(resolvedSearchParams)) {
    if (Array.isArray(value)) {
      for (const item of value) {
        query.append(key, item);
      }
    } else if (value !== undefined) {
      query.set(key, value);
    }
  }

  return renderDashboardPage(query.size > 0 ? `${initialPath}?${query.toString()}` : initialPath);
}
