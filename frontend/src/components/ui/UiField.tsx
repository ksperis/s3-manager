/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { ReactNode } from "react";
import { cx, uiLabelClass } from "./styles";

type UiFieldProps = {
  label: string;
  children: ReactNode;
  className?: string;
  hint?: string;
};

export default function UiField({ label, children, className, hint }: UiFieldProps) {
  return (
    <label className={cx("block", className)}>
      <span className={uiLabelClass}>{label}</span>
      <div className="mt-1">{children}</div>
      {hint ? <p className="mt-1 ui-caption text-slate-500 dark:text-slate-400">{hint}</p> : null}
    </label>
  );
}

