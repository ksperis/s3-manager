import type {
  MouseEventHandler,
  PointerEventHandler,
  ReactNode,
} from "react";

import { uiCheckboxClass } from "../../components/ui/styles";
import { UpIcon } from "./browserIcons";
import {
  BrowserColumnResizeHandle,
  BrowserObjectColumnHeaderContent,
} from "./BrowserObjectTablePresentation";
import type {
  BrowserColumnId,
  BrowserResizableColumnId,
  BrowserSortKey,
  ColumnDefinition,
} from "./browserObjectTableModel";

type BrowserObjectTableScaffoldProps = {
  children: ReactNode;
  minWidthPx: number;
  selectionColumnWidthPx: number;
  nameColumnWidthPx: number;
  actionsColumnWidthPx: number;
  columns: readonly ColumnDefinition[];
  columnWidthsPx: Readonly<Record<BrowserColumnId, number>>;
  headerPaddingClasses: string;
  allSelected: boolean;
  selectionDisabled: boolean;
  nameHeader: ReactNode;
  sortKey: BrowserSortKey;
  sortDirection: "asc" | "desc";
  activeResizeColumnId: BrowserResizableColumnId | null;
  onToggleAll: () => void;
  onSort: (sortKey: BrowserSortKey) => void;
  onStartResize: (
    columnId: BrowserResizableColumnId,
  ) => PointerEventHandler<HTMLDivElement>;
  onResetColumnWidth: (columnId: BrowserResizableColumnId) => void;
  onHeaderContextMenu: MouseEventHandler<HTMLTableSectionElement>;
};

export function BrowserObjectTableScaffold({
  children,
  minWidthPx,
  selectionColumnWidthPx,
  actionsColumnWidthPx,
  columns,
  columnWidthsPx,
  headerPaddingClasses,
  allSelected,
  selectionDisabled,
  nameHeader,
  sortKey,
  sortDirection,
  activeResizeColumnId,
  onToggleAll,
  onSort,
  onStartResize,
  onResetColumnWidth,
  onHeaderContextMenu,
}: BrowserObjectTableScaffoldProps) {
  return (
    <table
      className="manager-table min-w-full border-separate border-spacing-0 divide-y divide-slate-200 dark:divide-slate-800"
      style={{ minWidth: `${minWidthPx}px` }}
    >
      <colgroup>
        <col style={{ width: `${selectionColumnWidthPx}px` }} />
        {/* Keep Name as the only elastic column so fixed columns do not absorb
            spare table width. The table minimum width still reserves its
            configured width when horizontal scrolling is required. */}
        <col />
        {columns.map((column) => (
          <col
            key={column.id}
            style={{ width: `${columnWidthsPx[column.id]}px` }}
          />
        ))}
        <col style={{ width: `${actionsColumnWidthPx}px` }} />
      </colgroup>
      <thead
        className="sticky top-0 z-[1] border-b border-slate-200 bg-white/95 backdrop-blur dark:border-slate-700 dark:bg-slate-900/95"
        onContextMenu={onHeaderContextMenu}
      >
        <tr>
          <th
            aria-label="Select all"
            className={`px-2 ${headerPaddingClasses} !align-middle text-left ui-caption font-semibold text-slate-500 dark:text-slate-400`}
          >
            <input
              type="checkbox"
              checked={allSelected}
              onChange={onToggleAll}
              aria-label="Select all"
              className={uiCheckboxClass}
              disabled={selectionDisabled}
            />
          </th>
          <th
            aria-label="Name"
            className={`relative px-4 ${headerPaddingClasses} !align-middle text-left ui-caption font-semibold text-slate-500 dark:text-slate-400`}
          >
            {nameHeader}
            <BrowserColumnResizeHandle
              label="Name"
              active={activeResizeColumnId === "name"}
              onPointerDown={onStartResize("name")}
              onReset={() => onResetColumnWidth("name")}
            />
          </th>
          {columns.map((column) => (
            <th
              key={column.id}
              aria-label={column.label}
              className={`relative px-2 ${headerPaddingClasses} !align-middle ${
                column.align === "right" ? "text-right" : "text-left"
              } ui-caption font-semibold text-slate-500 dark:text-slate-400`}
            >
              <div
                className={`pr-3 ${
                  column.align === "right" ? "flex justify-end" : ""
                }`}
              >
                <BrowserObjectColumnHeaderContent
                  column={column}
                  sortKey={sortKey}
                  sortDirection={sortDirection}
                  onSort={onSort}
                />
              </div>
              <BrowserColumnResizeHandle
                label={column.label}
                active={activeResizeColumnId === column.id}
                onPointerDown={onStartResize(column.id)}
                onReset={() => onResetColumnWidth(column.id)}
              />
            </th>
          ))}
          <th
            aria-label="Actions"
            className={`px-2 ${headerPaddingClasses} !align-middle text-right ui-caption font-semibold text-slate-500 dark:text-slate-400`}
          >
            <span className="inline-flex h-6 items-center">Actions</span>
          </th>
        </tr>
      </thead>
      <tbody className="divide-y divide-slate-200/80 dark:divide-slate-800">
        {children}
      </tbody>
    </table>
  );
}

type BrowserParentFolderRowProps = {
  columns: readonly ColumnDefinition[];
  nameColumnWidthPx: number;
  rowHeightClasses: string;
  rowCellClasses: string;
  iconBoxClasses: string;
  onGoUp: () => void;
};

export function BrowserParentFolderRow({
  columns,
  nameColumnWidthPx,
  rowHeightClasses,
  rowCellClasses,
  iconBoxClasses,
  onGoUp,
}: BrowserParentFolderRowProps) {
  return (
    <tr
      className={`${rowHeightClasses} text-slate-600 transition-colors hover:bg-slate-50/70 dark:text-slate-300 dark:hover:bg-slate-800/40`}
    >
      <td className={`px-2 ${rowCellClasses} !align-middle`} />
      <td
        className={`manager-table-cell min-w-0 px-4 ${rowCellClasses} !align-middle ui-body`}
        style={{ maxWidth: `${nameColumnWidthPx}px` }}
      >
        <button
          type="button"
          onClick={onGoUp}
          className="flex min-w-0 items-center gap-3 text-left font-semibold text-slate-700 hover:text-primary-700 dark:text-slate-200 dark:hover:text-primary-200"
        >
          <span
            className={`inline-flex ${iconBoxClasses} items-center justify-center rounded-md border border-slate-200 bg-white text-slate-500 shadow-sm dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200`}
          >
            <UpIcon className="h-3.5 w-3.5" />
          </span>
          <span className="truncate">Parent folder</span>
        </button>
      </td>
      {columns.map((column) => (
        <td
          key={column.id}
          className={`px-2 ${rowCellClasses} !align-middle ui-body text-slate-400 whitespace-nowrap overflow-hidden text-ellipsis ${
            column.align === "right" ? "text-right" : ""
          }`}
        >
          -
        </td>
      ))}
      <td
        className={`px-2 ${rowCellClasses} !align-middle text-right ui-caption text-slate-400`}
      />
    </tr>
  );
}
