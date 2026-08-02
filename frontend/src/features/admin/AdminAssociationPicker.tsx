/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import type { ReactNode } from "react";

import UiButton from "../../components/ui/UiButton";
import {
  cx,
  uiCardMutedClass,
  uiDataTableClass,
  uiMutedTextClass,
  uiTableContainerClass,
  uiTitleTextClass,
} from "../../components/ui/styles";
import { toolbarCompactInputClasses } from "../../components/toolbarControlClasses";
import { tableActionButtonClasses } from "../../components/tableActionClasses";

const adminAssociationAddPanelClass = cx(uiCardMutedClass, "space-y-2 px-3 py-2");
const adminAssociationCompactInputClass = cx(toolbarCompactInputClasses, "w-44");
export const adminAssociationCheckboxClass = "h-3 w-3 rounded border-slate-300 text-primary focus:ring-primary";
export const adminAssociationTableContainerClass = uiTableContainerClass;
export const adminAssociationTableClass = cx(uiDataTableClass, "compact-table min-w-full");
export const adminAssociationTableHeadClass = "bg-slate-50 dark:bg-slate-900/50";
export const adminAssociationTableBodyClass = "divide-y divide-slate-200 dark:divide-slate-800";
export const adminAssociationTableHeaderClass =
  "px-3 py-2 text-left ui-caption font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400";
export const adminAssociationTableHeaderRightClass =
  "px-3 py-2 text-right ui-caption font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400";
export const adminAssociationTableEmptyCellClass = "px-3 py-3 ui-body text-slate-500 dark:text-slate-400";
export const adminAssociationTableLabelCellClass = "px-3 py-2 ui-body text-slate-700 dark:text-slate-200";
export const adminAssociationTableControlCellClass = "px-3 py-2";
export const adminAssociationTableActionCellClass = "px-3 py-2 text-right";
export const adminAssociationOptionLabelClass = "flex items-center gap-2 ui-body text-slate-700 dark:text-slate-200";
export const adminAssociationAccountOptionLabelClass =
  "flex min-w-48 items-center gap-2 ui-body text-slate-700 dark:text-slate-200";
export const adminAssociationOptionRowClass = (selected: boolean) =>
  `flex items-center justify-between rounded-md px-2 py-1 ${
    selected ? "bg-[var(--ui-selected-bg)]" : "hover:bg-[var(--ui-hover)]"
  }`;

export const adminAssociationAccountOptionRowClass = (selected: boolean) =>
  `flex flex-wrap items-center justify-between gap-2 rounded-md px-2 py-1 ${
    selected ? "bg-[var(--ui-selected-bg)]" : "hover:bg-[var(--ui-hover)]"
  }`;

type AdminAssociationSectionHeaderProps = {
  title: ReactNode;
  countLabel: ReactNode;
  actionLabel: ReactNode;
  onAction: () => void;
};

export function AdminAssociationSectionHeader({
  title,
  countLabel,
  actionLabel,
  onAction,
}: AdminAssociationSectionHeaderProps) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div className="flex items-center gap-2">
        <span className={cx("ui-body font-medium", uiTitleTextClass)}>{title}</span>
        <span className={cx("ui-caption", uiMutedTextClass)}>{countLabel}</span>
      </div>
      <button type="button" onClick={onAction} className={tableActionButtonClasses}>
        {actionLabel}
      </button>
    </div>
  );
}

type AdminAssociationLinkedTableProps = {
  title: ReactNode;
  countLabel: ReactNode;
  actionLabel: ReactNode;
  onAction: () => void;
  headers: Array<{ label: ReactNode; align?: "left" | "right" }>;
  hasItems: boolean;
  emptyLabel: ReactNode;
  rows: ReactNode;
  picker?: ReactNode;
};

