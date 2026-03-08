/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
type BucketFeatureModeOption<T extends string> = {
  value: T;
  label: string;
};

type BucketFeatureModeToggleProps<T extends string> = {
  value: T;
  options: Array<BucketFeatureModeOption<T>>;
  onChange: (value: T) => void;
  disabled?: boolean;
};

export default function BucketFeatureModeToggle<T extends string>({
  value,
  options,
  onChange,
  disabled = false,
}: BucketFeatureModeToggleProps<T>) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          onClick={() => onChange(option.value)}
          className={`rounded-md px-3 py-1 ui-caption font-semibold transition ${
            value === option.value
              ? "bg-primary text-white"
              : "border border-slate-200 text-slate-700 hover:border-slate-300 dark:border-slate-700 dark:text-slate-200"
          }`}
          disabled={disabled}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
