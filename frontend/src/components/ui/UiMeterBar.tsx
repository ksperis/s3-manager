/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { cx } from "./styles";

type UiMeterBarProps = {
  value?: number | null;
  label?: string;
  showLabel?: boolean;
  className?: string;
  barClassName?: string;
};

export default function UiMeterBar({
  value,
  label = "Usage",
  showLabel = false,
  className,
  barClassName = "bg-primary",
}: UiMeterBarProps) {
  const width = Math.max(0, Math.min(100, value ?? 0));
  return (
    <>
      {showLabel ? <span className="sr-only">{label}</span> : null}
      <div
        className={cx("h-1.5 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800", className)}
        role="meter"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(width)}
      >
        <div className={cx("h-full rounded-full", barClassName)} style={{ width: `${width}%` }} />
      </div>
    </>
  );
}
