/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { ReactNode, CSSProperties } from "react";

type SplitViewProps = {
  left: ReactNode;
  right: ReactNode;
  leftWidth?: string;
};

export default function SplitView({ left, right, leftWidth = "320px" }: SplitViewProps) {
  return (
    <div
      className="grid gap-4 lg:grid-cols-[minmax(var(--split-left,320px),1fr)_2fr]"
      style={{ "--split-left": leftWidth } as CSSProperties}
    >
      <div className="ui-surface-card">
        {left}
      </div>
      <div className="ui-surface-card">
        {right}
      </div>
    </div>
  );
}
