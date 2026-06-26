/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { ReactNode, useId } from "react";
import { cx, uiLabelClass, uiMutedTextClass } from "./styles";

type UiFieldRenderProps = {
  id: string;
  describedBy?: string;
  invalid: boolean;
};

type UiFieldProps = {
  label?: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  htmlFor?: string;
  className?: string;
  labelClassName?: string;
  children: ReactNode | ((props: UiFieldRenderProps) => ReactNode);
};

export default function UiField({
  label,
  hint,
  error,
  htmlFor,
  className,
  labelClassName,
  children,
}: UiFieldProps) {
  const generatedId = useId();
  const id = htmlFor ?? generatedId;
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(" ") || undefined;
  const invalid = Boolean(error);

  return (
    <div className={cx("flex flex-col gap-1", className)}>
      {label ? (
        <label htmlFor={id} className={cx(uiLabelClass, labelClassName)}>
          {label}
        </label>
      ) : null}
      {typeof children === "function" ? children({ id, describedBy, invalid }) : children}
      {hint ? (
        <p id={hintId} className={cx("ui-caption", uiMutedTextClass)}>
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={errorId} className="ui-caption font-semibold text-rose-600 dark:text-rose-200">
          {error}
        </p>
      ) : null}
    </div>
  );
}
