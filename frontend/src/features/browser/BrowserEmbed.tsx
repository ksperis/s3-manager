/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import type { S3AccountSelector } from "../../api/accountParams";
import type { BrowserWorkspaceSurface } from "../../api/browser";
import type { BrowserActionId } from "./browserActions";
import BrowserPage, { type BrowserObjectDetailsRouteTarget, type BrowserTransferReporter } from "./BrowserPage";

type BrowserEmbedProps = {
  accountIdForApi: S3AccountSelector;
  hasContext: boolean;
  workspaceSurface?: BrowserWorkspaceSurface;
  actionProfile?: "full" | "portal-basic";
  lockedBucketName?: string;
  portalProjectAccountId?: number | null;
  lockedBucketLabel?: string;
  storageEndpointCapabilities?: Record<string, boolean> | null;
  endpointProvider?: "ceph" | "aws" | "other" | null;
  quotaMaxSizeGb?: number | null;
  quotaMaxObjects?: number | null;
  hiddenActionIds?: readonly BrowserActionId[];
  onSelectedBucketNameChange?: (bucketName: string) => void;
  onOpenObjectDetailsRoute?: (target: BrowserObjectDetailsRouteTarget) => void;
  onCreatePublicLinkForObject?: (target: BrowserObjectDetailsRouteTarget) => void;
  transferReporter?: BrowserTransferReporter;
};

export default function BrowserEmbed({
  accountIdForApi,
  hasContext,
  workspaceSurface,
  actionProfile,
  lockedBucketName,
  portalProjectAccountId,
  lockedBucketLabel,
  storageEndpointCapabilities,
  endpointProvider,
  quotaMaxSizeGb,
  quotaMaxObjects,
  hiddenActionIds,
  onSelectedBucketNameChange,
  onOpenObjectDetailsRoute,
  onCreatePublicLinkForObject,
  transferReporter,
}: BrowserEmbedProps) {
  return (
    <BrowserPage
      accountIdForApi={accountIdForApi}
      hasContext={hasContext}
      workspaceSurface={workspaceSurface}
      actionProfile={actionProfile}
      lockedBucketName={lockedBucketName}
      portalProjectAccountId={portalProjectAccountId}
      lockedBucketLabel={lockedBucketLabel}
      storageEndpointCapabilities={storageEndpointCapabilities}
      contextEndpointProvider={endpointProvider}
      contextQuotaMaxSizeGb={quotaMaxSizeGb}
      contextQuotaMaxObjects={quotaMaxObjects}
      hiddenActionIds={hiddenActionIds}
      allowFoldersPanel={false}
      allowInspectorPanel={false}
      showPanelToggles={false}
      onSelectedBucketNameChange={onSelectedBucketNameChange}
      onOpenObjectDetailsRoute={onOpenObjectDetailsRoute}
      onCreatePublicLinkForObject={onCreatePublicLinkForObject}
      transferReporter={transferReporter}
    />
  );
}
