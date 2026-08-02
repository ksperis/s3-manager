/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import {
  MAX_FOLDERS_PANEL_WIDTH_PX,
  MAX_INSPECTOR_PANEL_WIDTH_PX,
  MIN_FOLDERS_PANEL_WIDTH_PX,
  MIN_INSPECTOR_PANEL_WIDTH_PX,
} from "./browserRootUiState";

const PANELS_DISABLE_MAX_WIDTH_PX = 1023;
export const PANELS_DISABLE_MEDIA_QUERY = `(max-width: ${PANELS_DISABLE_MAX_WIDTH_PX}px)`;
export const PANEL_LAYOUT_GAP_PX = 12;
export const PANEL_RESIZER_HITBOX_WIDTH_PX = 12;
const MIN_BROWSER_CENTER_WIDTH_PX = 320;

export const clampBrowserPanelWidth = (
  value: number,
  min: number,
  max: number,
) => Math.min(max, Math.max(min, Math.round(value)));

type BrowserPanelWidthInput = {
  containerWidth: number;
  foldersPanelWidthPx: number;
  inspectorPanelWidthPx: number;
  isFoldersPanelVisible: boolean;
  isInspectorPanelVisible: boolean;
};

type BrowserPanelWidths = {
  resolvedFoldersWidth: number;
  resolvedInspectorWidth: number;
};

export const resolveBrowserPanelWidths = ({
  containerWidth,
  foldersPanelWidthPx,
  inspectorPanelWidthPx,
  isFoldersPanelVisible,
  isInspectorPanelVisible,
}: BrowserPanelWidthInput): BrowserPanelWidths => {
  let resolvedFoldersWidth = clampBrowserPanelWidth(
    foldersPanelWidthPx,
    MIN_FOLDERS_PANEL_WIDTH_PX,
    MAX_FOLDERS_PANEL_WIDTH_PX,
  );
  let resolvedInspectorWidth = clampBrowserPanelWidth(
    inspectorPanelWidthPx,
    MIN_INSPECTOR_PANEL_WIDTH_PX,
    MAX_INSPECTOR_PANEL_WIDTH_PX,
  );
  if (containerWidth <= 0) {
    return { resolvedFoldersWidth, resolvedInspectorWidth };
  }

  const gapCount =
    (isFoldersPanelVisible ? 1 : 0) + (isInspectorPanelVisible ? 1 : 0);
  const occupiedGapWidth = gapCount * PANEL_LAYOUT_GAP_PX;

  if (isInspectorPanelVisible) {
    const maxInspectorWidth = isFoldersPanelVisible
      ? containerWidth -
        resolvedFoldersWidth -
        occupiedGapWidth -
        MIN_BROWSER_CENTER_WIDTH_PX
      : containerWidth - occupiedGapWidth - MIN_BROWSER_CENTER_WIDTH_PX;
    resolvedInspectorWidth = clampBrowserPanelWidth(
      resolvedInspectorWidth,
      MIN_INSPECTOR_PANEL_WIDTH_PX,
      Math.max(MIN_INSPECTOR_PANEL_WIDTH_PX, maxInspectorWidth),
    );
  }

  if (isFoldersPanelVisible) {
    const maxFoldersWidth = isInspectorPanelVisible
      ? containerWidth -
        resolvedInspectorWidth -
        occupiedGapWidth -
        MIN_BROWSER_CENTER_WIDTH_PX
      : containerWidth - occupiedGapWidth - MIN_BROWSER_CENTER_WIDTH_PX;
    resolvedFoldersWidth = clampBrowserPanelWidth(
      resolvedFoldersWidth,
      MIN_FOLDERS_PANEL_WIDTH_PX,
      Math.max(MIN_FOLDERS_PANEL_WIDTH_PX, maxFoldersWidth),
    );
  }

  return { resolvedFoldersWidth, resolvedInspectorWidth };
};
