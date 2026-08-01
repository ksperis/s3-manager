/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import type { S3AccountSelector } from "../../api/accountParams";
import type { BrowserWorkspaceSurface } from "../../api/browser";
import type { BrowserActionId } from "./browserActions";
import BrowserPage, {
  type BrowserDeletedObjectsOptions,
  type BrowserObjectDetailsRouteTarget,
  type BrowserTransferReporter,
} from "./BrowserPage";

type BrowserEmbedProps = {
  accountIdForApi: S3AccountSelector;
  hasContext: boolean;
  workspaceSurface?: BrowserWorkspaceSurface;
  actionProfile?: "full" | "portal-basic";
  lockedBucketName?: string;
  lockedBucketLabel?: string;
  storageEndpointCapabilities?: Record<string, boolean> | null;
  endpointProvider?: "ceph" | "aws" | "other" | null;
  quotaMaxSizeGb?: number | null;
  quotaMaxObjects?: number | null;
  hiddenActionIds?: readonly BrowserActionId[];
  onSelectedBucketNameChange?: (bucketName: string) => void;
  onOpenObjectDetailsRoute?: (target: BrowserObjectDetailsRouteTarget) => void;
  onCreatePublicLinkForObject?: (target: BrowserObjectDetailsRouteTarget) => void;
  deletedObjectsOptions?: BrowserDeletedObjectsOptions;
  refreshToken?: number;
  transferReporter?: BrowserTransferReporter;
};

export default function BrowserEmbed({
  accountIdForApi,
  hasContext,
  workspaceSurface,
  actionProfile,
  lockedBucketName,
  lockedBucketLabel,
  storageEndpointCapabilities,
  endpointProvider,
  quotaMaxSizeGb,
  quotaMaxObjects,
  hiddenActionIds,
  onSelectedBucketNameChange,
  onOpenObjectDetailsRoute,
  onCreatePublicLinkForObject,
  deletedObjectsOptions,
  refreshToken,
  transferReporter,
}: BrowserEmbedProps) {
  return (
    <BrowserPage
      accountIdForApi={accountIdForApi}
      hasContext={hasContext}
      workspaceSurface={workspaceSurface}
      actionProfile={actionProfile}
      lockedBucketName={lockedBucketName}
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
      deletedObjectsOptions={deletedObjectsOptions}
      refreshToken={refreshToken}
      transferReporter={transferReporter}
    />
  );
}
