/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import type { ComponentProps } from "react";

import PageTabs from "../../components/PageTabs";
import { cx, uiDividerClass } from "../../components/ui/styles";

type PortalPageTabsProps = Omit<ComponentProps<typeof PageTabs>, "variant"> & {
  className?: string;
};

/** Top-level Portal navigation with one consistent baseline and spacing. */
export default function PortalPageTabs({ className, ...props }: PortalPageTabsProps) {
  return (
    <div className={cx("border-b pb-3", uiDividerClass, className)}>
      <PageTabs {...props} variant="bar" />
    </div>
  );
}
