/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import type { ReactNode } from "react";
import { cx } from "../ui/styles";

type ListSectionCardProps = {
  title: ReactNode;
  subtitle?: ReactNode;
  rightContent?: ReactNode;
  afterHeader?: ReactNode;
  children: ReactNode;
  className?: string;
};

export default function ListSectionCard({
  title,
  subtitle,
  rightContent,
  afterHeader,
  children,
  className,
}: ListSectionCardProps) {
  return (
    <div className={cx("ui-surface-card", className)}>
      <div className="border-b border-slate-200 px-4 py-4 dark:border-slate-800">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="ui-body font-semibold text-slate-900 dark:text-slate-50">{title}</p>
            {subtitle ? <p className="ui-caption text-slate-500 dark:text-slate-400">{subtitle}</p> : null}
          </div>
          {rightContent ? <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-end">{rightContent}</div> : null}
        </div>
      </div>
      {afterHeader}
      {children}
    </div>
  );
}
