/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useCallback, useEffect, useState } from "react";
import type { BrowserItem, ObjectDetailsTabId } from "./browserTypes";

type ObjectDetailsTarget = {
  item: BrowserItem;
  initialTab: ObjectDetailsTabId;
};

type UseBrowserObjectDetailsTargetOptions = {
  scopeKey: string;
  versioningEnabled: boolean;
};

export function useBrowserObjectDetailsTarget({
  scopeKey,
  versioningEnabled,
}: UseBrowserObjectDetailsTargetOptions) {
  const [target, setTarget] = useState<ObjectDetailsTarget | null>(null);

  useEffect(() => {
    setTarget(null);
  }, [scopeKey]);

  useEffect(() => {
    if (versioningEnabled) return;
    setTarget((current) =>
      current?.initialTab === "versions" ? null : current,
    );
  }, [versioningEnabled]);

  const open = useCallback(
    (item: BrowserItem, initialTab: ObjectDetailsTabId) => {
      setTarget({ item, initialTab });
    },
    [],
  );
  const close = useCallback(() => setTarget(null), []);

  return { close, open, target };
}
