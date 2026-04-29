/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useEffect, useMemo, useState } from "react";
import UiCheckboxField from "./ui/UiCheckboxField";

export type ColumnPickerOption<Id extends string> = {
  id: Id;
  label: string;
  checked: boolean;
  disabled?: boolean;
  onToggle: () => void;
};

export type ColumnPickerGroup<Id extends string> = {
  id: string;
  label: string;
  options: Array<ColumnPickerOption<Id>>;
  helperText?: string;
};

export type ColumnPickerExpandableGroup<Id extends string> = {
  id: string;
  label: string;
  checked: boolean;
  disabled?: boolean;
  onToggle: () => void;
  details?: Array<ColumnPickerOption<Id>>;
  defaultExpanded?: boolean;
};

export type ColumnPickerDetailGroup<Id extends string> = {
  id: string;
  label: string;
  details: Array<ColumnPickerOption<Id>>;
  defaultExpanded?: boolean;
};

export type ColumnVisibilityPickerProps<Id extends string> = {
  title?: string;
  selectedCount: number;
  onReset: () => void;
  coreGroups: Array<ColumnPickerGroup<Id>>;
  detailGroups?: Array<ColumnPickerDetailGroup<Id>>;
  featureGroups?: Array<ColumnPickerExpandableGroup<Id>>;
  footerNote?: string;
};

const EMPTY_FEATURE_GROUPS: Array<ColumnPickerExpandableGroup<string>> = [];
const EMPTY_DETAIL_GROUPS: Array<ColumnPickerDetailGroup<string>> = [];

const detailsButtonClass =
  "rounded-md border border-slate-200 px-2 py-0.5 ui-caption font-semibold text-slate-600 hover:border-primary hover:text-primary disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-700 dark:text-slate-300 dark:hover:border-primary-500 dark:hover:text-primary-100";

function buildInitialExpandedState(groups: Array<{ id: string; defaultExpanded?: boolean }>) {
  return groups.reduce<Record<string, boolean>>((acc, group) => {
    acc[group.id] = group.defaultExpanded === true;
    return acc;
  }, {});
}

