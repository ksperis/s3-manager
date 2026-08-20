/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import type { ReactNode } from "react";
import {
  contextMenuItemClasses,
  contextMenuItemDisabledClasses,
} from "./browserConstants";

type BrowserToolbarToggleMenuItemProps = {
  label: string;
  icon: ReactNode;
  checked: boolean;
  onToggle: () => void;
  disabled?: boolean;
};

export default function BrowserToolbarToggleMenuItem({
  label,
  icon,
  checked,
  onToggle,
  disabled = false,
}: BrowserToolbarToggleMenuItemProps) {
  return (
    <button
      type="button"
      role="menuitemcheckbox"
      aria-checked={checked}
      className={`${contextMenuItemClasses} ${disabled ? contextMenuItemDisabledClasses : ""}`}
      onClick={onToggle}
      disabled={disabled}
    >
      <span className="inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center">
        {icon}
      </span>
      <span className="min-w-0 flex-1">{label}</span>
      <span
        aria-hidden="true"
        className={`relative ml-auto inline-flex h-5 w-9 shrink-0 rounded-full transition ${
          checked ? "bg-emerald-500" : "bg-slate-200 dark:bg-slate-700"
        }`}
      >
        <span
          className={`absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white shadow transition ${
            checked ? "translate-x-4" : ""
          }`}
        />
      </span>
    </button>
  );
}
