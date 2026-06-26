/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import type { ReactNode } from "react";

import PaginationControls from "../PaginationControls";
import SortableHeader from "../SortableHeader";
import TableEmptyState from "../TableEmptyState";
import { cx } from "../ui/styles";
import type { ListTableStatus } from "./listTableStatus";

type SortDirection = "asc" | "desc";

export type DataTableColumn<Row, SortField extends string = string> = {
  id: string;
  label: string;
  field?: SortField | null;
  align?: "left" | "right";
  headerClassName?: string;
  cellClassName?: string;
  primary?: boolean;
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
  tableClassName?: string;
  containerClassName?: string;
  tbodyClassName?: string;
  rowClassName?: string | ((row: Row) => string | undefined);
  overflowXHidden?: boolean;
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
  tableClassName,
  containerClassName,
  tbodyClassName,
  rowClassName = "hover:bg-slate-50 dark:hover:bg-slate-800/40",
  overflowXHidden = false,
}: DataTableShellProps<Row, SortField>) {
  const resolveRowClassName = (row: Row) => (typeof rowClassName === "function" ? rowClassName(row) : rowClassName);

  return (
    <>
      <div className={cx(overflowXHidden ? "overflow-x-hidden" : "overflow-x-auto", containerClassName)}>
        <table className={cx("manager-table !table-auto !w-max min-w-full divide-y divide-slate-200 dark:divide-slate-800", tableClassName)}>
          <thead className="bg-slate-50 dark:bg-slate-900/50">
            <tr>
              {columns.map((column) => (
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
              ))}
            </tr>
          </thead>
          <tbody className={cx("divide-y divide-slate-200 dark:divide-slate-800", tbodyClassName)}>
            {status === "loading" && <TableEmptyState colSpan={columns.length} message={loadingMessage} />}
            {status === "error" && <TableEmptyState colSpan={columns.length} message={errorMessage} tone="error" />}
            {status === "empty" && <TableEmptyState colSpan={columns.length} message={emptyMessage} />}
            {rows.map((row) => {
              const key = rowKey(row);
              return (
                <tr key={key} className={resolveRowClassName(row)}>
                  {columns.map((column) => {
                    const align = column.align ?? "left";
                    const cellBase = align === "right" ? "px-6 py-4 text-right" : "px-6 py-4";
                    const isPrimary = column.primary || column.id === primaryColumnId;
                    const textClass = isPrimary
                      ? "manager-table-cell ui-body font-semibold text-slate-900 dark:text-slate-100"
                      : "ui-body text-slate-600 dark:text-slate-300";
                    return (
                      <td key={`${key}:${column.id}`} className={cx(cellBase, textClass, column.cellClassName)}>
                        {column.render(row)}
                      </td>
                    );
                  })}
                </tr>
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
          disabled={pagination.disabled}
        />
      ) : null}
    </>
  );
}
