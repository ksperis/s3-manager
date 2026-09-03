/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import type { BrowserWorkspaceSurface } from "../../api/browserWorkspace";

export const resolveBrowserWorkspaceContext = ({
  pathname,
  workspaceSurface,
  lockedBucketName,
}: {
  pathname: string;
  workspaceSurface: BrowserWorkspaceSurface;
  lockedBucketName?: string | null;
}) => {
  const normalizedPath = pathname.replace(/\/+$/, "");
  const isPortalBrowserSurface = workspaceSurface === "portal";
  const isMainBrowserPath = normalizedPath === "/browser";
  const isEmbeddedBrowserPath =
    normalizedPath.endsWith("/manager/browser") ||
    normalizedPath.endsWith("/ceph-admin/browser") ||
    (isPortalBrowserSurface && !isMainBrowserPath);
  const usePortalWorkspaceLabels =
    isPortalBrowserSurface && !isMainBrowserPath;
  const workspaceNoun = usePortalWorkspaceLabels ? "storage space" : "bucket";
  const selectorWorkspaceNoun = isPortalBrowserSurface
    ? "storage space"
    : workspaceNoun;
  const resolvedLockedBucketName = lockedBucketName?.trim() ?? "";

  return {
    normalizedPath,
    isPortalBrowserSurface,
    isMainBrowserPath,
    isEmbeddedBrowserPath,
    usePortalWorkspaceLabels,
    workspaceNoun,
    workspaceNounCapitalized: usePortalWorkspaceLabels
      ? "Storage Space"
      : "Bucket",
    selectorWorkspaceNoun,
    selectorWorkspaceNounPlural: `${selectorWorkspaceNoun}s`,
    selectorWorkspaceNounTitle: isPortalBrowserSurface
      ? "Storage Spaces"
      : "Buckets",
    workspaceObjectNoun: usePortalWorkspaceLabels ? "file" : "object",
    workspaceObjectNounPlural: usePortalWorkspaceLabels ? "files" : "objects",
    resolvedLockedBucketName,
    showWorkspaceSidebar: isMainBrowserPath && !resolvedLockedBucketName,
  };
};
