import { ArrowRight, FileText, Languages } from "lucide-react";
import Link from "next/link";

interface ContentCardProps {
  href: string;
  title: string;
  description?: string | null;
  locale: string;
  updatedAt: string;
}

export function ContentCard({ href, title, description, locale, updatedAt }: ContentCardProps) {
  return (
    <article className="content-card">
      <div className="content-card__meta">
        <span>
          <Languages aria-hidden="true" size={14} />
          {locale}
        </span>
        <time dateTime={updatedAt}>{new Date(updatedAt).toLocaleDateString()}</time>
      </div>
      <FileText aria-hidden="true" className="content-card__icon" size={22} />
      <h2>{title}</h2>
      <p>{description ?? "No description has been added yet."}</p>
      <Link href={href} className="content-card__link">
        Open content
        <ArrowRight aria-hidden="true" size={15} />
      </Link>
    </article>
  );
}
