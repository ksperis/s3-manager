import { describe, expect, it } from "vitest";

import {
  clampBrowserPanelWidth,
  clampFoldersPanelWidth,
} from "../browserPanelLayout";

describe("browserPanelLayout", () => {
  it("clamps panel widths to the allowed range", () => {
    expect(clampBrowserPanelWidth(100.2, 220, 420)).toBe(220);
    expect(clampBrowserPanelWidth(999, 220, 420)).toBe(420);
    expect(clampBrowserPanelWidth(319.6, 220, 420)).toBe(320);
  });

  it("uses the root folders-panel limits", () => {
    expect(clampFoldersPanelWidth(100)).toBe(220);
    expect(clampFoldersPanelWidth(999)).toBe(420);
  });
});
