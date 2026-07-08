/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import UiInput from "../../components/ui/UiInput";

type ManagerToolbarSearchProps = {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  className?: string;
};

export default function ManagerToolbarSearch({
  value,
  onChange,
  placeholder,
  className = "w-full sm:w-72",
}: ManagerToolbarSearchProps) {
  return (
    <UiInput
      label="Search"
      type="search"
      value={value}
      onChange={(event) => onChange(event.target.value)}
      placeholder={placeholder}
      fieldClassName={className}
      size="compact"
    />
  );
}
