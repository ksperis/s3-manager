import { beforeEach, describe, expect, it } from "vitest";
import {
  BROWSER_ROOT_CONTEXT_SELECTIONS_STORAGE_KEY,
  BROWSER_ROOT_UI_STATE_STORAGE_KEY,
  BROWSER_ROOT_UI_STATE_V2_STORAGE_KEY,
  readBrowserRootContextSelection,
  readBrowserRootObjectColumns,
  readBrowserRootUiState,
  readStoredBrowserRootUiState,
  writeBrowserRootActiveLayout,
  writeBrowserRootContextSelection,
  writeBrowserRootDensity,
  writeBrowserRootObjectColumns,
  writeBrowserRootUiLayout,
} from "./browserRootUiState";

describe("browserRootUiState v2", () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
  });

  it("migrates v1 to Workbench, copies columns to both layouts, and leaves v1 intact", () => {
    const v1 = {
      layout: { showFolders: true, showInspector: false, showActionBar: true },
      objectColumns: ["size", "modified"],
      objectColumnWidths: { size: 140 },
    };
    window.localStorage.setItem(BROWSER_ROOT_UI_STATE_STORAGE_KEY, JSON.stringify(v1));

    const migrated = readStoredBrowserRootUiState();

    expect(migrated?.activeLayout).toBe("workbench");
    expect(migrated?.density).toBe("compact");
    expect(migrated?.layouts.standard.objectColumns).toEqual(["size", "modified"]);
    expect(migrated?.layouts.workbench.objectColumns).toEqual(["size", "modified"]);
    expect(window.localStorage.getItem(BROWSER_ROOT_UI_STATE_STORAGE_KEY)).toBe(JSON.stringify(v1));
    expect(window.localStorage.getItem(BROWSER_ROOT_UI_STATE_V2_STORAGE_KEY)).not.toBeNull();
  });

  it("isolates Standard and Workbench panels and columns", () => {
    writeBrowserRootUiLayout({ showFolders: false, showInspector: false }, "standard");
    writeBrowserRootUiLayout({ showFolders: true, showInspector: true }, "workbench");
    writeBrowserRootObjectColumns(["size"], "standard");
    writeBrowserRootObjectColumns(["modified", "owner"], "workbench");

    const state = readBrowserRootUiState();
    expect(state.layouts.standard.showFolders).toBe(false);
    expect(state.layouts.workbench.showFolders).toBe(true);
    expect(readBrowserRootObjectColumns("standard")).toEqual(["size"]);
    expect(readBrowserRootObjectColumns("workbench")).toEqual(["modified", "owner"]);
  });

  it("persists active layout and density only in v2", () => {
    writeBrowserRootActiveLayout("workbench");
    writeBrowserRootDensity("compact");

    const state = readBrowserRootUiState();
    expect(state.activeLayout).toBe("workbench");
    expect(state.density).toBe("compact");
    expect(window.localStorage.getItem(BROWSER_ROOT_UI_STATE_STORAGE_KEY)).toBeNull();
  });

  it("keeps bucket and prefix selections in the current tab only", () => {
    writeBrowserRootContextSelection("conn-1", { bucketName: "bucket-a", prefix: "docs/" });

    expect(readBrowserRootContextSelection("conn-1")).toEqual({ bucketName: "bucket-a", prefix: "docs/" });
    expect(window.sessionStorage.getItem(BROWSER_ROOT_CONTEXT_SELECTIONS_STORAGE_KEY)).toContain("bucket-a");
    expect(window.localStorage.getItem(BROWSER_ROOT_UI_STATE_V2_STORAGE_KEY)).toBeNull();
  });

  it("ignores context selections embedded in the old local snapshot", () => {
    window.localStorage.setItem(BROWSER_ROOT_UI_STATE_STORAGE_KEY, JSON.stringify({
      contextSelections: { "conn-1": { bucketName: "other-tab", prefix: "stale/" } },
    }));

    expect(readBrowserRootContextSelection("conn-1")).toBeNull();
    expect(readStoredBrowserRootUiState()?.contextSelections).toEqual({});
  });
});
