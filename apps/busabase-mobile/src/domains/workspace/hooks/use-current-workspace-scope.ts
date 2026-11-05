import { useEffect, useRef } from "react";

export function useCurrentWorkspaceScope(scopeKey: string | undefined) {
  const current = useRef(scopeKey);
  current.current = scopeKey;
  useEffect(() => {
    current.current = scopeKey;
    return () => {
      current.current = undefined;
    };
  }, [scopeKey]);
  return current;
}
