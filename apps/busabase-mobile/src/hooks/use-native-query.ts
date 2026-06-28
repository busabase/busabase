import { useCallback, useEffect, useState } from "react";

export function useNativeQuery<T>(enabled: boolean, load: () => Promise<T>) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const run = useCallback(
    async (mode: "load" | "refresh" = "load") => {
      if (!enabled) {
        setLoading(false);
        return;
      }
      if (mode === "refresh") setRefreshing(true);
      else setLoading(true);
      setError(null);
      try {
        setData(await load());
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : "Request failed");
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [enabled, load],
  );

  useEffect(() => {
    void run("load");
  }, [run]);

  return {
    data,
    error,
    loading,
    refreshing,
    refetch: () => void run("refresh"),
  };
}
