/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { Children, cloneElement, isValidElement, type ReactElement, type ReactNode } from "react";

import { cx } from "../ui/styles";

export type ManagerTableColumn = {
  key: string;
  label: ReactNode;
  align?: "left" | "right";
  className?: string;
  hideLabel?: boolean;
  mobileLabel?: string;
  mobileRole?: "primary" | "actions";
  mobileHidden?: boolean;
};

type ManagerTableProps = {
  columns: ManagerTableColumn[];
  children: ReactNode;
  className?: string;
  responsiveCards?: boolean;
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

function tableCellSpan(cell: ReactElement): number {
  const { colSpan } = cell.props as { colSpan?: number };
  return typeof colSpan === "number" && colSpan > 0 ? colSpan : 1;
}

function isTableCellElement(child: ReactNode): child is ReactElement {
  return isValidElement(child) && (child.type === "td" || child.type === "th");
}

function labelToText(label: ReactNode): string | undefined {
  if (typeof label === "string" || typeof label === "number") {
    return String(label);
  }
  return undefined;
}

function decorateResponsiveRow(row: ReactElement, columns: ManagerTableColumn[]) {
  let columnIndex = 0;
  const rowProps = row.props as { children?: ReactNode };
  const cells = Children.map(rowProps.children, (cell) => {
    if (!isTableCellElement(cell)) return cell;

    const column = columns[columnIndex];
    const span = tableCellSpan(cell);
    columnIndex += span;

    if (!column || span > 1) return cell;

    const mobileRole = column.mobileRole;
    const mobileLabel = column.mobileLabel ?? labelToText(column.label);
    return cloneElement(cell, {
      "data-label": !mobileRole && !column.mobileHidden && mobileLabel ? mobileLabel : undefined,
      "data-mobile-primary": mobileRole === "primary" ? "true" : undefined,
      "data-mobile-actions": mobileRole === "actions" ? "true" : undefined,
      "data-mobile-hidden": column.mobileHidden ? "true" : undefined,
    });
  });

  return cloneElement(row, undefined, cells);
}

function decorateResponsiveRows(children: ReactNode, columns: ManagerTableColumn[]) {
  return Children.map(children, (child) => {
    if (!isValidElement(child) || child.type !== "tr") return child;
    return decorateResponsiveRow(child, columns);
  });
}

export default function ManagerTable({ columns, children, className, responsiveCards = false, tbodyClassName }: ManagerTableProps) {
  const bodyChildren = responsiveCards ? decorateResponsiveRows(children, columns) : children;

  return (
    <div className={responsiveCards ? "overflow-x-hidden md:overflow-x-auto" : "overflow-x-auto"}>
      <table className={cx("manager-table min-w-full divide-y divide-slate-200 dark:divide-slate-800", responsiveCards && "responsive-data-table", className)}>
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
        <tbody className={cx("divide-y divide-slate-200 dark:divide-slate-800", tbodyClassName)}>{bodyChildren}</tbody>
      </table>
    </div>
  );
}
