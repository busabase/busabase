import { DocsLayout } from "fumadocs-ui/layouts/docs";
import { Home, Megaphone } from "lucide-react";
import type { ReactNode } from "react";
import { fumadocsI18n } from "~/lib/fumadocs-i18n";
import { getInfluencerKitTree, normalizeKitLocale } from "~/lib/influencer-kit";

export default async function InfluencerLayout({
  params,
  children,
}: {
  params: Promise<{ lang: string }>;
  children: ReactNode;
}) {
  const { lang } = await params;
  const locale = normalizeKitLocale(lang) ?? "en";
  const tree = getInfluencerKitTree(locale);

  return (
    <DocsLayout
      tree={tree}
      nav={{
        title: <span className="text-sm font-semibold text-foreground">Busabase</span>,
        url: "/",
      }}
      links={[]}
      i18n={fumadocsI18n}
      searchToggle={{ enabled: false }}
      themeSwitch={{ enabled: false }}
      sidebar={{
        banner: (
          <div key="influencer-sidebar-banner" className="flex items-center gap-2">
            <span className="flex flex-1 items-center justify-center gap-2 rounded-md bg-primary/10 px-3 py-2 text-sm font-medium text-primary">
              <Megaphone className="size-4" />
              {locale === "zh-CN" ? "达人" : "Influencer"}
            </span>
            <a
              href="/"
              className="inline-flex size-9 items-center justify-center rounded-md border border-fd-border transition-colors hover:bg-fd-accent"
              title={locale === "zh-CN" ? "返回官网" : "Back to website"}
              aria-label={locale === "zh-CN" ? "返回官网" : "Back to website"}
            >
              <Home className="size-4" />
            </a>
          </div>
        ),
      }}
    >
      {children}
    </DocsLayout>
  );
}
