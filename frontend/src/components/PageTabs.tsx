/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { ReactNode } from "react";

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
};

export default function PageTabs({ tabs, activeTab, onChange }: PageTabsProps) {
  return (
    <div className="rounded-2xl border border-slate-200/80 bg-white/80 shadow-sm dark:border-slate-800 dark:bg-slate-900/70">
      <div className="flex flex-wrap gap-2 border-b border-slate-200/80 px-4 py-2 dark:border-slate-800">
        {tabs.map((tab) => {
          const isActive = tab.id === activeTab;
          return (
            <button
              key={tab.id}
              disabled={tab.disabled}
              onClick={() => onChange(tab.id)}
              className={[
                "rounded-lg px-3 py-2 text-sm font-semibold transition",
                isActive
                  ? "bg-primary-100/70 text-primary-800 dark:bg-primary-900/25 dark:text-primary-100"
                  : "text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800",
                tab.disabled ? "opacity-50" : "",
              ].join(" ")}
            >
              {tab.label}
            </button>
          );
        })}
      </div>
      {tabs.find((t) => t.id === activeTab)?.content && (
        <div className="p-4">{tabs.find((t) => t.id === activeTab)?.content}</div>
      )}
    </div>
  );
}
