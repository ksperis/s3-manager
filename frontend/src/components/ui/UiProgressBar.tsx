/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { cx } from "./styles";

type UiProgressBarProps = {
  value: number;
  className?: string;
  barClassName?: string;
};

export default function UiProgressBar({ value, className, barClassName = "bg-primary" }: UiProgressBarProps) {
  const width = Math.max(0, Math.min(100, value));
  return (
    <div className={cx("h-1.5 rounded-full bg-slate-100 dark:bg-slate-800", className)}>
      <div className={cx("h-full rounded-full", barClassName)} style={{ width: `${width}%` }} />
    </div>
  );
}