export default function ColumnVisibilityPicker<Id extends string>({
  title = "Visible columns",
  selectedCount,
  onReset,
  coreGroups,
  detailGroups: detailGroupsProp,
  featureGroups: featureGroupsProp,
  footerNote,
}: ColumnVisibilityPickerProps<Id>) {
  const detailGroups = (detailGroupsProp ?? EMPTY_DETAIL_GROUPS) as Array<ColumnPickerDetailGroup<Id>>;
  const featureGroups = (featureGroupsProp ?? EMPTY_FEATURE_GROUPS) as Array<ColumnPickerExpandableGroup<Id>>;
  const allExpandableGroups = useMemo(() => [...detailGroups, ...featureGroups], [detailGroups, featureGroups]);
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>(() => buildInitialExpandedState(allExpandableGroups));

  useEffect(() => {
    setExpandedGroups((prev) => {
      const next = buildInitialExpandedState(allExpandableGroups);
      allExpandableGroups.forEach((group) => {
        if (group.id in prev) {
          next[group.id] = prev[group.id];
        }
      });
      const prevKeys = Object.keys(prev);
      const nextKeys = Object.keys(next);
      if (prevKeys.length === nextKeys.length && nextKeys.every((key) => prev[key] === next[key])) {
        return prev;
      }
      return next;
    });
  }, [allExpandableGroups]);

  const toggleGroup = (groupId: string) => {
    setExpandedGroups((prev) => ({ ...prev, [groupId]: !prev[groupId] }));
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="ui-body font-semibold text-slate-900 dark:text-slate-100">{title}</p>
          <p className="ui-caption text-slate-500 dark:text-slate-400">{selectedCount} selected</p>
        </div>
        <button
          type="button"
          onClick={onReset}
          className="shrink-0 rounded-md border border-slate-200 px-2 py-1 ui-caption font-semibold text-slate-700 hover:border-primary hover:text-primary dark:border-slate-700 dark:text-slate-100 dark:hover:border-primary-500 dark:hover:text-primary-100"
        >
          Reset
        </button>
      </div>

      <div className="max-h-[min(70vh,32rem)] space-y-3 overflow-y-auto pr-1">
        {coreGroups.map((group) => (
          <section key={group.id} className="rounded-lg border border-slate-200/90 bg-slate-50/50 p-2.5 dark:border-slate-700 dark:bg-slate-800/40">
            <p className="mb-2 ui-caption font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">{group.label}</p>
            <div className="grid gap-2 sm:grid-cols-2">
              {group.options.map((option) => (
                <UiCheckboxField
                  key={option.id}
                  checked={option.checked}
                  onChange={option.onToggle}
                  disabled={option.disabled}
                  className="w-full rounded-md px-1 py-1 ui-body text-slate-700 hover:bg-white/80 dark:text-slate-200 dark:hover:bg-slate-700/40"
                >
                  <span className="min-w-0 truncate">{option.label}</span>
                </UiCheckboxField>
              ))}
            </div>
            {group.helperText ? <p className="mt-2 ui-caption text-slate-500 dark:text-slate-400">{group.helperText}</p> : null}
          </section>
        ))}

        {detailGroups.length > 0 ? (
          <section className="rounded-lg border border-slate-200/90 bg-slate-50/50 p-2.5 dark:border-slate-700 dark:bg-slate-800/40">
            <p className="mb-2 ui-caption font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Details</p>
            <div className="space-y-1.5">
              {detailGroups.map((group) => {
                const expanded = expandedGroups[group.id] === true;
                return (
                  <div key={group.id} className="rounded-md border border-slate-200 bg-white/90 p-2 dark:border-slate-700 dark:bg-slate-900/40">
                    <div className="flex items-center gap-2">
                      <span className="min-w-0 flex-1 truncate ui-body text-slate-700 dark:text-slate-200">{group.label}</span>
                      <button
                        type="button"
                        onClick={() => toggleGroup(group.id)}
                        aria-expanded={expanded}
                        className={detailsButtonClass}
                      >
                        {expanded ? "Details ▾" : "Details ▸"}
                      </button>
                    </div>
                    {expanded ? (
                      <div className="mt-2 space-y-1 border-t border-slate-200 pt-2 dark:border-slate-700">
                        {group.details.map((detail) => (
                          <UiCheckboxField
                            key={detail.id}
                            checked={detail.checked}
                            onChange={detail.onToggle}
                            disabled={detail.disabled}
                            className="w-full rounded-md px-1 py-1 ui-caption text-slate-600 hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-slate-800/70"
                          >
                            <span className="min-w-0 truncate">{detail.label}</span>
                          </UiCheckboxField>
                        ))}
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </section>
        ) : null}

        {featureGroups.length > 0 ? (
          <section className="rounded-lg border border-slate-200/90 bg-slate-50/50 p-2.5 dark:border-slate-700 dark:bg-slate-800/40">
            <p className="mb-2 ui-caption font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Features</p>
            <div className="space-y-1.5">
              {featureGroups.map((group) => {
                const expanded = expandedGroups[group.id] === true;
                const details = group.details ?? [];
                return (
                  <div key={group.id} className="rounded-md border border-slate-200 bg-white/90 p-2 dark:border-slate-700 dark:bg-slate-900/40">
                    <div className="flex items-center gap-2">
                      <UiCheckboxField
                        checked={group.checked}
                        onChange={group.onToggle}
                        disabled={group.disabled}
                        className="min-w-0 flex-1 ui-body text-slate-700 dark:text-slate-200"
                      >
                        <span className="min-w-0 truncate">{group.label}</span>
                      </UiCheckboxField>
                      {details.length > 0 ? (
                        <button
                          type="button"
                          onClick={() => toggleGroup(group.id)}
                          aria-expanded={expanded}
                          className={detailsButtonClass}
                        >
                          {expanded ? "Details ▾" : "Details ▸"}
                        </button>
                      ) : null}
                    </div>
                    {details.length > 0 && expanded ? (
                      <div className="mt-2 space-y-1 border-t border-slate-200 pt-2 dark:border-slate-700">
                        {details.map((detail) => (
                          <UiCheckboxField
                            key={detail.id}
                            checked={detail.checked}
                            onChange={detail.onToggle}
                            disabled={detail.disabled}
                            className="w-full rounded-md px-1 py-1 ui-caption text-slate-600 hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-slate-800/70"
                          >
                            <span className="min-w-0 truncate">{detail.label}</span>
                          </UiCheckboxField>
                        ))}
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
            {footerNote ? <p className="mt-2 ui-caption text-slate-500 dark:text-slate-400">{footerNote}</p> : null}
          </section>
        ) : null}
      </div>
    </div>
  );
}
