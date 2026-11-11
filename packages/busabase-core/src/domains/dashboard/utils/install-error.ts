import { presentCoreError } from "../../../i18n/localize-error";
import type { CoreI18nMessages } from "../../../i18n/messages";

/** Keep the actionable reason while replacing an installation's internal address. */
export const presentInstallError = (
  messages: CoreI18nMessages,
  locale: string,
  error: unknown,
  fallback: string,
  target: { slug?: string; name?: string },
): string => {
  const primary = presentCoreError(messages, locale, error, fallback);
  if (!target.slug || !primary.includes(target.slug)) return primary;
  const name = target.name?.trim() || messages.install.folderName;
  const readable = primary.replaceAll(target.slug, () => name);
  // Reapply the shared presentation bound: a user name may be longer than its address.
  return presentCoreError(messages, locale, new Error(readable), fallback);
};
