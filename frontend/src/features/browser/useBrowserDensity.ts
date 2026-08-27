/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useCallback, useEffect, useState } from "react";
import type {
  BrowserDensity,
  BrowserFunctionalProfile,
} from "./browserActions";
import { writeBrowserRootDensity } from "./browserRootUiState";

type UseBrowserDensityOptions = {
  densityOverride?: BrowserDensity;
  functionalProfile: BrowserFunctionalProfile;
  initialStoredDensity?: BrowserDensity | null;
  isMainBrowserPath: boolean;
};

export function useBrowserDensity({
  densityOverride,
  functionalProfile,
  initialStoredDensity,
  isMainBrowserPath,
}: UseBrowserDensityOptions) {
  const enforcedDensity: BrowserDensity | null =
    isMainBrowserPath && functionalProfile !== "advanced"
      ? functionalProfile === "portal"
        ? "compact"
        : "comfortable"
      : null;
  const [selectedDensity, setSelectedDensity] = useState<BrowserDensity>(
    () =>
      densityOverride ??
      enforcedDensity ??
      (isMainBrowserPath ? (initialStoredDensity ?? "comfortable") : "compact"),
  );
  const density = densityOverride ?? enforcedDensity ?? selectedDensity;
  const canConfigure =
    isMainBrowserPath && functionalProfile === "advanced";

  useEffect(() => {
    if (!canConfigure) return;
    writeBrowserRootDensity(selectedDensity);
  }, [canConfigure, selectedDensity]);

  const setCompactMode = useCallback(
    (compact: boolean) => {
      if (!canConfigure) return;
      setSelectedDensity(compact ? "compact" : "comfortable");
    },
    [canConfigure],
  );

  return {
    canConfigure,
    compactMode: density === "compact",
    setCompactMode,
  };
}
