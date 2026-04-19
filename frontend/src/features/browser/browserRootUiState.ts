/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */

export const BROWSER_ROOT_UI_STATE_STORAGE_KEY = "browser:root-ui-state:v1";
export const DEFAULT_FOLDERS_PANEL_WIDTH_PX = 280;
export const DEFAULT_INSPECTOR_PANEL_WIDTH_PX = 320;
export const MIN_FOLDERS_PANEL_WIDTH_PX = 220;
export const MAX_FOLDERS_PANEL_WIDTH_PX = 420;
export const MIN_INSPECTOR_PANEL_WIDTH_PX = 280;
export const MAX_INSPECTOR_PANEL_WIDTH_PX = 520;

export type BrowserRootUiLayoutState = {
  showFolders: boolean;
  showInspector: boolean;
  showActionBar: boolean;
  foldersPanelWidthPx?: number;
  inspectorPanelWidthPx?: number;
};

export type BrowserRootUiContextSelection = {
  bucketName: string;
  prefix: string;
};

export type BrowserRootUiState = {
  layout: BrowserRootUiLayoutState;
  contextSelections: Record<string, BrowserRootUiContextSelection>;
  objectColumns: string[];
  objectColumnWidths: Record<string, number>;
};

const DEFAULT_LAYOUT_STATE: BrowserRootUiLayoutState = {
  showFolders: false,
  showInspector: false,
  showActionBar: false,
  foldersPanelWidthPx: DEFAULT_FOLDERS_PANEL_WIDTH_PX,
  inspectorPanelWidthPx: DEFAULT_INSPECTOR_PANEL_WIDTH_PX,
};

const createDefaultState = (): BrowserRootUiState => ({
  layout: { ...DEFAULT_LAYOUT_STATE },
  contextSelections: {},
  objectColumns: [],
  objectColumnWidths: {},
});

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const clampPanelWidth = (
  value: unknown,
  fallback: number,
  min: number,
  max: number,
) => {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, Math.round(value)));
};

const normalizeLayoutState = (value: unknown): BrowserRootUiLayoutState => {
  const raw = isRecord(value) ? value : {};
  return {
    showFolders: raw.showFolders === true,
    showInspector: raw.showInspector === true,
    showActionBar: raw.showActionBar === true,
    foldersPanelWidthPx: clampPanelWidth(
      raw.foldersPanelWidthPx,
      DEFAULT_FOLDERS_PANEL_WIDTH_PX,
      MIN_FOLDERS_PANEL_WIDTH_PX,
      MAX_FOLDERS_PANEL_WIDTH_PX,
    ),
    inspectorPanelWidthPx: clampPanelWidth(
      raw.inspectorPanelWidthPx,
      DEFAULT_INSPECTOR_PANEL_WIDTH_PX,
      MIN_INSPECTOR_PANEL_WIDTH_PX,
      MAX_INSPECTOR_PANEL_WIDTH_PX,
    ),
  };
};

const normalizeContextSelection = (value: unknown): BrowserRootUiContextSelection | null => {
  if (!isRecord(value)) return null;
  return {
    bucketName: typeof value.bucketName === "string" ? value.bucketName.trim() : "",
    prefix: typeof value.prefix === "string" ? value.prefix : "",
  };
};

const normalizeContextSelections = (value: unknown): Record<string, BrowserRootUiContextSelection> => {
  if (!isRecord(value)) return {};
  const entries = Object.entries(value).reduce<Record<string, BrowserRootUiContextSelection>>((acc, [key, entry]) => {
    const normalized = normalizeContextSelection(entry);
    if (!normalized) return acc;
    acc[key] = normalized;
    return acc;
  }, {});
  return entries;
};

const normalizeObjectColumns = (value: unknown): string[] => {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0);
};

const normalizeObjectColumnWidths = (value: unknown): Record<string, number> => {
  if (!isRecord(value)) return {};
  return Object.entries(value).reduce<Record<string, number>>((acc, [key, entry]) => {
    if (typeof key !== "string" || key.trim().length === 0) {
      return acc;
    }
    if (typeof entry !== "number" || !Number.isFinite(entry) || entry <= 0) {
      return acc;
    }
    acc[key] = Math.round(entry);
    return acc;
  }, {});
};

export const readStoredBrowserRootUiState = (): BrowserRootUiState | null => {
  if (typeof window === "undefined") {
    return null;
  }
  try {
    const raw = window.localStorage.getItem(BROWSER_ROOT_UI_STATE_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!isRecord(parsed)) return null;
    return {
      layout: normalizeLayoutState(parsed.layout),
      contextSelections: normalizeContextSelections(parsed.contextSelections),
      objectColumns: normalizeObjectColumns(parsed.objectColumns),
      objectColumnWidths: normalizeObjectColumnWidths(parsed.objectColumnWidths),
    };
  } catch {
    return null;
  }
};

export const readBrowserRootUiState = (): BrowserRootUiState => readStoredBrowserRootUiState() ?? createDefaultState();

const writeBrowserRootUiState = (value: BrowserRootUiState) => {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(BROWSER_ROOT_UI_STATE_STORAGE_KEY, JSON.stringify(value));
  } catch {
    // Ignore storage write failures (private mode / quota).
  }
};

export const writeBrowserRootUiLayout = (layout: BrowserRootUiLayoutState) => {
  const current = readBrowserRootUiState();
  writeBrowserRootUiState({
    ...current,
    layout: normalizeLayoutState({
      ...current.layout,
      ...layout,
    }),
  });
};

export const writeBrowserRootUiPanelWidths = ({
  foldersPanelWidthPx,
  inspectorPanelWidthPx,
}: {
  foldersPanelWidthPx?: number;
  inspectorPanelWidthPx?: number;
}) => {
  const current = readBrowserRootUiState();
  writeBrowserRootUiState({
    ...current,
    layout: normalizeLayoutState({
      ...current.layout,
      foldersPanelWidthPx,
      inspectorPanelWidthPx,
    }),
  });
};

export const readBrowserRootContextSelection = (contextId: string | null): BrowserRootUiContextSelection | null => {
  if (!contextId) return null;
  const current = readBrowserRootUiState();
  return current.contextSelections[contextId] ?? null;
};

export const writeBrowserRootContextSelection = (
  contextId: string | null,
  selection: BrowserRootUiContextSelection
) => {
  if (!contextId) return;
  const current = readBrowserRootUiState();
  writeBrowserRootUiState({
    ...current,
    contextSelections: {
      ...current.contextSelections,
      [contextId]: normalizeContextSelection(selection) ?? { bucketName: "", prefix: "" },
    },
  });
};

export const readBrowserRootObjectColumns = (): string[] => {
  return readBrowserRootUiState().objectColumns;
};

export const writeBrowserRootObjectColumns = (columns: string[]) => {
  const current = readBrowserRootUiState();
  writeBrowserRootUiState({
    ...current,
    objectColumns: normalizeObjectColumns(columns),
  });
};

export const readBrowserRootObjectColumnWidths = (): Record<string, number> => {
  return readBrowserRootUiState().objectColumnWidths;
};

export const writeBrowserRootObjectColumnWidths = (
  widths: Record<string, number>,
) => {
  const current = readBrowserRootUiState();
  writeBrowserRootUiState({
    ...current,
    objectColumnWidths: normalizeObjectColumnWidths(widths),
  });
};
