/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import type { ReactNode } from "react";
import type { PortalStorageSpaceVisibility } from "../../api/portal";
import PageBanner from "../../components/PageBanner";
import type { UiTone } from "../../components/ui/styles";
import type {
  PortalWorkspaceRole,
  PortalWorkspaceSpace,
  PortalWorkspaceTransfer,
} from "./portalWorkspaceModel";

export function PortalPageState({
  tone = "info",
  children,
}: {
  tone?: UiTone;
  children: ReactNode;
}) {
  return (
    <div className="space-y-4">
      <PageBanner tone={tone}>{children}</PageBanner>
    </div>
  );
}

export function resolvePortalWorkspacePageState({
  accountLoading,
  loading,
  accountError,
  error,
  hasAccountContext,
  loadingMessage,
  noAccountMessage,
}: {
  accountLoading: boolean;
  loading: boolean;
  accountError?: string | null;
  error?: string | null;
  hasAccountContext: boolean;
  loadingMessage: string;
  noAccountMessage: string;
}) {
  if (accountLoading || loading) {
    return <PortalPageState>{loadingMessage}</PortalPageState>;
  }
  if (accountError || error) {
    return <PortalPageState tone="error">{accountError ?? error}</PortalPageState>;
  }
  if (!hasAccountContext) {
    return <PortalPageState>{noAccountMessage}</PortalPageState>;
  }
  return null;
}

export function portalStorageSpaceStatusTone(space: PortalWorkspaceSpace): UiTone {
  if (space.status === "Archived") return "neutral";
  if (space.status === "Attention") return "warning";
  if (space.status === "Shared") return "primary";
  if (space.status === "Private") return "neutral";
  return "success";
}

export function portalRoleTone(role: PortalWorkspaceRole): UiTone {
  if (role === "Owner") return "success";
  if (role === "Editor") return "primary";
  return "neutral";
}

export function portalVisibilityTone(visibility: PortalStorageSpaceVisibility): UiTone {
  return visibility === "shared" ? "primary" : "neutral";
}

export function portalVisibilityLabel(visibility: PortalStorageSpaceVisibility): string {
  return visibility === "shared" ? "Shared" : "Private";
}

export type PortalTransferStatusTone = "neutral" | "primary" | "danger" | "success";

export function portalTransferStatusTone(status: PortalWorkspaceTransfer["status"]): PortalTransferStatusTone {
  if (status === "Failed") return "danger";
  if (status === "Completed") return "success";
  if (status === "Uploading" || status === "Queued") return "primary";
  return "neutral";
}
