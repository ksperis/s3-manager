/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import type { BrowserRequestOptions } from "./browser";

export function buildBrowserWorkspaceHeaders(
  options?: BrowserRequestOptions,
): Record<string, string> {
  if (options?.workspaceSurface === "portal") {
    return { "X-S3-Workspace": "portal" };
  }
  if (options?.workspaceSurface === "manager") {
    return { "X-S3-Workspace": "manager-browser" };
  }
  return {};
}

export function mergeBrowserHeaders(
  ...headers: Array<Record<string, string> | undefined>
): Record<string, string> | undefined {
  const merged = Object.assign({}, ...headers.filter(Boolean));
  return Object.keys(merged).length > 0 ? merged : undefined;
}
