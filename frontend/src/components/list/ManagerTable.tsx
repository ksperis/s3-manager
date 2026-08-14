/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { Children, cloneElement, isValidElement, type ReactElement, type ReactNode } from "react";

import TableEmptyState from "../TableEmptyState";
import { cx } from "../ui/styles";
import type { ListTableStatus } from "./listTableStatus";

type SortDirection = "asc" | "desc";

export type ManagerTableColumn<TSortField extends string = string> = {
  key: string;
  label: ReactNode;
  align?: "left" | "right";
  className?: string;
  hideLabel?: boolean;
  sortField?: TSortField | null;
  mobileLabel?: string;
  mobileRole?: "primary" | "actions";
  mobileHidden?: boolean;
};

type ManagerTableProps<TSortField extends string = string> = {
  columns: ManagerTableColumn<TSortField>[];
  children: ReactNode;
  className?: string;
  listState?: {
    status: ListTableStatus;
    loadingMessage: string;
    errorMessage: string;
    emptyMessage: string;
  };
  responsiveCards?: boolean;
  sort?: {
    field: TSortField;
    direction: SortDirection;
    onSort: (field: TSortField) => void;
  };
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

function decorateTableRow(row: ReactElement, columns: ManagerTableColumn[], responsiveCards: boolean) {
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
      "data-label": responsiveCards && !mobileRole && !column.mobileHidden && mobileLabel ? mobileLabel : undefined,
      "data-mobile-primary": responsiveCards && mobileRole === "primary" ? "true" : undefined,
      "data-mobile-actions": responsiveCards && mobileRole === "actions" ? "true" : undefined,
      "data-mobile-hidden": responsiveCards && column.mobileHidden ? "true" : undefined,
      "data-table-actions": mobileRole === "actions" ? "true" : undefined,
    });
  });

  return cloneElement(row, undefined, cells);
}

function decorateTableRows(children: ReactNode, columns: ManagerTableColumn[], responsiveCards: boolean) {
  return Children.map(children, (child) => {
    if (!isValidElement(child) || child.type !== "tr") return child;
    return decorateTableRow(child, columns, responsiveCards);
  });
}

function renderColumnLabel<TSortField extends string>(
  column: ManagerTableColumn<TSortField>,
  sort?: ManagerTableProps<TSortField>["sort"]
) {
  const isSortable = Boolean(column.sortField && sort);
  const isActive = isSortable && column.sortField === sort?.field;

  if (!isSortable) {
    return column.hideLabel ? <span className="sr-only">{column.label}</span> : column.label;
  }

  return (
    <button
      type="button"
      onClick={() => column.sortField && sort?.onSort(column.sortField)}
      className={cx(
        "flex w-full items-center text-left uppercase text-slate-500 transition hover:text-primary-700 dark:text-slate-400 dark:hover:text-primary-100",
        column.align === "right" ? "justify-end" : "gap-1"
      )}
    >
      <span>{column.label}</span>
      {isActive && (
        <span className="ui-caption" aria-hidden="true">
          {sort?.direction === "asc" ? "▲" : "▼"}
        </span>
      )}
    </button>
  );
}

export default function ManagerTable<TSortField extends string = string>({
  columns,
  children,
  className,
  listState,
  responsiveCards = false,
  sort,
  tbodyClassName,
}: ManagerTableProps<TSortField>) {
  const bodyChildren = decorateTableRows(children, columns, responsiveCards);

  return (
    <div className={responsiveCards ? "overflow-x-hidden md:overflow-x-auto" : "overflow-x-auto"}>
      <table className={cx("manager-table min-w-full divide-y divide-slate-200 dark:divide-slate-800", responsiveCards && "responsive-data-table", className)}>
        <thead className="bg-slate-50 dark:bg-slate-900/50">
          <tr>
            {columns.map((column) => {
              const isSortable = Boolean(column.sortField && sort);
              const isActive = isSortable && column.sortField === sort?.field;
              return (
                <th
                  key={column.key}
                  data-table-actions={column.mobileRole === "actions" ? "true" : undefined}
                  className={cx(
                    "px-6 py-3 ui-caption font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400",
                    column.align === "right" ? "text-right" : "text-left",
                    column.className
                  )}
                  aria-sort={
                    isSortable ? (isActive ? (sort?.direction === "asc" ? "ascending" : "descending") : "none") : undefined
                  }
                >
                  {renderColumnLabel(column, sort)}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody className={cx("divide-y divide-slate-200 dark:divide-slate-800", tbodyClassName)}>
          {listState?.status === "loading" && (
            <TableEmptyState colSpan={columns.length} message={listState.loadingMessage} />
          )}
          {listState?.status === "error" && (
            <TableEmptyState colSpan={columns.length} message={listState.errorMessage} tone="error" />
          )}
          {listState?.status === "empty" && <TableEmptyState colSpan={columns.length} message={listState.emptyMessage} />}
          {bodyChildren}
        </tbody>
      </table>
    </div>
  );
}
