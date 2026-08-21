/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useCallback, useMemo, useSyncExternalStore } from "react";

type UseMediaQueryOptions = {
  defaultMatches?: boolean;
  enabled?: boolean;
};

function subscribeToMediaQuery(
  mediaQuery: MediaQueryList | null,
  onStoreChange: () => void,
) {
  if (!mediaQuery) return () => undefined;
  if (typeof mediaQuery.addEventListener === "function") {
    mediaQuery.addEventListener("change", onStoreChange);
    return () => mediaQuery.removeEventListener("change", onStoreChange);
  }
  mediaQuery.addListener(onStoreChange);
  return () => mediaQuery.removeListener(onStoreChange);
}

export function useMediaQuery(
  query: string,
  {
    defaultMatches = false,
    enabled = true,
  }: UseMediaQueryOptions = {},
) {
  const mediaQuery = useMemo(() => {
    if (
      !enabled ||
      typeof window === "undefined" ||
      typeof window.matchMedia !== "function"
    ) {
      return null;
    }
    return window.matchMedia(query);
  }, [enabled, query]);
  const subscribe = useCallback(
    (onStoreChange: () => void) =>
      subscribeToMediaQuery(mediaQuery, onStoreChange),
    [mediaQuery],
  );
  const getSnapshot = useCallback(
    () => mediaQuery?.matches ?? defaultMatches,
    [defaultMatches, mediaQuery],
  );
  const getServerSnapshot = useCallback(
    () => defaultMatches,
    [defaultMatches],
  );

  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
