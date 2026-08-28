/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useEffect, useMemo, useRef, useState } from "react";
import ColumnVisibilityPicker from "../../components/ColumnVisibilityPicker";
import { toolbarCompactButtonClasses } from "../../components/toolbarControlClasses";
import { cx, uiMenuClass } from "../../components/ui/styles";
import type { FeatureKey } from "./bucketOpsAdvancedFilterModel";
import {
  BUCKET_CORE_COLUMN_OPTIONS,
  BUCKET_QUOTA_COLUMN_GROUPS,
  FEATURE_DETAIL_COLUMN_OPTIONS,
  type ColumnId,
  type FeatureDetailColumnOption,
} from "./bucketOpsListState";

type FeatureColumnOption = {
  id: FeatureKey;
  label: string;
};

type BucketOpsColumnControlsProps = {
  defaultVisibleColumns: ColumnId[];
  featureColumnOptions: FeatureColumnOption[];
  isStorageOps: boolean;
  onReset: () => void;
  onToggle: (id: ColumnId) => void;
  visibleColumns: ColumnId[];
};

export default function BucketOpsColumnControls({
  defaultVisibleColumns,
  featureColumnOptions,
  isStorageOps,
  onReset,
  onToggle,
  visibleColumns,
}: BucketOpsColumnControlsProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const handleMouseDown = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (target && rootRef.current && !rootRef.current.contains(target)) {
        setOpen(false);
      }
    };
    window.addEventListener("mousedown", handleMouseDown);
    return () => window.removeEventListener("mousedown", handleMouseDown);
  }, [open]);

  const columnsCustomized = useMemo(() => {
    if (visibleColumns.length !== defaultVisibleColumns.length) return true;
    const visible = new Set(visibleColumns);
    return defaultVisibleColumns.some((column) => !visible.has(column));
  }, [defaultVisibleColumns, visibleColumns]);

  const featureDetailColumnsByFeature = useMemo(() => {
    const supported = new Set(featureColumnOptions.map((option) => option.id));
    const groups: Partial<Record<FeatureKey, FeatureDetailColumnOption[]>> = {};
    FEATURE_DETAIL_COLUMN_OPTIONS.forEach((option) => {
      if (!supported.has(option.feature)) return;
      const current = groups[option.feature] ?? [];
      groups[option.feature] = [...current, option];
    });
    return groups;
  }, [featureColumnOptions]);

  return (
    <>
      <div className="relative" ref={rootRef}>
        <button
          type="button"
          onClick={() => setOpen((current) => !current)}
          aria-expanded={open}
          className={toolbarCompactButtonClasses}
        >
          Columns
        </button>
        {open && (
          <div
            className={cx(
              uiMenuClass,
              "absolute right-0 z-30 mt-2 w-96 max-w-[calc(100vw-2rem)] p-3",
            )}
          >
            <ColumnVisibilityPicker
              selectedCount={visibleColumns.length}
              onReset={onReset}
              coreGroups={[
                {
                  id: "core",
                  label: "Core",
                  options: BUCKET_CORE_COLUMN_OPTIONS.filter((option) =>
                    isStorageOps
                      ? true
                      : option.id !== "context_name" &&
                        option.id !== "context_kind" &&
                        option.id !== "endpoint_name",
                  ).map((option) => ({
                    id: option.id,
                    label: option.label,
                    checked: visibleColumns.includes(option.id),
                    onToggle: () => onToggle(option.id),
                  })),
                },
              ]}
              detailGroups={BUCKET_QUOTA_COLUMN_GROUPS.map((group) => ({
                id: group.id,
                label: group.label,
                details: group.options.map((option) => ({
                  id: option.id,
                  label: option.label,
                  checked: visibleColumns.includes(option.id),
                  onToggle: () => onToggle(option.id),
                })),
              }))}
              featureGroups={featureColumnOptions.map((option) => ({
                id: option.id,
                label: option.label,
                checked: visibleColumns.includes(option.id),
                onToggle: () => onToggle(option.id),
                details: (featureDetailColumnsByFeature[option.id] ?? []).map(
                  (detail) => ({
                    id: detail.id,
                    label: detail.label,
                    checked: visibleColumns.includes(detail.id),
                    onToggle: () => onToggle(detail.id),
                  }),
                ),
              }))}
              footerNote="Feature checks and detail values are loaded only for enabled columns."
            />
          </div>
        )}
      </div>
      <button
        type="button"
        onClick={onReset}
        disabled={!columnsCustomized}
        className={`rounded-md border px-2.5 py-1.5 ui-caption font-semibold ${
          columnsCustomized
            ? "border-rose-200 bg-rose-50 text-rose-700 hover:border-rose-300 dark:border-rose-500/40 dark:bg-rose-500/10 dark:text-rose-100"
            : "cursor-not-allowed border-slate-200 text-slate-400 dark:border-slate-700 dark:text-slate-500"
        }`}
      >
        Reset Columns
      </button>
    </>
  );
}
