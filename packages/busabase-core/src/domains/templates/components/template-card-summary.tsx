import { pickTemplateMedia } from "busabase-contract/domains/templates/media";
import type { TemplateCardVO } from "busabase-contract/domains/templates/types";
import { iStringParse, type LocaleType } from "openlib/i18n/i-string";
import { TemplateCardImage } from "./template-card-image";

interface TemplateCardSummaryProps {
  template: TemplateCardVO;
  screenshotAlt: string;
  density?: "compact" | "comfortable";
  headingLevel?: "h2" | "h3";
  /**
   * `description` and `displayName` are both iString; this resolves them to
   * one language — and picks that language's cover from `locales` (via
   * `pickTemplateMedia`), so the card's picture and text always agree. A prop,
   * not `useCoreLocale()` called internally — this
   * component renders in both a Dashboard client tree and a marketing Server
   * Component tree (see the note below), and a hook would break the second
   * one outright.
   */
  descriptionLocale?: LocaleType;
}

/**
 * The shared, non-interactive template card body: the cover, the name, and a
 * line or two of what it is for.
 *
 * That is all a card says. Table, app and sample-row counts used to sit under
 * the description and a row of buttons under those; the counts are reference
 * material (the detail page keeps them in its side column) and the buttons
 * split one decision — "show me this one" — into three. The caller makes the
 * whole card the one target instead.
 *
 * Keeping events out of this component lets the same markup render in both a
 * client tree (the Dashboard wraps it in a button) and a server component tree
 * (the public gallery wraps it in a link).
 */
export function TemplateCardSummary({
  template,
  screenshotAlt,
  density = "compact",
  headingLevel = "h3",
  descriptionLocale = "en",
}: TemplateCardSummaryProps) {
  const [screenshot] = pickTemplateMedia(template, descriptionLocale).screenshots;
  const title = template.displayName
    ? iStringParse(template.displayName, descriptionLocale)
    : template.name;
  const Heading = headingLevel;
  const comfortable = density === "comfortable";

  return (
    <div className="flex h-full flex-col">
      <div className="flex aspect-[16/10] items-center justify-center overflow-hidden bg-muted">
        <TemplateCardImage src={screenshot} alt={screenshotAlt} comfortable={comfortable} />
      </div>

      <div
        className={
          comfortable ? "flex flex-1 flex-col gap-2 p-5" : "flex flex-1 flex-col gap-1.5 p-4"
        }
      >
        <Heading
          className={
            comfortable
              ? "min-w-0 font-serif text-2xl font-semibold leading-tight"
              : "min-w-0 text-base font-semibold leading-snug"
          }
        >
          {title}
        </Heading>

        <p
          className={
            comfortable
              ? "line-clamp-2 text-base leading-7 text-muted-foreground"
              : "line-clamp-2 text-sm leading-6 text-muted-foreground"
          }
        >
          {iStringParse(template.description, descriptionLocale)}
        </p>
      </div>
    </div>
  );
}
