/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import type { ReactNode } from "react";

import UiButton from "../../components/ui/UiButton";
import { cx, uiCardMutedClass, uiMutedTextClass, uiTitleTextClass } from "../../components/ui/styles";
import { toolbarCompactInputClasses } from "../../components/toolbarControlClasses";
import { tableActionButtonClasses } from "../../components/tableActionClasses";

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
  emptyLabel?: ReactNode;
  addLabel?: ReactNode;
  children: ReactNode;
};

type AdminAssociationPickerOptionProps = {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: ReactNode;
  detail?: ReactNode;
};

export function AdminAssociationPickerOption({
  checked,
  onChange,
  label,
  detail,
}: AdminAssociationPickerOptionProps) {
  return (
    <label
      className={cx(
        "flex cursor-pointer items-start gap-2 rounded-md border px-2 py-1 transition",
        checked
          ? "border-primary/30 bg-primary/10"
          : "border-transparent hover:bg-[var(--ui-hover)]"
      )}
    >
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="mt-1 h-3 w-3 rounded border-slate-300 text-primary focus:ring-primary"
      />
      <span className="min-w-0">
        <span className={cx("block truncate ui-body font-medium", uiTitleTextClass)}>{label}</span>
        {detail ? <span className={cx("block truncate ui-caption", uiMutedTextClass)}>{detail}</span> : null}
      </span>
    </label>
  );
}

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
  emptyLabel = "No results.",
  addLabel = "Add selected",
  children,
}: AdminAssociationPickerPanelProps) {
  return (
    <div className={cx(uiCardMutedClass, "space-y-2 px-3 py-2")}>
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
          className={cx(toolbarCompactInputClasses, "w-44")}
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
