import { beforeEach, describe, expect, it } from "vitest";
import {
  BROWSER_ROOT_CONTEXT_SELECTIONS_STORAGE_KEY,
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

  it("ignores the obsolete v1 snapshot", () => {
    window.localStorage.setItem("browser:root-ui-state:v1", JSON.stringify({
      layout: { showFolders: true, showInspector: false, showActionBar: true },
      objectColumns: ["size", "modified"],
      objectColumnWidths: { size: 140 },
    }));

    expect(readStoredBrowserRootUiState()).toBeNull();
    expect(readBrowserRootUiState().activeLayout).toBe("standard");
    expect(window.localStorage.getItem(BROWSER_ROOT_UI_STATE_V2_STORAGE_KEY)).toBeNull();
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
    expect(window.localStorage.getItem("browser:root-ui-state:v1")).toBeNull();
  });

  it("keeps bucket and prefix selections in the current tab only", () => {
    writeBrowserRootContextSelection("conn-1", { bucketName: "bucket-a", prefix: "docs/" });

    expect(readBrowserRootContextSelection("conn-1")).toEqual({ bucketName: "bucket-a", prefix: "docs/" });
    expect(window.sessionStorage.getItem(BROWSER_ROOT_CONTEXT_SELECTIONS_STORAGE_KEY)).toContain("bucket-a");
    expect(window.localStorage.getItem(BROWSER_ROOT_UI_STATE_V2_STORAGE_KEY)).toBeNull();
  });

  it("ignores context selections embedded in the old local snapshot", () => {
    window.localStorage.setItem("browser:root-ui-state:v1", JSON.stringify({
      contextSelections: { "conn-1": { bucketName: "other-tab", prefix: "stale/" } },
    }));

    expect(readBrowserRootContextSelection("conn-1")).toBeNull();
    expect(readStoredBrowserRootUiState()).toBeNull();
  });
});
