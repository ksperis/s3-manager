/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
type UiEmptyStateProps = {
  title: string;
  description: string;
  className?: string;
};

export default function UiEmptyState({ title, description, className }: UiEmptyStateProps) {
  return (
    <div
      className={`rounded-xl border border-dashed border-slate-300 bg-white/90 px-4 py-8 text-center shadow-sm dark:border-slate-700 dark:bg-slate-900/60 ${
        className ?? ""
      }`}
    >
      <p className="ui-section font-semibold text-slate-700 dark:text-slate-100">{title}</p>
      <p className="mt-1 ui-body text-slate-500 dark:text-slate-400">{description}</p>
    </div>
  );
}

