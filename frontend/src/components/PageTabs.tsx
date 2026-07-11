/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { ReactNode } from "react";
import { cx, uiCardClass, uiDividerClass } from "./ui/styles";

type Tab = {
  id: string;
  label: string;
  content?: ReactNode;
  disabled?: boolean;
};

type PageTabsProps = {
  tabs: Tab[];
  activeTab: string;
  onChange: (id: string) => void;
  headerActions?: ReactNode;
  variant?: "card" | "bar";
  ariaLabel?: string;
};

export default function PageTabs({ tabs, activeTab, onChange, headerActions, variant = "card", ariaLabel }: PageTabsProps) {
  const tabList = (
    <div className="flex flex-wrap gap-2" role={ariaLabel ? "tablist" : undefined} aria-label={ariaLabel}>
      {tabs.map((tab) => {
        const isActive = tab.id === activeTab;
        return (
          <button
            key={tab.id}
            type="button"
            role={ariaLabel ? "tab" : undefined}
            aria-selected={ariaLabel ? isActive : undefined}
            disabled={tab.disabled}
            onClick={() => onChange(tab.id)}
            className={[
              "rounded-md px-2.5 py-1.5 ui-caption font-semibold transition",
              isActive
                ? "bg-[var(--ui-selected-bg)] text-primary dark:text-[var(--ui-text)]"
                : "text-[var(--ui-text-muted)] hover:bg-[var(--ui-hover)] hover:text-[var(--ui-text)]",
              tab.disabled ? "opacity-50" : "",
            ].join(" ")}
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );

  if (variant === "bar") {
    return (
      <div className="flex flex-wrap items-center justify-between gap-2">
        {tabList}
        {headerActions ? <div className="flex items-center gap-2">{headerActions}</div> : null}
      </div>
    );
  }

  return (
    <div className={cx("overflow-hidden", uiCardClass)}>
      <div className={cx("flex flex-wrap items-center justify-between gap-2 border-b px-3 py-2", uiDividerClass)}>
        {tabList}
        {headerActions ? <div className="flex items-center gap-2">{headerActions}</div> : null}
      </div>
      {tabs.find((t) => t.id === activeTab)?.content && (
        <div className="p-3">{tabs.find((t) => t.id === activeTab)?.content}</div>
      )}
    </div>
  );
}
