/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import {
  CLIENT_STORAGE_KEYS,
  readClientJson,
  readSessionJsonFromKey,
  removeClientStorage,
  writeClientJson,
  writeSessionJsonToKey,
} from "../../utils/clientStorage";
import type { BrowserDensity } from "./browserActions";

export const BROWSER_ROOT_UI_STATE_V2_STORAGE_KEY =
  CLIENT_STORAGE_KEYS.browserRootUiStateV2;
export const BROWSER_ROOT_UI_STATE_V3_STORAGE_KEY =
  CLIENT_STORAGE_KEYS.browserRootUiStateV3;
export const BROWSER_ROOT_CONTEXT_SELECTIONS_STORAGE_KEY =
  CLIENT_STORAGE_KEYS.browserRootContextSelections;
export const DEFAULT_FOLDERS_PANEL_WIDTH_PX = 280;
export const MIN_FOLDERS_PANEL_WIDTH_PX = 220;
export const MAX_FOLDERS_PANEL_WIDTH_PX = 420;

type BrowserRootUiContextSelection = {
  bucketName: string;
  prefix: string;
};

type BrowserRootUiState = {
  density: BrowserDensity;
  showFolders: boolean;
  foldersPanelWidthPx: number;
  objectColumns: string[];
  objectColumnWidths: Record<string, number>;
  contextSelections: Record<string, BrowserRootUiContextSelection>;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const clampPanelWidth = (
  value: unknown,
  fallback: number,
  min: number,
  max: number,
) => {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.round(value)));
};

const normalizeObjectColumns = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.filter(
        (entry): entry is string =>
          typeof entry === "string" && entry.trim().length > 0,
      )
    : [];

const normalizeObjectColumnWidths = (
  value: unknown,
): Record<string, number> => {
  if (!isRecord(value)) return {};
  return Object.entries(value).reduce<Record<string, number>>(
    (acc, [key, entry]) => {
      if (
        !key.trim() ||
        typeof entry !== "number" ||
        !Number.isFinite(entry) ||
        entry <= 0
      ) {
        return acc;
      }
      acc[key] = Math.round(entry);
      return acc;
    },
    {},
  );
};

const normalizeContextSelection = (
  value: unknown,
): BrowserRootUiContextSelection | null => {
  if (!isRecord(value)) return null;
  return {
    bucketName:
      typeof value.bucketName === "string" ? value.bucketName.trim() : "",
    prefix: typeof value.prefix === "string" ? value.prefix : "",
  };
};

const normalizeContextSelections = (
  value: unknown,
): Record<string, BrowserRootUiContextSelection> => {
  if (!isRecord(value)) return {};
  return Object.entries(value).reduce<
    Record<string, BrowserRootUiContextSelection>
  >((acc, [key, entry]) => {
    const normalized = normalizeContextSelection(entry);
    if (normalized) acc[key] = normalized;
    return acc;
  }, {});
};

const readContextSelections = () =>
  normalizeContextSelections(
    readSessionJsonFromKey<unknown>(
      BROWSER_ROOT_CONTEXT_SELECTIONS_STORAGE_KEY,
    ),
  );

const createDefaultState = (): BrowserRootUiState => ({
  density: "compact",
  showFolders: false,
  foldersPanelWidthPx: DEFAULT_FOLDERS_PANEL_WIDTH_PX,
  objectColumns: [],
  objectColumnWidths: {},
  contextSelections: readContextSelections(),
});

const normalizeV3State = (value: unknown): BrowserRootUiState | null => {
  if (!isRecord(value)) return null;
  return {
    density: value.density === "comfortable" ? "comfortable" : "compact",
    showFolders:
      typeof value.showFolders === "boolean" ? value.showFolders : false,
    foldersPanelWidthPx: clampPanelWidth(
      value.foldersPanelWidthPx,
      DEFAULT_FOLDERS_PANEL_WIDTH_PX,
      MIN_FOLDERS_PANEL_WIDTH_PX,
      MAX_FOLDERS_PANEL_WIDTH_PX,
    ),
    objectColumns: normalizeObjectColumns(value.objectColumns),
    objectColumnWidths: normalizeObjectColumnWidths(value.objectColumnWidths),
    contextSelections: readContextSelections(),
  };
};

