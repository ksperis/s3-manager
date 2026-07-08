/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import type { ReactNode } from "react";
import UiInput from "./ui/UiInput";

type ToolbarSearchInputProps = {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  label?: ReactNode;
  className?: string;
};

export default function ToolbarSearchInput({
  value,
  onChange,
  placeholder,
  label = "Search",
  className = "w-full sm:w-72",
}: ToolbarSearchInputProps) {
  return (
    <UiInput
      label={label}
      type="search"
      value={value}
      onChange={(event) => onChange(event.target.value)}
      placeholder={placeholder}
      fieldClassName={className}
      size="compact"
    />
  );
}
