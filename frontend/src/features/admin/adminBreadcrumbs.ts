/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import type { PageBreadcrumb } from "../../components/PageHeader";

const ADMIN_BREADCRUMB: PageBreadcrumb = { label: "Admin" };

export function adminBreadcrumbs(...breadcrumbs: PageBreadcrumb[]): PageBreadcrumb[] {
  return [ADMIN_BREADCRUMB, ...breadcrumbs];
}
