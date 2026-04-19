/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { calculateActionProgressPercent, type ActionProgressState } from "./actionProgress";

type ActionProgressCardProps = {
  progress: ActionProgressState;
  busy?: boolean;
  className?: string;
};

function SpinnerIcon({ className = "h-3.5 w-3.5" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      className={`${className} animate-spin`}
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="9" className="opacity-30" stroke="currentColor" strokeWidth="2.5" />
      <path d="M12 3a9 9 0 0 1 9 9" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
    </svg>
  );
}

export default function ActionProgressCard({ progress, busy = false, className = "" }: ActionProgressCardProps) {
  const percent = calculateActionProgressPercent(progress);

  return (
    <div
      className={`space-y-2 rounded-lg border border-slate-200 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-900/40 ${className}`.trim()}
    >
      <div className="flex flex-wrap items-center justify-between gap-2 ui-caption text-slate-600 dark:text-slate-300">
        <span className="inline-flex items-center gap-2">
          {busy && <SpinnerIcon />}
          <span>
            {progress.label} · {progress.completed} / {progress.total}
          </span>
        </span>
        <span>{percent}%</span>
      </div>
      <div className="relative h-2.5 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800">
        <div
          className="h-full bg-primary-500 transition-[width] duration-200"
          style={{ width: `${percent}%` }}
        />
      </div>
      {progress.failed > 0 && (
        <p className="ui-caption font-semibold text-rose-600 dark:text-rose-200">
          Failures so far: {progress.failed}
        </p>
      )}
    </div>
  );
}
