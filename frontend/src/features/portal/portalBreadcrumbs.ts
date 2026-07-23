/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import type { PageBreadcrumb } from "../../components/PageHeader";
import { buildWorkspaceBreadcrumbs } from "../../navigation/workspacePages";

export function portalBreadcrumbs(...breadcrumbs: PageBreadcrumb[]): PageBreadcrumb[] {
  return buildWorkspaceBreadcrumbs("portal", ...breadcrumbs);
}
