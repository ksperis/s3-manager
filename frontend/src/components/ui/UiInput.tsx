/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { InputHTMLAttributes, forwardRef, ReactNode } from "react";
import UiField from "./UiField";
import { cx, uiInputClass } from "./styles";

type UiInputSize = "compact" | "md";

const uiInputSizeClasses: Record<UiInputSize, string> = {
  compact: "px-2 py-1 ui-caption",
  md: "px-3 py-2 ui-body",
};

type UiInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, "size"> & {
  label?: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  fieldClassName?: string;
  size?: UiInputSize;
};

const UiInput = forwardRef<HTMLInputElement, UiInputProps>(function UiInput(
  { label, hint, error, fieldClassName, className, id, size = "md", ...props },
  ref
) {
  return (
    <UiField label={label} hint={hint} error={error} htmlFor={id} className={fieldClassName}>
      {({ id: resolvedId, describedBy, invalid }) => (
        <input
          id={resolvedId}
          ref={ref}
          aria-describedby={describedBy}
          aria-invalid={invalid || undefined}
          className={cx(uiInputClass, uiInputSizeClasses[size], className)}
          {...props}
        />
      )}
    </UiField>
  );
});

export default UiInput;
