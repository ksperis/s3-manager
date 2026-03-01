/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { InputHTMLAttributes, LabelHTMLAttributes, ReactNode } from "react";
import { cx, uiCheckboxClass } from "./styles";

type UiCheckboxFieldProps = Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "className"> & {
  children?: ReactNode;
  className?: string;
  checkboxClassName?: string;
  inputPosition?: "start" | "end";
  labelProps?: Omit<LabelHTMLAttributes<HTMLLabelElement>, "className" | "children">;
};

export default function UiCheckboxField({
  children,
  className,
  checkboxClassName,
  inputPosition = "start",
  labelProps,
  ...inputProps
}: UiCheckboxFieldProps) {
  const checkbox = (
    <input
      type="checkbox"
      className={cx(uiCheckboxClass, checkboxClassName)}
      {...inputProps}
    />
  );

  return (
    <label className={cx("inline-flex items-center gap-2", className)} {...labelProps}>
      {inputPosition === "end" ? (
        <>
          {children}
          {checkbox}
        </>
      ) : (
        <>
          {checkbox}
          {children}
        </>
      )}
    </label>
  );
}
