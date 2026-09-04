/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useEffect, useRef } from "react";

type BrowserNavigationLocation = {
  bucketName: string;
  prefix: string;
};

type BrowserHistoryState = BrowserNavigationLocation & {
  browserPage: true;
};

type UseBrowserNavigationHistoryOptions = BrowserNavigationLocation & {
  onNavigate: (location: BrowserNavigationLocation) => boolean | void;
};

function currentBrowserPath(): string {
  return `${window.location.pathname}${window.location.search}${window.location.hash}`;
}

export function useBrowserNavigationHistory({
  bucketName,
  prefix,
  onNavigate,
}: UseBrowserNavigationHistoryOptions): void {
  const browserPathRef = useRef("");
  const currentLocationRef = useRef<BrowserNavigationLocation>({
    bucketName,
    prefix,
  });
  const lastWrittenLocationRef = useRef<BrowserNavigationLocation | null>(null);
  const skipNextWriteRef = useRef(false);
  const onNavigateRef = useRef(onNavigate);

  currentLocationRef.current = { bucketName, prefix };
  onNavigateRef.current = onNavigate;

  useEffect(() => {
    if (typeof window === "undefined") return;
    browserPathRef.current = currentBrowserPath();
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const handlePopState = (event: PopStateEvent) => {
      const state = event.state as Partial<BrowserHistoryState> | null;
      const currentLocation = currentLocationRef.current;
      if (state?.browserPage) {
        const nextLocation = {
          bucketName: state.bucketName ?? "",
          prefix: state.prefix ?? "",
        };
        const locationChanged =
          nextLocation.bucketName !== currentLocation.bucketName ||
          nextLocation.prefix !== currentLocation.prefix;
        const accepted = onNavigateRef.current(nextLocation);
        if (accepted === false) {
          window.history.pushState(
            {
              ...(window.history.state ?? {}),
              browserPage: true,
              ...currentLocation,
            } satisfies BrowserHistoryState,
            "",
            browserPathRef.current || currentBrowserPath(),
          );
          return;
        }
        skipNextWriteRef.current = locationChanged;
        return;
      }

      window.history.pushState(
        {
          ...(window.history.state ?? {}),
          browserPage: true,
          ...currentLocation,
        } satisfies BrowserHistoryState,
        "",
        browserPathRef.current || currentBrowserPath(),
      );
    };
    window.addEventListener("popstate", handlePopState);
    return () => {
      window.removeEventListener("popstate", handlePopState);
    };
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const location = { bucketName, prefix };
    if (skipNextWriteRef.current) {
      skipNextWriteRef.current = false;
      lastWrittenLocationRef.current = location;
      return;
    }
    const lastLocation = lastWrittenLocationRef.current;
    if (
      lastLocation?.bucketName === bucketName &&
      lastLocation.prefix === prefix
    ) {
      return;
    }

    const baseState = window.history.state ?? {};
    const nextState = {
      ...baseState,
      browserPage: true,
      ...location,
    } satisfies BrowserHistoryState;
    const path = browserPathRef.current || currentBrowserPath();
    if (!baseState?.browserPage) {
      window.history.replaceState(nextState, "", path);
    } else {
      window.history.pushState(nextState, "", path);
    }
    lastWrittenLocationRef.current = location;
  }, [bucketName, prefix]);
}
