/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import type { ComponentProps } from "react";

import PageTabs, { PageTabPanel } from "../../components/PageTabs";

type PortalPageTabsProps = Omit<ComponentProps<typeof PageTabs>, "variant"> & {
  className?: string;
};

export function PortalTabPanel({
  className = "space-y-4",
  ...props
}: ComponentProps<typeof PageTabPanel>) {
  return <PageTabPanel {...props} className={className} />;
}

/** Top-level Portal navigation with one consistent baseline and spacing. */
export default function PortalPageTabs({ className, ...props }: PortalPageTabsProps) {
  if (className) {
    return (
      <div className={className}>
        <PageTabs {...props} variant="line" />
      </div>
    );
  }
  return <PageTabs {...props} variant="line" />;
}
