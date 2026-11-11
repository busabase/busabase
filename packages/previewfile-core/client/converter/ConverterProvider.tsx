"use client";

import { createContext, type ReactNode, useContext } from "react";
import type { ConverterPort } from "../../types/ports";

const ConverterContext = createContext<ConverterPort | null>(null);

export interface ConverterProviderProps {
  converter: ConverterPort;
  children: ReactNode;
}

export function ConverterProvider({ converter, children }: ConverterProviderProps) {
  return <ConverterContext.Provider value={converter}>{children}</ConverterContext.Provider>;
}

/**
 * Office viewers call this to obtain the active converter. Throws if no
 * provider is mounted — Office files cannot be previewed without one,
 * so failing loudly beats silently rendering nothing.
 */
export function useConverter(): ConverterPort {
  const converter = useContext(ConverterContext);
  if (!converter) {
    throw new Error(
      "useConverter must be used within a <ConverterProvider>. Wrap your viewer tree with ConverterProvider value={...}.",
    );
  }
  return converter;
}
