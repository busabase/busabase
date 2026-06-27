"use client";

import type { ReactNode } from "react";
import { Router } from "wouter";
import { SPAContext, type SPAContextType } from "./spa-context";

interface SPAWrapperProps {
  children: ReactNode;
  basePath?: string;
  initialPath?: string;
  context?: Partial<SPAContextType>;
}

const localSpace = {
  id: "local",
  name: "Local Busabase",
  slug: "local",
};

const localUser = {
  id: "local-admin",
  email: "local@busabase.dev",
  name: "Local Reviewer",
  avatar: "LR",
};

export function SPAWrapper({
  basePath = "/dashboard",
  children,
  context,
  initialPath = "/inbox",
}: SPAWrapperProps) {
  const [ssrPath = "/inbox", ssrSearch = ""] = initialPath.split("?");
  const value: SPAContextType = {
    user: localUser,
    activeSpace: localSpace,
    spaces: [localSpace],
    isDemo: false,
    isLoading: false,
    isLoadingSpaces: false,
    notifications: [],
    unreadCount: 0,
    locale: "en",
    secondaryNavConfig: {},
    ...context,
  };

  return (
    <SPAContext.Provider value={value}>
      <div className="flex h-screen flex-col overflow-hidden">
        <div className="min-h-0 flex-1">
          <Router base={basePath} ssrPath={ssrPath} ssrSearch={ssrSearch}>
            {children}
          </Router>
        </div>
      </div>
    </SPAContext.Provider>
  );
}