export function AdminAssociationLinkedTable({
  title,
  countLabel,
  actionLabel,
  onAction,
  headers,
  hasItems,
  emptyLabel,
  rows,
  picker,
}: AdminAssociationLinkedTableProps) {
  return (
    <div className="space-y-3">
      <AdminAssociationSectionHeader
        title={title}
        countLabel={countLabel}
        actionLabel={actionLabel}
        onAction={onAction}
      />
      <div className={adminAssociationTableContainerClass}>
        <table className={adminAssociationTableClass}>
          <thead className={adminAssociationTableHeadClass}>
            <tr>
              {headers.map((header, index) => (
                <th
                  key={index}
                  className={
                    header.align === "right"
                      ? adminAssociationTableHeaderRightClass
                      : adminAssociationTableHeaderClass
                  }
                >
                  {header.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className={adminAssociationTableBodyClass}>
            {hasItems ? (
              rows
            ) : (
              <tr>
                <td colSpan={headers.length} className={adminAssociationTableEmptyCellClass}>
                  {emptyLabel}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {picker}
    </div>
  );
}

type AdminAssociationPickerPanelProps = {
  title: ReactNode;
  hint?: ReactNode;
  search: string;
  onSearchChange: (value: string) => void;
  loading: boolean;
  availableCount: number;
  maxVisibleOptions: number;
  selectedCount: number;
  onCancel: () => void;
  onAdd: () => void;
  addDisabled: boolean;
  loadingLabel: ReactNode;
  searchAriaLabel?: string;
  emptyLabel?: ReactNode;
  addLabel?: ReactNode;
  children: ReactNode;
};

export function AdminAssociationPickerPanel({
  title,
  hint,
  search,
  onSearchChange,
  loading,
  availableCount,
  maxVisibleOptions,
  selectedCount,
  onCancel,
  onAdd,
  addDisabled,
  loadingLabel,
  searchAriaLabel,
  emptyLabel = "No results.",
  addLabel = "Add selected",
  children,
}: AdminAssociationPickerPanelProps) {
  return (
    <div className={adminAssociationAddPanelClass}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className={cx("ui-body font-medium", uiTitleTextClass)}>{title}</span>
          {hint ? <span className={cx("ui-caption", uiMutedTextClass)}>{hint}</span> : null}
        </div>
        <input
          type="text"
          value={search}
          onChange={(event) => onSearchChange(event.target.value)}
          placeholder="Search..."
          aria-label={searchAriaLabel}
          className={adminAssociationCompactInputClass}
        />
      </div>
      <div className="max-h-48 space-y-1 overflow-y-auto pr-1">
        {loading ? <p className={cx("ui-caption", uiMutedTextClass)}>{loadingLabel}</p> : null}
        {!loading && availableCount === 0 ? <p className={cx("ui-caption", uiMutedTextClass)}>{emptyLabel}</p> : null}
        {children}
        {availableCount > maxVisibleOptions ? (
          <p className={cx("ui-caption", uiMutedTextClass)}>
            Showing first {maxVisibleOptions} matches. Use the search box to narrow down the list.
          </p>
        ) : null}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className={cx("ui-caption", uiMutedTextClass)}>{selectedCount} selected</span>
        <div className="flex items-center gap-2">
          <UiButton variant="secondary" size="xs" onClick={onCancel}>
            Cancel
          </UiButton>
          <UiButton size="xs" disabled={addDisabled} onClick={onAdd}>
            {addLabel}
          </UiButton>
        </div>
      </div>
    </div>
  );
}

type AdminAssociationSelectionPanelProps = {
  title: ReactNode;
  countLabel: ReactNode;
  search: string;
  onSearchChange: (value: string) => void;
  loading?: boolean;
  loadingLabel?: ReactNode;
  availableCount: number;
  emptyLabel?: ReactNode;
  searchAriaLabel?: string;
  children: ReactNode;
};

export function AdminAssociationSelectionPanel({
  title,
  countLabel,
  search,
  onSearchChange,
  loading = false,
  loadingLabel = "Loading...",
  availableCount,
  emptyLabel = "No results.",
  searchAriaLabel,
  children,
}: AdminAssociationSelectionPanelProps) {
  return (
    <div className={adminAssociationAddPanelClass}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className={cx("ui-body font-medium", uiTitleTextClass)}>{title}</span>
          <span className={cx("ui-caption", uiMutedTextClass)}>{countLabel}</span>
        </div>
        <input
          type="text"
          value={search}
          onChange={(event) => onSearchChange(event.target.value)}
          placeholder="Search..."
          aria-label={searchAriaLabel}
          className={adminAssociationCompactInputClass}
        />
      </div>
      <div className="max-h-56 space-y-1 overflow-y-auto pr-1">
        {loading ? <p className={cx("ui-caption", uiMutedTextClass)}>{loadingLabel}</p> : null}
        {!loading && availableCount === 0 ? <p className={cx("ui-caption", uiMutedTextClass)}>{emptyLabel}</p> : null}
        {!loading ? children : null}
      </div>
    </div>
  );
}
