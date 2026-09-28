import type { TemplateCardVO } from "busabase-contract/domains/templates/types";
import { iStringConcat } from "openlib/i18n/i-string";

/**
 * The Template Center's search box, filtering the catalog already in hand.
 *
 * Same fields as web's `TemplatesListView` (`packages/busabase-core/src/domains/templates/components/templates-list-view.tsx`):
 * name, display name, description, category, tags — joined and matched
 * case-insensitively. Kept in its own pure module so the match rule is
 * testable without mounting the screen, and so it cannot drift from web's rule
 * without the two implementations sitting side by side to compare.
 */
export const filterTemplates = (templates: TemplateCardVO[], query: string): TemplateCardVO[] => {
  const needle = query.trim().toLowerCase();
  if (!needle) return templates;
  return templates.filter((template) =>
    [
      template.name,
      iStringConcat(template.displayName ?? ""),
      iStringConcat(template.description),
      template.category,
      ...template.tags,
    ]
      .join(" ")
      .toLowerCase()
      .includes(needle),
  );
};
