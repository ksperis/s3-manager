/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import type { S3AccountSelector } from "../../api/accountParams";
import type { BrowserWorkspaceSurface } from "../../api/browser";
import BrowserPage from "./BrowserPage";

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
  onSelectedBucketNameChange?: (bucketName: string) => void;
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
  onSelectedBucketNameChange,
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
      allowFoldersPanel={false}
      allowInspectorPanel={false}
      showPanelToggles={false}
      onSelectedBucketNameChange={onSelectedBucketNameChange}
    />
  );
}
