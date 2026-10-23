/**
 * Which of a template's tags a person is shown (pure, isomorphic).
 *
 * The catalog carries two kinds of tag in one list. Plain words (`sales`,
 * `pipeline`, `legal`) describe what the template is for. `prefix:value`
 * entries (`risk:gated-write`, `surface:busabase`, `industry:legal`) are
 * machine facets the catalog tooling sorts and audits by — 57 of the first 65
 * catalog templates carry at least one. Those are internal vocabulary: a
 * visitor reading `surface:busabase` learns nothing except that they are
 * looking at an engineer's page. They stay in the data (search and tooling
 * still use them) and never reach a rendered surface or page metadata.
 *
 * The category leads the list. It used to sit beside the title as its own
 * chip; folding it in here keeps it findable without giving a slug the
 * second-most prominent spot on the page. It is usually also one of the tags,
 * so the list is de-duplicated.
 */
export interface TemplateTagSource {
  category?: string;
  tags: readonly string[];
}

/** A `prefix:value` facet — tooling vocabulary, not something a visitor reads. */
export const isInternalTemplateTag = (tag: string): boolean => tag.includes(":");

export const visibleTemplateTags = (template: TemplateTagSource): string[] => {
  const seen = new Set<string>();
  const visible: string[] = [];
  for (const raw of [template.category ?? "", ...template.tags]) {
    const tag = raw.trim();
    if (!tag || isInternalTemplateTag(tag) || seen.has(tag)) continue;
    seen.add(tag);
    visible.push(tag);
  }
  return visible;
};
