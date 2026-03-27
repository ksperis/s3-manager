/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */

export const BROWSER_ROOT_UI_STATE_STORAGE_KEY = "browser:root-ui-state:v1";

export type BrowserRootUiLayoutState = {
  showFolders: boolean;
  showInspector: boolean;
  showActionBar: boolean;
};

export type BrowserRootUiContextSelection = {
  bucketName: string;
  prefix: string;
};

export type BrowserRootUiState = {
  layout: BrowserRootUiLayoutState;
  contextSelections: Record<string, BrowserRootUiContextSelection>;
};

const DEFAULT_LAYOUT_STATE: BrowserRootUiLayoutState = {
  showFolders: false,
  showInspector: false,
  showActionBar: false,
};

const createDefaultState = (): BrowserRootUiState => ({
  layout: { ...DEFAULT_LAYOUT_STATE },
  contextSelections: {},
});

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const normalizeLayoutState = (value: unknown): BrowserRootUiLayoutState => {
  const raw = isRecord(value) ? value : {};
  return {
    showFolders: raw.showFolders === true,
    showInspector: raw.showInspector === true,
    showActionBar: raw.showActionBar === true,
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
    layout: normalizeLayoutState(layout),
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
