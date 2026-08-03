/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import type { ReactNode } from "react";

type TopbarControlId = "workspace" | "account" | "endpoint";

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
