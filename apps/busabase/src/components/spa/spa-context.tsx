"use client";

import { createContext, useContext } from "react";
import type { SecondaryNavConfig } from "~/config/navigation-nested";

export interface BusabaseOssUser {
  id: string;
  email: string;
  name: string;
  avatar: string;
}

export interface BusabaseOssSpace {
  id: string;
  name: string;
  slug: string;
}

export interface SPAContextType {
  user: BusabaseOssUser;
  activeSpace: BusabaseOssSpace;
  spaces: BusabaseOssSpace[];
  isDemo: boolean;
  isLoading: boolean;
  isLoadingSpaces: boolean;
  notifications: [];
  unreadCount: number;
  locale: string;
  secondaryNavConfig: Record<string, SecondaryNavConfig>;
}

export const SPAContext = createContext<SPAContextType | undefined>(undefined);

export function useSPA() {
  const context = useContext(SPAContext);
  if (!context) {
    throw new Error("useSPA must be used within a SPAWrapper");
  }
  return context;
}
