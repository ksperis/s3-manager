/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import type { PageBreadcrumb } from "../../components/PageHeader";

const PORTAL_BREADCRUMB: PageBreadcrumb = { label: "Portal" };

export function portalBreadcrumbs(...breadcrumbs: PageBreadcrumb[]): PageBreadcrumb[] {
  return [PORTAL_BREADCRUMB, ...breadcrumbs];
}
