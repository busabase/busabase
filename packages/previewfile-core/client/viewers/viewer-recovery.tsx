"use client";

import { createContext, Fragment, type ReactNode, useCallback, useContext, useState } from "react";
import { FileFetchService } from "../file-fetch";

const ViewerRecoveryContext = createContext<(() => void) | null>(null);

/** An embedded preview retries its selected file without disturbing the host. */
export function ViewerRecoveryBoundary({
  fileUrl,
  children,
}: {
  fileUrl: string;
  children: ReactNode;
}) {
  const [attempt, setAttempt] = useState(0);
  const retry = useCallback(() => {
    FileFetchService.getInstance().clearUrl(fileUrl);
    setAttempt((current) => current + 1);
  }, [fileUrl]);
  return (
    <ViewerRecoveryContext.Provider value={retry}>
      <Fragment key={attempt}>{children}</Fragment>
    </ViewerRecoveryContext.Provider>
  );
}

export const useViewerRecovery = () => useContext(ViewerRecoveryContext);
