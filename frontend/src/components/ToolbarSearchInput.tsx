/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import type { ReactNode } from "react";
import UiField from "./ui/UiField";
import { cx, uiInputClass } from "./ui/styles";

type ToolbarSearchMatchMode = "contains" | "exact";

type ToolbarSearchInputProps = {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  label?: ReactNode;
  className?: string;
  active?: boolean;
  inputClassName?: string;
  inputWrapperClassName?: string;
  matchMode?: ToolbarSearchMatchMode;
  onToggleMatchMode?: () => void;
  trailingControl?: ReactNode;
};

export default function ToolbarSearchInput({
  value,
  onChange,
  placeholder,
  label = "Search",
  className = "w-full sm:w-72",
  active = false,
  inputClassName,
  inputWrapperClassName,
  matchMode,
  onToggleMatchMode,
  trailingControl,
}: ToolbarSearchInputProps) {
  const matchModeControl =
    matchMode && onToggleMatchMode ? (
      <button
        type="button"
        onClick={onToggleMatchMode}
        className="absolute right-1 top-1/2 -translate-y-1/2 rounded border border-slate-200 bg-white px-1 py-0 ui-caption font-semibold text-slate-500 hover:border-primary hover:text-primary dark:border-slate-600 dark:bg-slate-900 dark:text-slate-300 dark:hover:border-primary-500 dark:hover:text-primary-100"
        title={`Filter mode: ${matchMode === "contains" ? "contains" : "exact"}`}
        aria-label="Toggle filter match mode"
      >
        {matchMode === "contains" ? "~" : "="}
      </button>
    ) : null;
  const resolvedTrailingControl = trailingControl ?? matchModeControl;
  const renderInput = ({ id, describedBy, invalid }: { id: string; describedBy?: string; invalid: boolean }) => (
    <input
      id={id}
      aria-describedby={describedBy}
      aria-invalid={invalid || undefined}
      type="search"
      value={value}
      onChange={(event) => onChange(event.target.value)}
      placeholder={placeholder}
      className={cx(
        uiInputClass,
        "px-2 py-1 ui-caption",
        resolvedTrailingControl ? "pr-9" : "",
        active ? "border-primary/50 bg-primary/5 dark:bg-primary/10" : "",
        inputClassName
      )}
    />
  );

  return (
    <UiField label={label} className={className}>
      {(fieldProps) =>
        resolvedTrailingControl ? (
          <div className={cx("relative", inputWrapperClassName)}>
            {renderInput(fieldProps)}
            {resolvedTrailingControl}
          </div>
        ) : (
          renderInput(fieldProps)
        )
      }
    </UiField>
  );
}
