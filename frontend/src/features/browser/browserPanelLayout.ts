/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import {
  MAX_FOLDERS_PANEL_WIDTH_PX,
  MIN_FOLDERS_PANEL_WIDTH_PX,
} from "./browserRootUiState";

const PANELS_DISABLE_MAX_WIDTH_PX = 1023;
export const PANELS_DISABLE_MEDIA_QUERY = `(max-width: ${PANELS_DISABLE_MAX_WIDTH_PX}px)`;
export const PANEL_LAYOUT_GAP_PX = 12;
export const PANEL_RESIZER_HITBOX_WIDTH_PX = 12;

export const clampBrowserPanelWidth = (
  value: number,
  min: number,
  max: number,
) => Math.min(max, Math.max(min, Math.round(value)));

export const clampFoldersPanelWidth = (value: number) =>
  clampBrowserPanelWidth(
    value,
    MIN_FOLDERS_PANEL_WIDTH_PX,
    MAX_FOLDERS_PANEL_WIDTH_PX,
  );
