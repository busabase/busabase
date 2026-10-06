import "server-only";

import { ORPCError } from "@orpc/server";
import { isValidTimeZone } from "../utils/date-value";

/**
 * Refuse a `date` field whose `options.date.timezone` is not a zone this runtime
 * knows. Readers would fall back to their own local time anyway (see
 * `utils/date-value.ts`), but then the field silently means something other
 * than what its author set — so an agent that typos "Asia/Shangai" hears about
 * it at write time instead of every reader seeing the wrong clock.
 *
 * An empty string is "each reader's local time", the same as omitting the key.
 */
export const assertValidDateFieldOptionsOrThrow = (
  type: string,
  slug: string,
  options: Record<string, unknown> | null | undefined,
) => {
  if (type !== "date" || !options) {
    return;
  }
  const date = options.date;
  const timezone =
    date && typeof date === "object" ? (date as { timezone?: unknown }).timezone : undefined;
  if (typeof timezone !== "string" || timezone === "" || isValidTimeZone(timezone)) {
    return;
  }
  throw new ORPCError("BAD_REQUEST", {
    message: `Field "${slug}": unknown time zone "${timezone}". Use an IANA name such as "Asia/Shanghai", or omit options.date.timezone to show each reader their own local time.`,
    data: { slug, timezone },
  });
};
