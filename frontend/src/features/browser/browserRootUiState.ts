/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import {
  CLIENT_STORAGE_KEYS,
  readClientJson,
  readSessionJsonFromKey,
  writeClientJson,
  writeSessionJsonToKey,
} from "../../utils/clientStorage";
import type { BrowserDensity, BrowserLayoutMode } from "./browserActions";

export const BROWSER_ROOT_UI_STATE_V2_STORAGE_KEY = CLIENT_STORAGE_KEYS.browserRootUiStateV2;
export const BROWSER_ROOT_CONTEXT_SELECTIONS_STORAGE_KEY = CLIENT_STORAGE_KEYS.browserRootContextSelections;
export const DEFAULT_FOLDERS_PANEL_WIDTH_PX = 280;
export const DEFAULT_INSPECTOR_PANEL_WIDTH_PX = 320;
export const MIN_FOLDERS_PANEL_WIDTH_PX = 220;
export const MAX_FOLDERS_PANEL_WIDTH_PX = 420;
export const MIN_INSPECTOR_PANEL_WIDTH_PX = 280;
export const MAX_INSPECTOR_PANEL_WIDTH_PX = 520;

type BrowserRootUiLayoutState = {
  showFolders: boolean;
  showInspector: boolean;
  foldersPanelWidthPx?: number;
  inspectorPanelWidthPx?: number;
};

type BrowserRootUiModeState = {
  showFolders: boolean;
  showInspector: boolean;
  foldersPanelWidthPx: number;
  inspectorPanelWidthPx: number;
  objectColumns: string[];
  objectColumnWidths: Record<string, number>;
};

type BrowserRootUiContextSelection = {
  bucketName: string;
  prefix: string;
};

type BrowserRootUiState = {
  activeLayout: BrowserLayoutMode;
  density: BrowserDensity;
  layouts: Record<BrowserLayoutMode, BrowserRootUiModeState>;
  contextSelections: Record<string, BrowserRootUiContextSelection>;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const clampPanelWidth = (value: unknown, fallback: number, min: number, max: number) => {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.round(value)));
};

const normalizeObjectColumns = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
    : [];

const normalizeObjectColumnWidths = (value: unknown): Record<string, number> => {
  if (!isRecord(value)) return {};
  return Object.entries(value).reduce<Record<string, number>>((acc, [key, entry]) => {
    if (!key.trim() || typeof entry !== "number" || !Number.isFinite(entry) || entry <= 0) return acc;
    acc[key] = Math.round(entry);
    return acc;
  }, {});
};

