/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { cx, uiCardMutedClass } from "./styles";

type UiSegmentedControlOption<T extends string> = {
  label: string;
  value: T;
  helper?: string;
  title?: string;
  disabled?: boolean;
};

type UiSegmentedControlProps<T extends string> = {
  options: UiSegmentedControlOption<T>[];
  value: T;
  onChange: (value: T) => void;
  ariaLabel?: string;
  className?: string;
};

export default function UiSegmentedControl<T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
  className,
}: UiSegmentedControlProps<T>) {
  return (
    <div
      className={cx(uiCardMutedClass, "inline-flex flex-wrap items-center gap-2 rounded-full px-2 py-1", className)}
      role="group"
      aria-label={ariaLabel}
    >
      {options.map((option) => {
        const isActive = option.value === value;

        return (
          <button
            key={option.value}
            type="button"
            className={cx(
              "rounded-full px-3 py-1 ui-caption font-semibold transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary",
              isActive
                ? "bg-primary text-white shadow-sm"
                : "text-[var(--ui-text-muted)] hover:bg-[var(--ui-hover)] hover:text-[var(--ui-text)]",
              option.disabled ? "cursor-not-allowed opacity-60" : null,
            )}
            disabled={option.disabled}
            aria-pressed={isActive}
            title={option.title ?? option.helper}
            onClick={() => onChange(option.value)}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
