/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */

export type BrowserWorkspaceSurface =
  | "browser"
  | "manager"
  | "ceph-admin"
  | "portal";

export type BrowserRequestOptions = {
  workspaceSurface?: BrowserWorkspaceSurface;
};
