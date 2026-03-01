/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import type { ReactNode } from "react";

export type TopbarControlId = "workspace" | "account" | "endpoint";
export type TopbarControlVisibility = "hidden" | "icon" | "icon_label" | "overflow";
export type TopbarControlRenderMode = "icon" | "icon_label";

export type TopbarControlDescriptor = {
  id: TopbarControlId;
  icon: ReactNode;
  selectedLabel: string | null;
  priority: number;
  estimatedIconWidth: number;
  estimatedLabelWidth: number;
  renderControl: (mode: TopbarControlRenderMode) => ReactNode;
};

export type TopbarInlineControl = {
  id: TopbarControlId;
  mode: TopbarControlRenderMode;
};

export type TopbarControlsLayoutResult = {
  inlineControls: TopbarInlineControl[];
  overflowControls: TopbarControlId[];
  mobileUsesHub: boolean;
  visibilityMap: Record<TopbarControlId, TopbarControlVisibility>;
};

type ComputeTopbarControlsLayoutParams = {
  availableWidth: number;
  controls: TopbarControlDescriptor[];
  isMobile: boolean;
  iconGap?: number;
  labelPriority?: TopbarControlId[];
};

const DEFAULT_GAP = 8;
const DEFAULT_LABEL_PRIORITY: TopbarControlId[] = ["account", "endpoint", "workspace"];
const ALL_CONTROL_IDS: TopbarControlId[] = ["workspace", "account", "endpoint"];

function createVisibilityMap(initial: TopbarControlVisibility): Record<TopbarControlId, TopbarControlVisibility> {
  return {
    workspace: initial,
    account: initial,
    endpoint: initial,
  };
}

export function computeTopbarControlsLayout({
  availableWidth,
  controls,
  isMobile,
  iconGap = DEFAULT_GAP,
  labelPriority = DEFAULT_LABEL_PRIORITY,
}: ComputeTopbarControlsLayoutParams): TopbarControlsLayoutResult {
  const safeWidth = Math.max(0, Math.floor(availableWidth));
  const visibilityMap = createVisibilityMap("hidden");
  const controlById = new Map<TopbarControlId, TopbarControlDescriptor>();

  controls.forEach((control) => {
    controlById.set(control.id, control);
  });

  if (isMobile) {
    const overflowControls = controls.map((control) => control.id);
    overflowControls.forEach((id) => {
      visibilityMap[id] = "overflow";
    });
    return {
      inlineControls: [],
      overflowControls,
      mobileUsesHub: true,
      visibilityMap,
    };
  }

  const inline = [...controls].sort((left, right) => left.priority - right.priority);
  const overflow: TopbarControlDescriptor[] = [];

  const baseWidthFor = (items: TopbarControlDescriptor[]) =>
    items.reduce((sum, item) => sum + item.estimatedIconWidth, 0) + Math.max(0, items.length - 1) * iconGap;

  let currentWidth = baseWidthFor(inline);

  while (inline.length > 0 && currentWidth > safeWidth) {
    const candidateIndex = inline.reduce((selectedIndex, current, index, list) => {
      if (selectedIndex < 0) return index;
      const selected = list[selectedIndex];
      if (current.priority !== selected.priority) {
        return current.priority > selected.priority ? index : selectedIndex;
      }
      return index;
    }, -1);
    const [removed] = inline.splice(candidateIndex, 1);
    overflow.unshift(removed);
    currentWidth = baseWidthFor(inline);
  }

  const inlineModes = new Map<TopbarControlId, TopbarControlRenderMode>();
  inline.forEach((control) => {
    inlineModes.set(control.id, "icon");
  });

  labelPriority.forEach((id) => {
    const control = inline.find((entry) => entry.id === id);
    if (!control) return;
    const delta = Math.max(0, control.estimatedLabelWidth - control.estimatedIconWidth);
    if (currentWidth + delta <= safeWidth) {
      inlineModes.set(id, "icon_label");
      currentWidth += delta;
    }
  });

  const inlineControls: TopbarInlineControl[] = inline.map((control) => ({
    id: control.id,
    mode: inlineModes.get(control.id) ?? "icon",
  }));
  const overflowControls = overflow.map((control) => control.id);

  ALL_CONTROL_IDS.forEach((id) => {
    if (!controlById.has(id)) {
      visibilityMap[id] = "hidden";
      return;
    }
    const inlineEntry = inlineControls.find((entry) => entry.id === id);
    if (inlineEntry) {
      visibilityMap[id] = inlineEntry.mode === "icon_label" ? "icon_label" : "icon";
      return;
    }
    if (overflowControls.includes(id)) {
      visibilityMap[id] = "overflow";
      return;
    }
    visibilityMap[id] = "hidden";
  });

  return {
    inlineControls,
    overflowControls,
    mobileUsesHub: false,
    visibilityMap,
  };
}
