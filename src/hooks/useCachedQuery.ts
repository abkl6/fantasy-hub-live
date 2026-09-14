import { useQuery, type QueryKey } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import { readCache, writeCache } from "@/lib/offline-cache";

type Options<T> = {
  /** Stable cache key, e.g. "gameday:all". */
  cacheKey: string;
  queryKey: QueryKey;
  queryFn: () => Promise<T>;
  refetchInterval?: number | false;
  refetchOnWindowFocus?: boolean;
};

/**
 * Wraps useQuery so the last successful response (stored in IndexedDB) renders
 * immediately, then gets replaced by fresh data. On a failed fetch the cached
 * view stays put along with the time it was last updated.
 */
export function useCachedQuery<T>({ cacheKey, queryKey, queryFn, refetchInterval, refetchOnWindowFocus }: Options<T>) {
  const [cached, setCached] = useState<{ data: T; savedAt: number } | null>(null);
  const [cacheChecked, setCacheChecked] = useState(false);

  useEffect(() => {
    let active = true;
    setCacheChecked(false);
    setCached(null);
    readCache<T>(cacheKey).then((entry) => {
      if (!active) return;
      setCached(entry);
      setCacheChecked(true);
    });
    return () => {
      active = false;
    };
  }, [cacheKey]);

  const query = useQuery({
    queryKey,
    queryFn,
    ...(refetchInterval === undefined ? {} : { refetchInterval }),
    ...(refetchOnWindowFocus === undefined ? {} : { refetchOnWindowFocus }),
  });

  const fresh = query.data;

  useEffect(() => {
    if (fresh === undefined) return;
    const savedAt = Date.now();
    setCached({ data: fresh, savedAt });
    void writeCache(cacheKey, fresh);
  }, [fresh, cacheKey]);

  const data = (fresh ?? cached?.data) as T | undefined;
  const showingCache = fresh === undefined && cached !== null;

  return {
    data,
    /** True only when there is nothing at all to show yet. */
    isLoading: data === undefined && (query.isLoading || !cacheChecked),
    isFetching: query.isFetching,
    /** Cached data on screen while a fresh fetch is in flight. */
    updating: showingCache && query.isFetching,
    /** Cached data on screen because the fetch failed. */
    stale: showingCache && !query.isFetching && !!query.error,
    lastUpdated: cached?.savedAt ?? null,
    error: data === undefined ? query.error : null,
    fetchError: query.error,
    refetch: query.refetch,
  };
}
