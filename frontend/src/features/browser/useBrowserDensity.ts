/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useCallback, useEffect, useState } from "react";
import type { BrowserDensity } from "./browserActions";
import { writeBrowserRootDensity } from "./browserRootUiState";

type UseBrowserDensityOptions = {
  densityOverride?: BrowserDensity;
  initialStoredDensity?: BrowserDensity | null;
  isMainBrowserPath: boolean;
};

export function useBrowserDensity({
  densityOverride,
  initialStoredDensity,
  isMainBrowserPath,
}: UseBrowserDensityOptions) {
  const [selectedDensity, setSelectedDensity] = useState<BrowserDensity>(
    () =>
      densityOverride ??
      (isMainBrowserPath ? (initialStoredDensity ?? "compact") : "compact"),
  );
  const density = densityOverride ?? selectedDensity;
  const canConfigure = isMainBrowserPath && densityOverride === undefined;

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