const createModeState = (
  value: unknown,
  defaults: { showFolders: boolean; showInspector: boolean },
): BrowserRootUiModeState => {
  const raw = isRecord(value) ? value : {};
  return {
    showFolders: typeof raw.showFolders === "boolean" ? raw.showFolders : defaults.showFolders,
    showInspector: typeof raw.showInspector === "boolean" ? raw.showInspector : defaults.showInspector,
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
    objectColumns: normalizeObjectColumns(raw.objectColumns),
    objectColumnWidths: normalizeObjectColumnWidths(raw.objectColumnWidths),
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
  return Object.entries(value).reduce<Record<string, BrowserRootUiContextSelection>>((acc, [key, entry]) => {
    const normalized = normalizeContextSelection(entry);
    if (normalized) acc[key] = normalized;
    return acc;
  }, {});
};

const createDefaultState = (): BrowserRootUiState =>
  ({
    activeLayout: "standard",
    density: "comfortable",
    layouts: {
      standard: createModeState(null, { showFolders: false, showInspector: false }),
      workbench: createModeState(null, { showFolders: true, showInspector: true }),
    },
    contextSelections: {},
  });

const normalizeV2State = (value: unknown): BrowserRootUiState | null => {
  if (!isRecord(value)) return null;
  const activeLayout: BrowserLayoutMode = value.activeLayout === "workbench" ? "workbench" : "standard";
  const density: BrowserDensity = value.density === "compact" ? "compact" : "comfortable";
  const layouts = isRecord(value.layouts) ? value.layouts : {};
  return {
    activeLayout,
    density,
    layouts: {
      standard: createModeState(layouts.standard, { showFolders: false, showInspector: false }),
      workbench: createModeState(layouts.workbench, { showFolders: true, showInspector: true }),
    },
    contextSelections: normalizeContextSelections(
      readSessionJsonFromKey<unknown>(BROWSER_ROOT_CONTEXT_SELECTIONS_STORAGE_KEY),
    ),
  };
};

const serializeV2State = (state: BrowserRootUiState) => ({
  activeLayout: state.activeLayout,
  density: state.density,
  layouts: state.layouts,
});

const writeBrowserRootUiState = (state: BrowserRootUiState) => {
  if (typeof window === "undefined") return;
  writeClientJson(BROWSER_ROOT_UI_STATE_V2_STORAGE_KEY, serializeV2State(state));
};

export const readStoredBrowserRootUiState = (): BrowserRootUiState | null => {
  if (typeof window === "undefined") return null;
  return normalizeV2State(
    readClientJson<unknown>(BROWSER_ROOT_UI_STATE_V2_STORAGE_KEY),
  );
};

export const readBrowserRootUiState = (): BrowserRootUiState =>
  readStoredBrowserRootUiState() ?? createDefaultState();

const updateMode = (
  state: BrowserRootUiState,
  mode: BrowserLayoutMode,
  patch: Partial<BrowserRootUiModeState>,
) => {
  const definedPatch = Object.fromEntries(
    Object.entries(patch).filter(([, value]) => value !== undefined),
  ) as Partial<BrowserRootUiModeState>;
  return {
    activeLayout: state.activeLayout,
    density: state.density,
    layouts: {
      ...state.layouts,
      [mode]: createModeState({ ...state.layouts[mode], ...definedPatch }, {
        showFolders: mode === "workbench",
        showInspector: mode === "workbench",
      }),
    },
    contextSelections: state.contextSelections,
  };
};

export const writeBrowserRootActiveLayout = (activeLayout: BrowserLayoutMode) => {
  const current = readBrowserRootUiState();
  writeBrowserRootUiState({
    activeLayout,
    density: current.density,
    layouts: current.layouts,
    contextSelections: current.contextSelections,
  });
};

export const writeBrowserRootDensity = (density: BrowserDensity) => {
  const current = readBrowserRootUiState();
  writeBrowserRootUiState({
    activeLayout: current.activeLayout,
    density,
    layouts: current.layouts,
    contextSelections: current.contextSelections,
  });
};

export const writeBrowserRootUiLayout = (
  layout: Partial<BrowserRootUiLayoutState>,
  mode?: BrowserLayoutMode,
) => {
  const current = readBrowserRootUiState();
  const targetMode = mode ?? current.activeLayout;
  writeBrowserRootUiState(updateMode(current, targetMode, {
    showFolders: layout.showFolders,
    showInspector: layout.showInspector,
    foldersPanelWidthPx: layout.foldersPanelWidthPx,
    inspectorPanelWidthPx: layout.inspectorPanelWidthPx,
  }));
};

export const writeBrowserRootUiPanelWidths = ({
  foldersPanelWidthPx,
  inspectorPanelWidthPx,
}: {
  foldersPanelWidthPx?: number;
  inspectorPanelWidthPx?: number;
}) => {
  const current = readBrowserRootUiState();
  writeBrowserRootUiState(updateMode(current, current.activeLayout, {
    foldersPanelWidthPx,
    inspectorPanelWidthPx,
  }));
};

export const readBrowserRootContextSelection = (contextId: string | null): BrowserRootUiContextSelection | null => {
  if (!contextId) return null;
  const selections = normalizeContextSelections(
    readSessionJsonFromKey<unknown>(BROWSER_ROOT_CONTEXT_SELECTIONS_STORAGE_KEY),
  );
  return selections[contextId] ?? null;
};

export const writeBrowserRootContextSelection = (
  contextId: string | null,
  selection: BrowserRootUiContextSelection,
) => {
  if (!contextId) return;
  const current = normalizeContextSelections(
    readSessionJsonFromKey<unknown>(BROWSER_ROOT_CONTEXT_SELECTIONS_STORAGE_KEY),
  );
  writeSessionJsonToKey(BROWSER_ROOT_CONTEXT_SELECTIONS_STORAGE_KEY, {
    ...current,
    [contextId]: normalizeContextSelection(selection) ?? { bucketName: "", prefix: "" },
  });
};

export const readBrowserRootObjectColumns = (mode?: BrowserLayoutMode): string[] => {
  const state = readBrowserRootUiState();
  return state.layouts[mode ?? state.activeLayout].objectColumns;
};

export const writeBrowserRootObjectColumns = (columns: string[], mode?: BrowserLayoutMode) => {
  const current = readBrowserRootUiState();
  const targetMode = mode ?? current.activeLayout;
  writeBrowserRootUiState(updateMode(current, targetMode, { objectColumns: columns }));
};

export const readBrowserRootObjectColumnWidths = (mode?: BrowserLayoutMode): Record<string, number> => {
  const state = readBrowserRootUiState();
  return state.layouts[mode ?? state.activeLayout].objectColumnWidths;
};

export const writeBrowserRootObjectColumnWidths = (
  widths: Record<string, number>,
  mode?: BrowserLayoutMode,
) => {
  const current = readBrowserRootUiState();
  const targetMode = mode ?? current.activeLayout;
  writeBrowserRootUiState(updateMode(current, targetMode, { objectColumnWidths: widths }));
};
