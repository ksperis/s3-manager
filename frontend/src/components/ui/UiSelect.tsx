/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { SelectHTMLAttributes, forwardRef, ReactNode } from "react";
import UiField from "./UiField";
import { cx, uiInputClass } from "./styles";

type UiSelectSize = "compact" | "md";

const uiSelectSizeClasses: Record<UiSelectSize, string> = {
  compact: "px-2 py-1 ui-caption",
  md: "px-3 py-2 ui-body",
};

type UiSelectProps = Omit<SelectHTMLAttributes<HTMLSelectElement>, "size"> & {
  label?: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  fieldClassName?: string;
  size?: UiSelectSize;
};

const UiSelect = forwardRef<HTMLSelectElement, UiSelectProps>(function UiSelect(
  { label, hint, error, fieldClassName, className, id, size = "md", children, ...props },
  ref
) {
  return (
    <UiField label={label} hint={hint} error={error} htmlFor={id} className={fieldClassName}>
      {({ id: resolvedId, describedBy, invalid }) => (
        <select
          id={resolvedId}
          ref={ref}
          aria-describedby={describedBy}
          aria-invalid={invalid || undefined}
          className={cx(uiInputClass, uiSelectSizeClasses[size], className)}
          {...props}
        >
          {children}
        </select>
      )}
    </UiField>
  );
});

export default UiSelect;
