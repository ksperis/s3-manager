/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { TextareaHTMLAttributes, forwardRef, ReactNode } from "react";
import UiField from "./UiField";
import { cx, uiInputClass } from "./styles";

type UiTextareaSize = "compact" | "md";

const uiTextareaSizeClasses: Record<UiTextareaSize, string> = {
  compact: "px-2 py-1.5 ui-caption",
  md: "px-3 py-2 ui-body",
};

type UiTextareaProps = TextareaHTMLAttributes<HTMLTextAreaElement> & {
  label?: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  fieldClassName?: string;
  size?: UiTextareaSize;
};

const UiTextarea = forwardRef<HTMLTextAreaElement, UiTextareaProps>(function UiTextarea(
  { label, hint, error, fieldClassName, className, id, size = "md", ...props },
  ref
) {
  return (
    <UiField label={label} hint={hint} error={error} htmlFor={id} className={fieldClassName}>
      {({ id: resolvedId, describedBy, invalid }) => (
        <textarea
          id={resolvedId}
          ref={ref}
          aria-describedby={describedBy}
          aria-invalid={invalid || undefined}
          className={cx(uiInputClass, uiTextareaSizeClasses[size], className)}
          {...props}
        />
      )}
    </UiField>
  );
});

export default UiTextarea;
