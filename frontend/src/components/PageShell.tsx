/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import type { ReactNode } from "react";

import PageHeader, { type PageHeaderProps } from "./PageHeader";
import { cx } from "./ui/styles";

type PageShellProps = PageHeaderProps & {
  children?: ReactNode;
  className?: string;
};

/**
 * Shared top-level page shell. It keeps the page header and body on the same
 * vertical rhythm while leaving content framing to the page-specific
 * components below it.
 */
export default function PageShell({
  children,
  className,
  ...headerProps
}: PageShellProps) {
  return (
    <div className={cx("space-y-4", className)}>
      <PageHeader {...headerProps} />
      {children}
    </div>
  );
}
