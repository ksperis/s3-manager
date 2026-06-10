/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import type { ReactNode } from "react";

import { cx } from "../ui/styles";

export type ManagerTableColumn = {
  key: string;
  label: ReactNode;
  align?: "left" | "right";
  className?: string;
  hideLabel?: boolean;
};

type ManagerTableProps = {
  columns: ManagerTableColumn[];
  children: ReactNode;
  className?: string;
  tbodyClassName?: string;
};

export const managerTablePrimaryCellClass = "manager-table-cell px-6 py-4 ui-body font-semibold text-slate-900 dark:text-slate-100";
export const managerTableCellClass = "manager-table-cell px-6 py-4 ui-body text-slate-600 dark:text-slate-300";
export const managerTableWideCellClass = "manager-table-cell-wide px-6 py-4 ui-body text-slate-600 dark:text-slate-300";
export const managerTableActionCellClass = "px-6 py-4 text-right";
export const managerTableCheckboxCellClass = "w-12 px-6 py-4";
export const managerTableMutedCellClass = "px-6 py-4 ui-caption text-slate-500 dark:text-slate-400";
export const managerTableErrorCellClass = "px-6 py-4 ui-caption text-rose-600 dark:text-rose-200";
export const managerTableMutedRowClass = "bg-slate-50/70 dark:bg-slate-900/40";

export default function ManagerTable({ columns, children, className, tbodyClassName }: ManagerTableProps) {
  return (
    <div className="overflow-x-auto">
      <table className={cx("manager-table min-w-full divide-y divide-slate-200 dark:divide-slate-800", className)}>
        <thead className="bg-slate-50 dark:bg-slate-900/50">
          <tr>
            {columns.map((column) => (
              <th
                key={column.key}
                className={cx(
                  "px-6 py-3 ui-caption font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400",
                  column.align === "right" ? "text-right" : "text-left",
                  column.className
                )}
              >
                {column.hideLabel ? <span className="sr-only">{column.label}</span> : column.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className={cx("divide-y divide-slate-200 dark:divide-slate-800", tbodyClassName)}>{children}</tbody>
      </table>
    </div>
  );
}
