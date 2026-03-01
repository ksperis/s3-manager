import { describe, expect, it } from "vitest";
import { computeTopbarControlsLayout, type TopbarControlDescriptor } from "../topbarControlsLayout";

const descriptors: TopbarControlDescriptor[] = [
  {
    id: "workspace",
    icon: null,
    selectedLabel: "Manager",
    priority: 30,
    estimatedIconWidth: 36,
    estimatedLabelWidth: 160,
    renderControl: () => null,
  },
  {
    id: "account",
    icon: null,
    selectedLabel: "Account A",
    priority: 10,
    estimatedIconWidth: 36,
    estimatedLabelWidth: 220,
    renderControl: () => null,
  },
  {
    id: "endpoint",
    icon: null,
    selectedLabel: "Endpoint 1",
    priority: 20,
    estimatedIconWidth: 36,
    estimatedLabelWidth: 200,
    renderControl: () => null,
  },
];

describe("computeTopbarControlsLayout", () => {
  it("keeps 3 controls inline and upgrades labels by priority when width is large", () => {
    const result = computeTopbarControlsLayout({
      availableWidth: 720,
      controls: descriptors,
      isMobile: false,
    });

    expect(result.inlineControls).toHaveLength(3);
    expect(result.overflowControls).toEqual([]);
    expect(result.visibilityMap.account).toBe("icon_label");
    expect(result.visibilityMap.endpoint).toBe("icon_label");
    expect(result.visibilityMap.workspace).toBe("icon_label");
  });

  it("shows account label first when width is medium", () => {
    const result = computeTopbarControlsLayout({
      availableWidth: 360,
      controls: descriptors,
      isMobile: false,
    });

    expect(result.inlineControls).toHaveLength(3);
    expect(result.overflowControls).toEqual([]);
    expect(result.visibilityMap.account).toBe("icon_label");
    expect(result.visibilityMap.endpoint).toBe("icon");
    expect(result.visibilityMap.workspace).toBe("icon");
  });

  it("moves low-priority controls to overflow when width is very tight", () => {
    const result = computeTopbarControlsLayout({
      availableWidth: 70,
      controls: descriptors,
      isMobile: false,
    });

    expect(result.inlineControls).toEqual([{ id: "account", mode: "icon" }]);
    expect(result.overflowControls).toEqual(["endpoint", "workspace"]);
    expect(result.visibilityMap.account).toBe("icon");
    expect(result.visibilityMap.endpoint).toBe("overflow");
    expect(result.visibilityMap.workspace).toBe("overflow");
  });

  it("routes all controls to context hub on mobile", () => {
    const result = computeTopbarControlsLayout({
      availableWidth: 1024,
      controls: descriptors,
      isMobile: true,
    });

    expect(result.mobileUsesHub).toBe(true);
    expect(result.inlineControls).toEqual([]);
    expect(result.overflowControls).toEqual(["workspace", "account", "endpoint"]);
    expect(result.visibilityMap.workspace).toBe("overflow");
    expect(result.visibilityMap.account).toBe("overflow");
    expect(result.visibilityMap.endpoint).toBe("overflow");
  });
});