const normalizeV2State = (value: unknown): BrowserRootUiState | null => {
  if (!isRecord(value)) return null;
  const layouts = isRecord(value.layouts) ? value.layouts : {};
  const activeLayout =
    value.activeLayout === "workbench" ? "workbench" : "standard";
  const selectedLayout = isRecord(layouts[activeLayout])
    ? layouts[activeLayout]
    : {};
  return {
    density: value.density === "comfortable" ? "comfortable" : "compact",
    showFolders:
      typeof selectedLayout.showFolders === "boolean"
        ? selectedLayout.showFolders
        : activeLayout === "workbench",
    foldersPanelWidthPx: clampPanelWidth(
      selectedLayout.foldersPanelWidthPx,
      DEFAULT_FOLDERS_PANEL_WIDTH_PX,
      MIN_FOLDERS_PANEL_WIDTH_PX,
      MAX_FOLDERS_PANEL_WIDTH_PX,
    ),
    objectColumns: normalizeObjectColumns(selectedLayout.objectColumns),
    objectColumnWidths: normalizeObjectColumnWidths(
      selectedLayout.objectColumnWidths,
    ),
    contextSelections: readContextSelections(),
  };
};

const serializeV3State = (state: BrowserRootUiState) => ({
  density: state.density,
  showFolders: state.showFolders,
  foldersPanelWidthPx: state.foldersPanelWidthPx,
  objectColumns: state.objectColumns,
  objectColumnWidths: state.objectColumnWidths,
});

const writeBrowserRootUiState = (state: BrowserRootUiState) => {
  if (typeof window === "undefined") return;
  writeClientJson(
    BROWSER_ROOT_UI_STATE_V3_STORAGE_KEY,
    serializeV3State(state),
  );
  removeClientStorage(BROWSER_ROOT_UI_STATE_V2_STORAGE_KEY);
};

export const readStoredBrowserRootUiState = (): BrowserRootUiState | null => {
  if (typeof window === "undefined") return null;
  const current = normalizeV3State(
    readClientJson<unknown>(BROWSER_ROOT_UI_STATE_V3_STORAGE_KEY),
  );
  if (current) return current;
  return normalizeV2State(
    readClientJson<unknown>(BROWSER_ROOT_UI_STATE_V2_STORAGE_KEY),
  );
};

export const readBrowserRootUiState = (): BrowserRootUiState =>
  readStoredBrowserRootUiState() ?? createDefaultState();

export const writeBrowserRootDensity = (density: BrowserDensity) => {
  writeBrowserRootUiState({ ...readBrowserRootUiState(), density });
};

export const writeBrowserRootUiLayout = (
  layout: Partial<
    Pick<
      BrowserRootUiState,
      "showFolders" | "foldersPanelWidthPx"
    >
  >,
) => {
  writeBrowserRootUiState({ ...readBrowserRootUiState(), ...layout });
};

export const readBrowserRootContextSelection = (
  contextId: string | null,
): BrowserRootUiContextSelection | null => {
  if (!contextId) return null;
  return readContextSelections()[contextId] ?? null;
};

export const writeBrowserRootContextSelection = (
  contextId: string | null,
  selection: BrowserRootUiContextSelection,
) => {
  if (!contextId) return;
  const current = readContextSelections();
  writeSessionJsonToKey(BROWSER_ROOT_CONTEXT_SELECTIONS_STORAGE_KEY, {
    ...current,
    [contextId]: normalizeContextSelection(selection) ?? {
      bucketName: "",
      prefix: "",
    },
  });
};

export const readBrowserRootObjectColumns = (): string[] =>
  readBrowserRootUiState().objectColumns;

export const writeBrowserRootObjectColumns = (columns: string[]) => {
  writeBrowserRootUiState({
    ...readBrowserRootUiState(),
    objectColumns: columns,
  });
};

export const readBrowserRootObjectColumnWidths = (): Record<string, number> =>
  readBrowserRootUiState().objectColumnWidths;

export const writeBrowserRootObjectColumnWidths = (
  widths: Record<string, number>,
) => {
  writeBrowserRootUiState({
    ...readBrowserRootUiState(),
    objectColumnWidths: widths,
  });
};
