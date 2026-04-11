import { beforeEach, describe, expect, it } from "vitest";
import {
  BROWSER_ROOT_UI_STATE_STORAGE_KEY,
  DEFAULT_FOLDERS_PANEL_WIDTH_PX,
  DEFAULT_INSPECTOR_PANEL_WIDTH_PX,
  MAX_FOLDERS_PANEL_WIDTH_PX,
  MAX_INSPECTOR_PANEL_WIDTH_PX,
  MIN_FOLDERS_PANEL_WIDTH_PX,
  MIN_INSPECTOR_PANEL_WIDTH_PX,
  readStoredBrowserRootUiState,
  writeBrowserRootUiLayout,
  writeBrowserRootUiPanelWidths,
} from "./browserRootUiState";

describe("browserRootUiState", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("persists panel widths alongside layout state", () => {
    writeBrowserRootUiLayout({
      showFolders: true,
      showInspector: false,
      showActionBar: true,
    });
    writeBrowserRootUiPanelWidths({
      foldersPanelWidthPx: 360,
      inspectorPanelWidthPx: 440,
    });

    expect(readStoredBrowserRootUiState()).toEqual({
      layout: {
        showFolders: true,
        showInspector: false,
        showActionBar: true,
        foldersPanelWidthPx: 360,
        inspectorPanelWidthPx: 440,
      },
      contextSelections: {},
      objectColumns: [],
    });
  });

  it("clamps stored panel widths to supported bounds", () => {
    window.localStorage.setItem(
      BROWSER_ROOT_UI_STATE_STORAGE_KEY,
      JSON.stringify({
        layout: {
          showFolders: true,
          showInspector: true,
          showActionBar: false,
          foldersPanelWidthPx: MAX_FOLDERS_PANEL_WIDTH_PX + 200,
          inspectorPanelWidthPx: MIN_INSPECTOR_PANEL_WIDTH_PX - 200,
        },
      }),
    );

    expect(readStoredBrowserRootUiState()?.layout).toEqual({
      showFolders: true,
      showInspector: true,
      showActionBar: false,
      foldersPanelWidthPx: MAX_FOLDERS_PANEL_WIDTH_PX,
      inspectorPanelWidthPx: MIN_INSPECTOR_PANEL_WIDTH_PX,
    });
  });

  it("falls back to default widths when stored values are invalid", () => {
    window.localStorage.setItem(
      BROWSER_ROOT_UI_STATE_STORAGE_KEY,
      JSON.stringify({
        layout: {
          showFolders: false,
          showInspector: true,
          showActionBar: false,
          foldersPanelWidthPx: "wide",
          inspectorPanelWidthPx: null,
        },
      }),
    );

    expect(readStoredBrowserRootUiState()?.layout).toEqual({
      showFolders: false,
      showInspector: true,
      showActionBar: false,
      foldersPanelWidthPx: DEFAULT_FOLDERS_PANEL_WIDTH_PX,
      inspectorPanelWidthPx: DEFAULT_INSPECTOR_PANEL_WIDTH_PX,
    });
  });

  it("clamps persisted widths when writing through helpers", () => {
    writeBrowserRootUiPanelWidths({
      foldersPanelWidthPx: MIN_FOLDERS_PANEL_WIDTH_PX - 40,
      inspectorPanelWidthPx: MAX_INSPECTOR_PANEL_WIDTH_PX + 40,
    });

    expect(readStoredBrowserRootUiState()?.layout).toEqual({
      showFolders: false,
      showInspector: false,
      showActionBar: false,
      foldersPanelWidthPx: MIN_FOLDERS_PANEL_WIDTH_PX,
      inspectorPanelWidthPx: MAX_INSPECTOR_PANEL_WIDTH_PX,
    });
  });
});
