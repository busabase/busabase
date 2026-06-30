import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { NativeModules, Platform } from "react-native";
import { type CoreMessages, type Locale, localeOptions, messagesByLocale } from "./messages";

const STORAGE_KEY = "busabase-mobile.locale.v1";

/** "auto" follows the device language; an explicit code pins the UI to that locale. */
export type LocalePreference = "auto" | Locale;

function deviceLocale(): Locale {
  // Read the OS locale without pulling in expo-localization (keeps the dep surface small).
  const raw =
    Platform.OS === "ios"
      ? (NativeModules.SettingsManager?.settings?.AppleLocale ??
        NativeModules.SettingsManager?.settings?.AppleLanguages?.[0])
      : NativeModules.I18nManager?.localeIdentifier;
  return typeof raw === "string" && raw.toLowerCase().startsWith("zh") ? "zh-CN" : "en";
}

function resolveLocale(preference: LocalePreference): Locale {
  return preference === "auto" ? deviceLocale() : preference;
}

interface I18nContextValue {
  /** The active message catalog for the resolved locale. */
  t: CoreMessages;
  /** Resolved locale code actually in effect. */
  locale: Locale;
  /** The stored preference ("auto" or an explicit code). */
  preference: LocalePreference;
  setPreference: (preference: LocalePreference) => void;
  options: typeof localeOptions;
}

const I18nContext = createContext<I18nContextValue | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [preference, setPreferenceState] = useState<LocalePreference>("auto");

  useEffect(() => {
    void AsyncStorage.getItem(STORAGE_KEY)
      .then((raw) => {
        if (raw === "en" || raw === "zh-CN" || raw === "auto") {
          setPreferenceState(raw);
        }
      })
      .catch(() => undefined);
  }, []);

  const setPreference = useCallback((next: LocalePreference) => {
    setPreferenceState(next);
    void AsyncStorage.setItem(STORAGE_KEY, next).catch(() => undefined);
  }, []);

  const value = useMemo<I18nContextValue>(() => {
    const locale = resolveLocale(preference);
    return {
      t: messagesByLocale[locale],
      locale,
      preference,
      setPreference,
      options: localeOptions,
    };
  }, [preference, setPreference]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nContextValue {
  const value = useContext(I18nContext);
  if (!value) {
    throw new Error("useI18n must be used within an I18nProvider");
  }
  return value;
}

/** Interpolate `{token}` placeholders in a catalog string. */
export function fmt(template: string, tokens: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) =>
    key in tokens ? String(tokens[key]) : match,
  );
}

export type { Locale } from "./messages";
