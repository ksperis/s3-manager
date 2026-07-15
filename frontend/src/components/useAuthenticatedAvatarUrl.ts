/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useEffect, useState } from "react";

const securedAvatarUrlCache = new Map<string, Promise<string>>();

export function useAuthenticatedAvatarUrl(
  sourceUrl: string | null,
  fetchImage: (url: string) => Promise<Blob>,
  authenticated: boolean,
) {
  const [loadedUrl, setLoadedUrl] = useState<string | null>(null);
  const [imageFailed, setImageFailed] = useState(false);

  useEffect(() => {
    let active = true;
    setImageFailed(false);
    setLoadedUrl(authenticated ? null : sourceUrl);
    if (!authenticated || !sourceUrl) return () => undefined;
    let promise = securedAvatarUrlCache.get(sourceUrl);
    if (!promise) {
      promise = fetchImage(sourceUrl)
        .then((blob) => URL.createObjectURL(blob))
        .catch((error) => {
          securedAvatarUrlCache.delete(sourceUrl);
          throw error;
        });
      securedAvatarUrlCache.set(sourceUrl, promise);
    }
    promise
      .then((url) => {
        if (active) setLoadedUrl(url);
      })
      .catch(() => {
        if (active) setImageFailed(true);
      });
    return () => {
      active = false;
    };
  }, [authenticated, fetchImage, sourceUrl]);

  return { loadedUrl, imageFailed, setImageFailed };
}
