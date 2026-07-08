/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import ToolbarSearchInput from "../../components/ToolbarSearchInput";

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
    <ToolbarSearchInput
      value={value}
      onChange={onChange}
      placeholder={placeholder}
      className={className}
    />
  );
}
