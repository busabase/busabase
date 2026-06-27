const DEFAULT_LOCAL_STORAGE_KEY = "app.locale";

export function readStoredLocale<TLocale extends string>(
  supportedLocales: readonly TLocale[],
  localStorageKey: string = DEFAULT_LOCAL_STORAGE_KEY,
): TLocale | null {
  if (typeof window === "undefined") return null;
  const v = window.localStorage.getItem(localStorageKey);
  return v && (supportedLocales as readonly string[]).includes(v) ? (v as TLocale) : null;
}

export function storeLocale(locale: string, localStorageKey: string = DEFAULT_LOCAL_STORAGE_KEY) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(localStorageKey, locale);
}

export { DEFAULT_LOCAL_STORAGE_KEY };
