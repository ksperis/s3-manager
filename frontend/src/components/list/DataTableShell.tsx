/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { Fragment, type HTMLAttributes, type MouseEvent as ReactMouseEvent, type ReactNode } from "react";

import PaginationControls from "../PaginationControls";
import SortableHeader from "../SortableHeader";
import TableEmptyState from "../TableEmptyState";
import { tableActionColumnClasses } from "../tableActionClasses";
import { cx } from "../ui/styles";
import type { ListTableStatus } from "./listTableStatus";

type SortDirection = "asc" | "desc";

export const dataTableDefaultActionProps = {
  "data-table-default-action": "true",
} as const;

const interactiveRowTargetSelector = [
  "a[href]",
  "button",
  "input",
  "select",
  "textarea",
  "label",
  "summary",
  "[contenteditable='true']",
  "[data-table-row-click-ignore='true']",
  "[role='button']",
  "[role='link']",
  "[role='checkbox']",
  "[role='switch']",
  "[role='menuitem']",
  "[role='menuitemcheckbox']",
  "[role='menuitemradio']",
  "[role='option']",
  "[role='radio']",
  "[role='tab']",
  "[role='textbox']",
  "[role='searchbox']",
  "[role='treeitem']",
  "[role='combobox']",
  "[role='scrollbar']",
  "[role='slider']",
  "[role='spinbutton']",
  "[aria-controls]",
  "[aria-expanded]",
  "[aria-haspopup]",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

function handleDefaultRowAction(event: ReactMouseEvent<HTMLTableSectionElement>) {
  const target = event.target;
  if (!(target instanceof Element)) return;
  if (target.closest(interactiveRowTargetSelector)) return;

  const selection = typeof window === "undefined" ? null : window.getSelection();
  if (selection && !selection.isCollapsed) return;

  const row = target.closest("tr");
  if (!row || row.dataset.expandedRow === "true" || !event.currentTarget.contains(row)) return;

  const action = row.querySelector<HTMLElement>("[data-table-default-action='true']");
  if (!action || action.matches(":disabled, [aria-disabled='true']")) return;
  action.click();
}

export type DataTableColumn<Row, SortField extends string = string> = {
  id: string;
  label: string;
  header?: ReactNode;
  field?: SortField | null;
  align?: "left" | "right";
  headerClassName?: string;
  cellClassName?: string;
  primary?: boolean;
  mobileLabel?: string;
  mobileRole?: "primary" | "actions";
  mobileHidden?: boolean;
  render: (row: Row) => ReactNode;
};

type DataTableSort<SortField extends string> = {
  field: SortField;
  direction: SortDirection;
  onSort: (field: SortField) => void;
};

type DataTablePagination = {
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
  onPageSizeChange?: (size: number) => void;
  pageSizeOptions?: number[];
  disabled?: boolean;
};

type DataTableShellProps<Row, SortField extends string = string> = {
  columns: Array<DataTableColumn<Row, SortField>>;
  rows: Row[];
  rowKey: (row: Row) => string | number;
  status: ListTableStatus;
  loadingMessage: string;
  errorMessage: string;
  emptyMessage: string;
  sort?: DataTableSort<SortField>;
  pagination?: DataTablePagination;
  primaryColumnId?: string;
  tableLayout?: "auto" | "fixed";
  tableClassName?: string;
  containerClassName?: string;
  tbodyClassName?: string;
  rowClassName?: string | ((row: Row) => string | undefined);
  rowAttributes?: (row: Row) => Omit<HTMLAttributes<HTMLTableRowElement>, "children" | "className">;
  expandedRow?: (row: Row) => ReactNode;
  expandedRowClassName?: string | ((row: Row) => string | undefined);
  overflowXHidden?: boolean;
  responsiveCards?: boolean;
  stickyActions?: boolean;
};

export default function DataTableShell<Row, SortField extends string = string>({
  columns,
  rows,
  rowKey,
  status,
  loadingMessage,
  errorMessage,
  emptyMessage,
  sort,
  pagination,
  primaryColumnId,
  tableLayout = "auto",
  tableClassName,
  containerClassName,
  tbodyClassName,
  rowClassName = "hover:bg-slate-50 dark:hover:bg-slate-800/40",
  rowAttributes,
  expandedRow,
  expandedRowClassName = "bg-slate-50/70 dark:bg-slate-900/40",
  overflowXHidden = false,
  responsiveCards = false,
  stickyActions = true,
}: DataTableShellProps<Row, SortField>) {
  const resolveRowClassName = (row: Row) => (typeof rowClassName === "function" ? rowClassName(row) : rowClassName);
  const resolveExpandedRowClassName = (row: Row) =>
    typeof expandedRowClassName === "function" ? expandedRowClassName(row) : expandedRowClassName;
  const containerOverflowClass = responsiveCards
    ? overflowXHidden
      ? "overflow-x-hidden"
      : "overflow-x-hidden md:overflow-x-auto"
    : overflowXHidden
      ? "overflow-x-hidden"
      : "overflow-x-auto";

  return (
    <>
      <div className={cx(containerOverflowClass, containerClassName)}>
        <table
          className={cx(
            "manager-table min-w-full divide-y divide-slate-200 dark:divide-slate-800",
            tableLayout === "auto" && "!table-auto !w-max",
            responsiveCards && "responsive-data-table",
            tableClassName
          )}
        >
          <thead className="bg-slate-50 dark:bg-slate-900/50">
            <tr>
              {columns.map((column) => (
                column.header || column.mobileRole === "actions" ? (
                  <th
                    key={column.id}
                    data-table-actions={stickyActions && column.mobileRole === "actions" ? "true" : undefined}
                    className={cx(
                      "px-6 py-3 ui-caption font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400",
                      column.mobileRole === "actions" && tableActionColumnClasses,
                      (column.align ?? "left") === "right" ? "text-right" : "text-left",
                      column.headerClassName
                    )}
                  >
                    <div className={cx("flex items-center", (column.align ?? "left") === "right" ? "justify-end" : "gap-1")}>
                      {column.header ?? column.label}
                    </div>
                  </th>
                ) : (
                  <SortableHeader
                    key={column.id}
                    label={column.label}
                    field={column.field ?? null}
                    activeField={sort?.field ?? null}
                    direction={sort?.direction ?? "asc"}
                    align={column.align ?? "left"}
                    className={column.headerClassName ?? ""}
                    onSort={sort?.onSort}
                  />
                )
              ))}
            </tr>
          </thead>
          <tbody
            className={cx("divide-y divide-slate-200 dark:divide-slate-800", tbodyClassName)}
            onClick={handleDefaultRowAction}
          >
            {status === "loading" && <TableEmptyState colSpan={columns.length} message={loadingMessage} />}
            {status === "error" && <TableEmptyState colSpan={columns.length} message={errorMessage} tone="error" />}
            {status === "empty" && <TableEmptyState colSpan={columns.length} message={emptyMessage} />}
            {rows.map((row) => {
              const key = rowKey(row);
              const expandedContent = expandedRow?.(row);
              return (
                <Fragment key={key}>
                  <tr className={resolveRowClassName(row)} {...rowAttributes?.(row)}>
                    {columns.map((column) => {
                      const align = column.align ?? "left";
                      const cellBase = align === "right" ? "px-6 py-4 text-right" : "px-6 py-4";
                      const isPrimary = column.primary || column.id === primaryColumnId;
                      const mobileRole = column.mobileRole ?? (isPrimary ? "primary" : undefined);
                      const mobileLabel = column.mobileLabel ?? column.label;
                      const textClass = isPrimary
                        ? "manager-table-cell ui-body font-semibold text-slate-900 dark:text-slate-100"
                        : "ui-body text-slate-600 dark:text-slate-300";
                      return (
                        <td
                          key={`${key}:${column.id}`}
                          className={cx(
                            cellBase,
                            textClass,
                            mobileRole === "actions" && tableActionColumnClasses,
                            column.cellClassName
                          )}
                          data-label={responsiveCards && !mobileRole && !column.mobileHidden ? mobileLabel : undefined}
                          data-mobile-primary={responsiveCards && mobileRole === "primary" ? "true" : undefined}
                          data-mobile-actions={responsiveCards && mobileRole === "actions" ? "true" : undefined}
                          data-mobile-hidden={responsiveCards && column.mobileHidden ? "true" : undefined}
                          data-table-actions={stickyActions && mobileRole === "actions" ? "true" : undefined}
                        >
                          {column.render(row)}
                        </td>
                      );
                    })}
                  </tr>
                  {expandedContent ? (
                    <tr className={resolveExpandedRowClassName(row)} data-expanded-row="true">
                      <td colSpan={columns.length} className="px-6 py-4 ui-body text-slate-600 dark:text-slate-300">
                        {expandedContent}
                      </td>
                    </tr>
                  ) : null}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
      {pagination ? (
        <PaginationControls
          page={pagination.page}
          pageSize={pagination.pageSize}
          total={pagination.total}
          onPageChange={pagination.onPageChange}
          onPageSizeChange={pagination.onPageSizeChange}
          pageSizeOptions={pagination.pageSizeOptions}
          disabled={pagination.disabled}
        />
      ) : null}
    </>
  );
}
