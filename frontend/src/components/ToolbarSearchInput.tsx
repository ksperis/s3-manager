/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import type { ReactNode } from "react";
import UiField from "./ui/UiField";
import { cx, uiInputClass } from "./ui/styles";

type ToolbarSearchInputProps = {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  label?: ReactNode;
  className?: string;
  inputClassName?: string;
  inputWrapperClassName?: string;
  trailingControl?: ReactNode;
};

export default function ToolbarSearchInput({
  value,
  onChange,
  placeholder,
  label = "Search",
  className = "w-full sm:w-72",
  inputClassName,
  inputWrapperClassName,
  trailingControl,
}: ToolbarSearchInputProps) {
  const renderInput = ({ id, describedBy, invalid }: { id: string; describedBy?: string; invalid: boolean }) => (
    <input
      id={id}
      aria-describedby={describedBy}
      aria-invalid={invalid || undefined}
      type="search"
      value={value}
      onChange={(event) => onChange(event.target.value)}
      placeholder={placeholder}
      className={cx(uiInputClass, "px-2 py-1 ui-caption", inputClassName)}
    />
  );

  return (
    <UiField label={label} className={className}>
      {(fieldProps) =>
        trailingControl ? (
          <div className={cx("relative", inputWrapperClassName)}>
            {renderInput(fieldProps)}
            {trailingControl}
          </div>
        ) : (
          renderInput(fieldProps)
        )
      }
    </UiField>
  );
}
