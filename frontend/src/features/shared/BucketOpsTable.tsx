/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import type { ReactNode } from "react";
import type { CephAdminBucket } from "../../api/cephAdmin";
import type { ListTableStatus } from "../../components/list/listTableStatus";
import SortableHeader from "../../components/SortableHeader";
import TableEmptyState from "../../components/TableEmptyState";
import type { SortField } from "./bucketOpsListState";
import { isStatsSortField } from "./bucketOpsPresentation";

export type BucketOpsTableColumn = {
  id: string;
  label: string;
  field?: SortField | null;
  align?: "left" | "right";
  expensive?: boolean;
  header?: ReactNode;
  headerClassName?: string;
  cellClassName?: string;
  render: (bucket: CephAdminBucket) => ReactNode;
};

type BucketOpsTableProps = {
  columns: readonly BucketOpsTableColumn[];
  detailLoadingColumnIds: ReadonlySet<string>;
  items: readonly CephAdminBucket[];
  loadingDetails: boolean;
  onSort: (field: SortField) => void;
  showAdvancedFilter: boolean;
  sort: { field: SortField; direction: "asc" | "desc" };
  status: ListTableStatus;
  usageFeatureEnabled: boolean;
};

const expensiveColumnClass = "bg-amber-50/60 dark:bg-amber-900/20";
const defaultColumnMinWidthClass = "min-w-[9rem]";
const stickySelectHeaderClass =
  "sticky left-0 z-40 bg-slate-100 dark:bg-slate-900 shadow-[inset_-1px_0_0_rgba(100,116,139,0.45),10px_0_14px_-12px_rgba(15,23,42,0.4)] dark:shadow-[inset_-1px_0_0_rgba(51,65,85,0.9),10px_0_14px_-12px_rgba(2,6,23,0.85)]";
const stickyNameHeaderClass =
  "sticky left-10 z-30 bg-slate-100 dark:bg-slate-900 shadow-[inset_-1px_0_0_rgba(100,116,139,0.45),12px_0_16px_-12px_rgba(15,23,42,0.45)] dark:shadow-[inset_-1px_0_0_rgba(51,65,85,0.9),12px_0_16px_-12px_rgba(2,6,23,0.85)]";
const stickySelectCellClass =
  "sticky left-0 z-20 bg-white dark:bg-slate-900 group-hover:bg-slate-100 dark:group-hover:bg-slate-900 shadow-[inset_-1px_0_0_rgba(100,116,139,0.45),10px_0_14px_-12px_rgba(15,23,42,0.4)] dark:shadow-[inset_-1px_0_0_rgba(51,65,85,0.9),10px_0_14px_-12px_rgba(2,6,23,0.85)]";
const stickyNameCellClass =
  "sticky left-10 z-10 bg-white dark:bg-slate-900 group-hover:bg-slate-100 dark:group-hover:bg-slate-900 shadow-[inset_-1px_0_0_rgba(100,116,139,0.45),12px_0_16px_-12px_rgba(15,23,42,0.45)] dark:shadow-[inset_-1px_0_0_rgba(51,65,85,0.9),12px_0_16px_-12px_rgba(2,6,23,0.85)]";

function headerClassName(
  column: BucketOpsTableColumn,
  loadingDetails: boolean,
  detailLoadingColumnIds: ReadonlySet<string>,
) {
  const minWidthClass =
    column.id !== "select" && !column.headerClassName
      ? defaultColumnMinWidthClass
      : "";
  const detailLoadingClass =
    loadingDetails && detailLoadingColumnIds.has(column.id)
      ? "animate-pulse"
      : "";
  const stickyClass =
    column.id === "select"
      ? stickySelectHeaderClass
      : column.id === "name"
        ? stickyNameHeaderClass
        : "";
  return `${minWidthClass} ${column.headerClassName ?? ""} ${column.expensive ? expensiveColumnClass : ""} ${detailLoadingClass} ${stickyClass}`;
}

function cellClassName(
  column: BucketOpsTableColumn,
  loadingDetails: boolean,
  detailLoadingColumnIds: ReadonlySet<string>,
) {
  const align = column.align ?? (column.id === "actions" ? "right" : "left");
  const cellBase =
    align === "right"
      ? "px-6 py-4 text-right"
      : column.id === "select"
        ? "w-10 px-3 py-4"
        : "px-6 py-4";
  const textClass =
    column.id === "select"
      ? ""
      : column.id === "name"
        ? "manager-table-cell ui-body font-semibold text-slate-900 dark:text-slate-100"
        : "ui-body text-slate-600 dark:text-slate-300";
  const detailLoadingCellClass =
    loadingDetails && detailLoadingColumnIds.has(column.id)
      ? column.expensive
        ? "animate-pulse bg-amber-100/70 dark:bg-amber-900/30"
        : "animate-pulse bg-slate-100/70 dark:bg-slate-800/60"
      : "";
  const stickyClass =
    column.id === "select"
      ? stickySelectCellClass
      : column.id === "name"
        ? stickyNameCellClass
        : "";
  return `${cellBase} ${textClass} ${column.cellClassName ?? ""} ${column.expensive ? expensiveColumnClass : ""} ${detailLoadingCellClass} ${stickyClass}`;
}

export default function BucketOpsTable({
  columns,
  detailLoadingColumnIds,
  items,
  loadingDetails,
  onSort,
  showAdvancedFilter,
  sort,
  status,
  usageFeatureEnabled,
}: BucketOpsTableProps) {
  return (
    <div className={showAdvancedFilter ? "overflow-x-hidden" : "overflow-x-auto"}>
      <table className="manager-table !table-auto !w-max min-w-full divide-y divide-slate-200 dark:divide-slate-800">
        <thead className="bg-slate-50 dark:bg-slate-900/50">
          <tr>
            {columns.map((column) => {
              const className = headerClassName(
                column,
                loadingDetails,
                detailLoadingColumnIds,
              );
              if (column.header || !column.field) {
                return (
                  <th
                    key={column.id}
                    className={`py-3 ui-caption font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400 ${
                      column.align === "right" ? "text-right" : "text-left"
                    } ${column.id === "select" ? "w-10 px-3" : "px-6"} ${className}`}
                  >
                    <div className="flex items-start">
                      {column.header ?? column.label}
                    </div>
                  </th>
                );
              }
              return (
                <SortableHeader
                  key={column.id}
                  label={column.label}
                  field={column.field}
                  activeField={sort.field}
                  direction={sort.direction}
                  align={
                    column.align ??
                    (column.label === "Actions" ? "right" : "left")
                  }
                  className={className}
                  onSort={
                    usageFeatureEnabled || !isStatsSortField(column.field)
                      ? onSort
                      : undefined
                  }
                />
              );
            })}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
          {status === "loading" && (
            <TableEmptyState
              colSpan={columns.length}
              message="Loading buckets..."
            />
          )}
          {status === "error" && (
            <TableEmptyState
              colSpan={columns.length}
              message="Unable to load buckets."
              tone="error"
            />
          )}
          {status === "empty" && (
            <TableEmptyState colSpan={columns.length} message="No buckets." />
          )}
          {items.map((bucket) => (
            <tr
              key={`${bucket.tenant ?? ""}:${bucket.name}`}
              className="group hover:bg-slate-50 dark:hover:bg-slate-800/40"
            >
              {columns.map((column) => (
                <td
                  key={`${bucket.name}:${column.id}`}
                  className={cellClassName(
                    column,
                    loadingDetails,
                    detailLoadingColumnIds,
                  )}
                >
                  {column.render(bucket)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
