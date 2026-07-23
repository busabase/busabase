import { HomeLayout } from "fumadocs-ui/layouts/home";
import { Database } from "lucide-react";
import type { ReactNode } from "react";

export default function ContentLayout({ children }: { children: ReactNode }) {
  return (
    <HomeLayout
      nav={{
        title: (
          <span className="brand-lockup">
            <Database aria-hidden="true" size={18} />
            Busabase CMS
          </span>
        ),
      }}
      links={[
        { text: "Overview", url: "/" },
        { text: "Posts", url: "/blog", active: "nested-url" },
        { text: "Pages", url: "/pages", active: "nested-url" },
        { text: "Categories", url: "/categories", active: "nested-url" },
        { text: "Tags", url: "/tags", active: "nested-url" },
      ]}
      searchToggle={{ enabled: false }}
    >
      {children}
    </HomeLayout>
  );
}
