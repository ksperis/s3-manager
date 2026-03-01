import { describe, expect, it } from "vitest";
import { resolveBrowserPanelVisibility } from "../browserResponsivePanels";

describe("resolveBrowserPanelVisibility", () => {
  it("disables folders and inspector panels on narrow viewports", () => {
    const result = resolveBrowserPanelVisibility({
      allowFoldersPanel: true,
      allowInspectorPanel: true,
      isNarrowViewport: true,
      showFolders: true,
      showInspector: true,
    });

    expect(result.canUseFoldersPanel).toBe(false);
    expect(result.canUseInspectorPanel).toBe(false);
    expect(result.isFoldersPanelVisible).toBe(false);
    expect(result.isInspectorPanelVisible).toBe(false);
  });

  it("respects feature flags and local toggles on large viewports", () => {
    const result = resolveBrowserPanelVisibility({
      allowFoldersPanel: true,
      allowInspectorPanel: false,
      isNarrowViewport: false,
      showFolders: true,
      showInspector: true,
    });

    expect(result.canUseFoldersPanel).toBe(true);
    expect(result.isFoldersPanelVisible).toBe(true);
    expect(result.canUseInspectorPanel).toBe(false);
    expect(result.isInspectorPanelVisible).toBe(false);
  });
});
