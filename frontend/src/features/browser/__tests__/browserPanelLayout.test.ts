import { describe, expect, it } from "vitest";

import {
  PANEL_LAYOUT_GAP_PX,
  clampBrowserPanelWidth,
  resolveBrowserPanelWidths,
} from "../browserPanelLayout";

describe("browserPanelLayout", () => {
  it("clamps panel widths to the allowed range", () => {
    expect(clampBrowserPanelWidth(100.2, 220, 420)).toBe(220);
    expect(clampBrowserPanelWidth(999, 220, 420)).toBe(420);
    expect(clampBrowserPanelWidth(319.6, 220, 420)).toBe(320);
  });

  it("keeps a usable center column when both side panels are visible", () => {
    const widths = resolveBrowserPanelWidths({
      containerWidth: 900,
      foldersPanelWidthPx: 420,
      inspectorPanelWidthPx: 520,
      isFoldersPanelVisible: true,
      isInspectorPanelVisible: true,
    });

    expect(widths.resolvedFoldersWidth + widths.resolvedInspectorWidth + 2 * PANEL_LAYOUT_GAP_PX).toBeLessThanOrEqual(
      900 - 320
    );
  });
});
