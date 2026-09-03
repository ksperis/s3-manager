import { beforeEach, describe, expect, it } from "vitest";
import {
  BROWSER_ROOT_CONTEXT_SELECTIONS_STORAGE_KEY,
  BROWSER_ROOT_UI_STATE_V2_STORAGE_KEY,
  BROWSER_ROOT_UI_STATE_V3_STORAGE_KEY,
  readBrowserRootContextSelection,
  readBrowserRootObjectColumns,
  readBrowserRootUiState,
  readStoredBrowserRootUiState,
  writeBrowserRootContextSelection,
  writeBrowserRootDensity,
  writeBrowserRootObjectColumns,
  writeBrowserRootUiLayout,
} from "./browserRootUiState";

describe("browserRootUiState v3", () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
  });

  it("defaults to a compact, panel-free Browser", () => {
    expect(readBrowserRootUiState()).toMatchObject({
      density: "compact",
      showFolders: false,
      showInspector: false,
      foldersPanelWidthPx: 280,
      objectColumns: [],
      objectColumnWidths: {},
    });
  });

  it("ignores the obsolete v1 snapshot", () => {
    window.localStorage.setItem(
      "browser:root-ui-state:v1",
      JSON.stringify({
        layout: { showFolders: true, showInspector: true },
        objectColumns: ["etag"],
      }),
    );

    expect(readStoredBrowserRootUiState()).toBeNull();
    expect(readBrowserRootUiState().showFolders).toBe(false);
    expect(
      window.localStorage.getItem(BROWSER_ROOT_UI_STATE_V3_STORAGE_KEY),
    ).toBeNull();
  });

  it("migrates the active v2 layout into one set of display preferences", () => {
    window.localStorage.setItem(
      BROWSER_ROOT_UI_STATE_V2_STORAGE_KEY,
      JSON.stringify({
        activeLayout: "workbench",
        density: "comfortable",
        layouts: {
          standard: { showFolders: false, objectColumns: ["size"] },
          workbench: {
            showFolders: true,
            showInspector: true,
            foldersPanelWidthPx: 360,
            objectColumns: ["modified", "etag"],
            objectColumnWidths: { name: 410 },
          },
        },
      }),
    );

    expect(readBrowserRootUiState()).toMatchObject({
      density: "comfortable",
      showFolders: true,
      showInspector: true,
      foldersPanelWidthPx: 360,
      objectColumns: ["modified", "etag"],
      objectColumnWidths: { name: 410 },
    });

    writeBrowserRootDensity("compact");
    expect(
      window.localStorage.getItem(BROWSER_ROOT_UI_STATE_V2_STORAGE_KEY),
    ).toBeNull();
    expect(
      window.localStorage.getItem(BROWSER_ROOT_UI_STATE_V3_STORAGE_KEY),
    ).not.toBeNull();
  });

  it("persists panels and columns in one root Browser scope", () => {
    writeBrowserRootUiLayout({ showFolders: true, showInspector: true });
    writeBrowserRootObjectColumns(["size", "modified"]);

    expect(readBrowserRootUiState()).toMatchObject({
      showFolders: true,
      showInspector: true,
    });
    expect(readBrowserRootObjectColumns()).toEqual(["size", "modified"]);
  });

  it("keeps bucket and prefix selections in the current tab only", () => {
    writeBrowserRootContextSelection("conn-1", {
      bucketName: "bucket-a",
      prefix: "docs/",
    });

    expect(readBrowserRootContextSelection("conn-1")).toEqual({
      bucketName: "bucket-a",
      prefix: "docs/",
    });
    expect(
      window.sessionStorage.getItem(BROWSER_ROOT_CONTEXT_SELECTIONS_STORAGE_KEY),
    ).toContain("bucket-a");
    expect(
      window.localStorage.getItem(BROWSER_ROOT_UI_STATE_V3_STORAGE_KEY),
    ).toBeNull();
  });
});
