/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import type { ReactNode } from "react";
import type { PortalStorageSpaceVisibility } from "../../api/portal";
import PageBanner, { type PageBannerTone } from "../../components/PageBanner";
import { translate, type I18nMessage } from "../../i18n";
import type { UiTone } from "../../components/ui/styles";
import type {
  PortalWorkspaceRole,
  PortalWorkspaceSpace,
  PortalWorkspaceTransfer,
} from "./portalWorkspaceModel";

type TFunction = (message: I18nMessage) => string;

export function PortalPageState({
  tone = "info",
  children,
}: {
  tone?: PageBannerTone;
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
  return "success";
}

export function portalRoleTone(role: PortalWorkspaceRole): UiTone {
  if (role === "Manager") return "primary";
  if (role === "Owner") return "success";
  if (role === "Editor") return "primary";
  return "neutral";
}

export function portalVisibilityTone(visibility: PortalStorageSpaceVisibility): UiTone {
  return visibility === "shared" ? "primary" : "neutral";
}

export function portalVisibilityLabel(visibility: PortalStorageSpaceVisibility, t: TFunction = translate): string {
  return visibility === "shared"
    ? t({ en: "Shared", fr: "Partagé", de: "Geteilt" })
    : t({ en: "Private", fr: "Privé", de: "Privat" });
}

export type PortalTransferStatusTone = "neutral" | "primary" | "danger" | "success";

export function portalTransferStatusTone(status: PortalWorkspaceTransfer["status"]): PortalTransferStatusTone {
  if (status === "Failed") return "danger";
  if (status === "Completed") return "success";
  if (status === "Uploading" || status === "Queued") return "primary";
  return "neutral";
}
