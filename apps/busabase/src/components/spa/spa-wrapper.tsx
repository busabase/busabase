"use client";

import { type ReactNode, useMemo } from "react";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { getDashboardBasePath } from "~/lib/dashboard-routes";
import { SPAContext, type SPAContextType } from "./spa-context";

interface SPAWrapperProps {
  children: ReactNode;
  basePath?: string;
  initialPath?: string;
  context?: Partial<SPAContextType>;
  lockInitialPath?: boolean;
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
  basePath = getDashboardBasePath(),
  children,
  context,
  initialPath = "/home",
  lockInitialPath = false,
}: SPAWrapperProps) {
  const [ssrPath = "/home", ssrSearch = ""] = initialPath.split("?");
  const localSpaceForLocale = {
    ...localSpace,
    name: context?.activeSpace?.name ?? localSpace.name,
  };
  const localUserForLocale = {
    ...localUser,
    name: context?.user?.name ?? localUser.name,
  };
  const value: SPAContextType = {
    user: localUserForLocale,
    activeSpace: localSpaceForLocale,
    spaces: [localSpaceForLocale],
    isDemo: false,
    isLoading: false,
    isLoadingSpaces: false,
    notifications: [],
    unreadCount: 0,
    locale: "en",
    secondaryNavConfig: {},
    ...context,
  };

  const ssrPathWithSpace = `${basePath}${ssrPath}`;
  const lockedLocation = useMemo(
    () =>
      memoryLocation({
        path: ssrPathWithSpace,
        searchPath: ssrSearch,
        static: true,
      }),
    [ssrPathWithSpace, ssrSearch],
  );

  return (
    <SPAContext.Provider value={value}>
      <div className="flex h-screen flex-col overflow-hidden">
        <div className="min-h-0 flex-1">
          <Router
            base={basePath}
            hook={lockInitialPath ? lockedLocation.hook : undefined}
            searchHook={lockInitialPath ? lockedLocation.searchHook : undefined}
            ssrPath={ssrPathWithSpace}
            ssrSearch={ssrSearch}
          >
            {children}
          </Router>
        </div>
      </div>
    </SPAContext.Provider>
  );
}
