/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import type { ReactNode } from "react";

import ListToolbar, { type ListToolbarProps } from "../ListToolbar";
import { cx, uiCardClass } from "../ui/styles";

type ListPageSectionProps = Omit<
  ListToolbarProps,
  "className" | "showHeading"
> & {
  children: ReactNode;
  className?: string;
  toolbarClassName?: string;
  showHeading?: boolean;
};

/**
 * Standard inventory surface used by the main workspace list pages.
 * It keeps toolbar, filters, table, and pagination in one shared card layout.
 */
export default function ListPageSection({
  children,
  className,
  toolbarClassName,
  showHeading = false,
  ...toolbarProps
}: ListPageSectionProps) {
  return (
    <section className={cx(uiCardClass, className)}>
      <ListToolbar
        {...toolbarProps}
        className={toolbarClassName}
        showHeading={showHeading}
      />
      {children}
    </section>
  );
}
