import type { TemplateCardVO } from "busabase-contract/domains/templates/types";
import { AppWindow, Bot, FileText, Rows3, Table2 } from "lucide-react";
import { iStringParse, type LocaleType } from "openlib/i18n/i-string";
import type { ReactNode } from "react";
import { TemplateCardImage } from "./template-card-image";

export interface TemplateStatLabels {
  bases: (count: number) => string;
  airapps: (count: number) => string;
  docs: (count: number) => string;
  records: (count: number) => string;
  skill?: string;
}

const defaultStatLabels: TemplateStatLabels = {
  bases: (count) => `${count} table${count === 1 ? "" : "s"}`,
  airapps: (count) => `${count} app${count === 1 ? "" : "s"}`,
  docs: (count) => `${count} doc${count === 1 ? "" : "s"}`,
  records: (count) => `${count} sample row${count === 1 ? "" : "s"}`,
};

interface TemplateCardSummaryProps {
  template: TemplateCardVO;
  screenshotAlt: string;
  density?: "compact" | "comfortable";
  headingLevel?: "h2" | "h3";
  statLabels?: TemplateStatLabels;
  headingHref?: string;
  children?: ReactNode;
  /**
   * `description` and `displayName` are both iString; this resolves them to
   * one language. A prop, not `useCoreLocale()` called internally — this
   * component renders in both a Dashboard client tree and a marketing Server
   * Component tree (see the note below), and a hook would break the second
   * one outright.
   */
  descriptionLocale?: LocaleType;
}

/**
 * The shared, non-interactive template card body.
 *
 * A Dashboard caller can wrap it in a button while a public page can wrap it in
 * an article. Keeping events out of this component lets the same markup render
 * in both a client tree and a server component tree.
 */
export function TemplateCardSummary({
  template,
  screenshotAlt,
  density = "compact",
  headingLevel = "h3",
  statLabels = defaultStatLabels,
  headingHref,
  children,
  descriptionLocale = "en",
}: TemplateCardSummaryProps) {
  const [screenshot] = template.screenshots;
  const title = template.displayName
    ? iStringParse(template.displayName, descriptionLocale)
    : template.name;
  const Heading = headingLevel;
  const stats = [
    template.stats.bases > 0
      ? { label: statLabels.bases(template.stats.bases), icon: Table2 }
      : null,
    template.stats.airapps > 0
      ? { label: statLabels.airapps(template.stats.airapps), icon: AppWindow }
      : null,
    template.stats.docs > 0
      ? { label: statLabels.docs(template.stats.docs), icon: FileText }
      : null,
    template.stats.records > 0
      ? { label: statLabels.records(template.stats.records), icon: Rows3 }
      : null,
    template.stats.skill && statLabels.skill ? { label: statLabels.skill, icon: Bot } : null,
  ].filter((item) => item !== null);

  const comfortable = density === "comfortable";

  return (
    <div className="flex h-full flex-col">
      <div className="flex aspect-[16/10] items-center justify-center overflow-hidden bg-muted">
        <TemplateCardImage src={screenshot} alt={screenshotAlt} comfortable={comfortable} />
      </div>

      <div className={comfortable ? "flex flex-1 flex-col p-5" : "flex flex-1 flex-col gap-2 p-4"}>
        <Heading
          className={
            comfortable ? "min-w-0 font-serif text-xl font-semibold" : "min-w-0 text-sm font-medium"
          }
        >
          {headingHref ? (
            <a href={headingHref} className="hover:text-primary hover:underline">
              {title}
            </a>
          ) : (
            title
          )}
        </Heading>

        <p
          className={
            comfortable
              ? "mt-2 line-clamp-3 text-sm leading-6 text-muted-foreground"
              : "line-clamp-2 flex-1 text-xs text-muted-foreground"
          }
        >
          {iStringParse(template.description, descriptionLocale)}
        </p>

        {stats.length > 0 ? (
          <div
            className={
              comfortable
                ? "mt-3 flex flex-wrap gap-x-4 gap-y-1.5"
                : "flex flex-wrap items-center gap-x-2 gap-y-1"
            }
          >
            {stats.map(({ label, icon: Icon }) => (
              <span key={label} className="inline-flex items-center gap-1.5 text-xs">
                <Icon className="size-3.5 text-muted-foreground" aria-hidden="true" />
                <span className="text-muted-foreground">{label}</span>
              </span>
            ))}
          </div>
        ) : null}

        {children}
      </div>
    </div>
  );
}
