import { paginateItems } from "../../dashboard/helpers/pagination";

/**
 * Templates per page, in the Template Center and the public gallery alike —
 * eight rows of the three-column grid both of them use. One constant, so "page
 * 2" means the same templates whichever door a user came in through.
 */
export const TEMPLATES_PAGE_SIZE = 24;

export const paginateTemplates = <T>(templates: readonly T[], page: number) =>
  paginateItems(templates, page, TEMPLATES_PAGE_SIZE);
