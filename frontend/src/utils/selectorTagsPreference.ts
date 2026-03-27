/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useEffect, useState } from "react";

export const SELECTOR_TAGS_PREFERENCE_KEY = "showSelectorTags";
const SELECTOR_TAGS_EVENT = "s3-manager:selector-tags-changed";

function resolveWindow(): Window | null {
  return typeof window === "undefined" ? null : window;
}

export function readSelectorTagsPreference(): boolean {
  const currentWindow = resolveWindow();
  if (!currentWindow) return false;
  return currentWindow.localStorage.getItem(SELECTOR_TAGS_PREFERENCE_KEY) === "1";
}

export function writeSelectorTagsPreference(enabled: boolean): void {
  const currentWindow = resolveWindow();
  if (!currentWindow) return;
  if (enabled) {
    currentWindow.localStorage.setItem(SELECTOR_TAGS_PREFERENCE_KEY, "1");
  } else {
    currentWindow.localStorage.removeItem(SELECTOR_TAGS_PREFERENCE_KEY);
  }
  currentWindow.dispatchEvent(
    new CustomEvent<boolean>(SELECTOR_TAGS_EVENT, {
      detail: enabled,
    })
  );
}

export function useSelectorTagsPreference(): boolean {
  const [enabled, setEnabled] = useState<boolean>(() => readSelectorTagsPreference());

  useEffect(() => {
    const currentWindow = resolveWindow();
    if (!currentWindow) return undefined;

    const handleStorage = (event: StorageEvent) => {
      if (!event.key || event.key === SELECTOR_TAGS_PREFERENCE_KEY) {
        setEnabled(readSelectorTagsPreference());
      }
    };
    const handlePreferenceEvent = (event: Event) => {
      const customEvent = event as CustomEvent<boolean>;
      if (typeof customEvent.detail === "boolean") {
        setEnabled(customEvent.detail);
        return;
      }
      setEnabled(readSelectorTagsPreference());
    };

    currentWindow.addEventListener("storage", handleStorage);
    currentWindow.addEventListener(SELECTOR_TAGS_EVENT, handlePreferenceEvent as EventListener);
    return () => {
      currentWindow.removeEventListener("storage", handleStorage);
      currentWindow.removeEventListener(SELECTOR_TAGS_EVENT, handlePreferenceEvent as EventListener);
    };
  }, []);

  return enabled;
}
