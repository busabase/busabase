"use client";

import { createContext, type ReactNode, useContext, useMemo } from "react";
import { messagesForLocale, type ViewerLanguage, viewerLanguage } from "./locales";
import { defaultMessages, type Messages } from "./messages";

interface MessagesContextValue {
  messages: Messages;
  language: ViewerLanguage;
}

const MessagesContext = createContext<MessagesContextValue | null>(null);

const DEFAULT_CONTEXT: MessagesContextValue = { messages: defaultMessages, language: "en" };

export interface MessagesProviderProps {
  /** The host's language (BCP 47); the languages the viewer ships are `ViewerLanguage`. */
  locale?: string | null;
  /** Override any subset of the viewer messages for `locale`. */
  messages?: Partial<Messages>;
  children: ReactNode;
}

export function MessagesProvider({ locale, messages, children }: MessagesProviderProps) {
  const value = useMemo<MessagesContextValue>(
    () => ({
      messages: { ...messagesForLocale(locale), ...messages },
      language: viewerLanguage(locale),
    }),
    [locale, messages],
  );
  return <MessagesContext.Provider value={value}>{children}</MessagesContext.Provider>;
}

/**
 * Hook used by viewer components. Mirrors the typesafe-i18n shape
 * (`LL.preview.foo()`) so existing call sites stayed untouched after the
 * extraction. Falls back to English defaults when no provider is mounted.
 *
 * Returns a stable object reference: the `LL` wrapper only changes when the
 * underlying messages object changes, preventing unnecessary re-renders and
 * infinite useEffect loops in viewers that include `LL` in their dep arrays.
 */
export function useI18n(): { LL: { preview: Messages }; language: ViewerLanguage } {
  const { messages, language } = useContext(MessagesContext) ?? DEFAULT_CONTEXT;
  // Memoize the { LL: { preview: messages } } wrapper so it's referentially
  // stable across renders when messages hasn't changed.
  return useMemo(() => ({ LL: { preview: messages }, language }), [messages, language]);
}
