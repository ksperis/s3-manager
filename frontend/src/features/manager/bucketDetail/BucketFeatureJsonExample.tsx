/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { ReactNode } from "react";

type BucketFeatureJsonExampleProps = {
  show: boolean;
  onToggle: () => void;
  example: string;
  onUseExample?: () => void;
  helperText?: ReactNode;
  disabled?: boolean;
};

export default function BucketFeatureJsonExample({
  show,
  onToggle,
  example,
  onUseExample,
  helperText,
  disabled = false,
}: BucketFeatureJsonExampleProps) {
  return (
    <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 ui-caption text-slate-600 dark:border-slate-800 dark:bg-slate-900/50 dark:text-slate-300">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={onToggle}
          disabled={disabled}
          className="ui-caption font-semibold text-primary hover:text-primary-700 disabled:cursor-not-allowed disabled:opacity-60 dark:text-primary-200 dark:hover:text-primary-100"
        >
          {show ? "Hide example" : "Show example"}
        </button>
        {onUseExample && (
          <button
            type="button"
            onClick={onUseExample}
            disabled={disabled}
            className="rounded-full border border-slate-200 px-2 py-0.5 ui-caption font-semibold text-slate-700 hover:border-primary hover:text-primary disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-700 dark:text-slate-100"
          >
            Use example
          </button>
        )}
        {helperText}
      </div>
      {show && <pre className="mt-2 whitespace-pre-wrap rounded bg-slate-900 px-3 py-2 ui-caption text-slate-100">{example}</pre>}
    </div>
  );
}
