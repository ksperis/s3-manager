/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import type { ReactNode } from "react";
import { cx } from "./ui/styles";

type ListToolbarProps = {
  title: ReactNode;
  description?: ReactNode;
  countLabel?: ReactNode;
  search?: ReactNode;
  filters?: ReactNode;
  columns?: ReactNode;
  actions?: ReactNode;
  secondaryContent?: ReactNode;
  className?: string;
};

function ToolbarControlGroup({ children }: { children: ReactNode }) {
  if (!children) {
    return null;
  }
  return <div className="flex flex-wrap items-center gap-2">{children}</div>;
}

export default function ListToolbar({
  title,
  description,
  countLabel,
  search,
  filters,
  columns,
  actions,
  secondaryContent,
  className,
}: ListToolbarProps) {
  return (
    <div className={cx("border-b border-slate-200 dark:border-slate-800", className)}>
      <div className="flex flex-col gap-3 px-4 py-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div className="space-y-1">
            <p className="ui-body font-semibold text-slate-900 dark:text-slate-50">{title}</p>
            {description ? <p className="ui-caption text-slate-500 dark:text-slate-400">{description}</p> : null}
          </div>
          <div className="flex flex-wrap items-center gap-2 lg:justify-end">
            {countLabel ? <span className="ui-caption text-slate-500 dark:text-slate-400">{countLabel}</span> : null}
            <ToolbarControlGroup>{search}</ToolbarControlGroup>
            <ToolbarControlGroup>{filters}</ToolbarControlGroup>
            <ToolbarControlGroup>{columns}</ToolbarControlGroup>
            <ToolbarControlGroup>{actions}</ToolbarControlGroup>
          </div>
        </div>
      </div>
      {secondaryContent ? (
        <div className="border-t border-slate-200 bg-slate-50/70 px-4 py-4 dark:border-slate-800 dark:bg-slate-900/40">
          {secondaryContent}
        </div>
      ) : null}
    </div>
  );
}
