/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { ReactNode } from "react";

type HeaderProps = {
  title: string;
  subtitle?: string;
  context?: string;
  inlineAction?: ReactNode;
};

export default function Header({ title, subtitle, context, inlineAction }: HeaderProps) {
  return (
    <header className="mb-4 rounded-2xl border border-slate-200/80 bg-gradient-to-r from-slate-50 to-white px-6 py-5 shadow-sm dark:border-slate-800 dark:from-slate-900/60 dark:to-slate-900/20">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="space-y-1">
          {subtitle && <p className="text-sm font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">{subtitle}</p>}
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-semibold text-slate-900 dark:text-white">{title}</h1>
            {context && (
              <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700 dark:bg-slate-800 dark:text-slate-200">
                {context}
              </span>
            )}
          </div>
        </div>
        {inlineAction && <div className="flex items-center justify-end">{inlineAction}</div>}
      </div>
    </header>
  );
}
