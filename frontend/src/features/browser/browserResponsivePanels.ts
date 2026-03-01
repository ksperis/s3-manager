/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
export type BrowserPanelVisibilityInput = {
  allowFoldersPanel: boolean;
  allowInspectorPanel: boolean;
  isNarrowViewport: boolean;
  showFolders: boolean;
  showInspector: boolean;
};

export type BrowserPanelVisibility = {
  canUseFoldersPanel: boolean;
  canUseInspectorPanel: boolean;
  isFoldersPanelVisible: boolean;
  isInspectorPanelVisible: boolean;
};

export function resolveBrowserPanelVisibility({
  allowFoldersPanel,
  allowInspectorPanel,
  isNarrowViewport,
  showFolders,
  showInspector,
}: BrowserPanelVisibilityInput): BrowserPanelVisibility {
  const canUseFoldersPanel = allowFoldersPanel && !isNarrowViewport;
  const canUseInspectorPanel = allowInspectorPanel && !isNarrowViewport;
  return {
    canUseFoldersPanel,
    canUseInspectorPanel,
    isFoldersPanelVisible: canUseFoldersPanel && showFolders,
    isInspectorPanelVisible: canUseInspectorPanel && showInspector,
  };
}
