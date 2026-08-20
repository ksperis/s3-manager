/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import type { S3AccountSelector } from "../../api/accountParams";
import type { BrowserWorkspaceSurface } from "../../api/browser";
import type {
  BrowserCapabilityFacts,
  BrowserDensity,
  BrowserFunctionalProfile,
  BrowserLayoutMode,
} from "./browserActions";
import BrowserPage from "./BrowserPage";
import type {
  BrowserExecutionContextKind,
  BrowserDeletedObjectsOptions,
  BrowserObjectDetailsRouteTarget,
  BrowserTransferReporter,
} from "./browserPageContract";

type BrowserEmbedProps = {
  accountIdForApi: S3AccountSelector;
  executionContextKind: BrowserExecutionContextKind | null;
  hasContext: boolean;
  workspaceSurface: BrowserWorkspaceSurface;
  functionalProfile: BrowserFunctionalProfile;
  layoutMode: BrowserLayoutMode;
  density: BrowserDensity;
  capabilityFacts: BrowserCapabilityFacts;
  lockedBucketName?: string;
  lockedBucketLabel?: string;
  storageEndpointCapabilities?: Record<string, boolean> | null;
  endpointProvider?: "ceph" | "aws" | "other" | null;
  quotaMaxSizeGb?: number | null;
  quotaMaxObjects?: number | null;
  onSelectedBucketNameChange?: (bucketName: string) => void;
  onOpenObjectDetailsRoute?: (target: BrowserObjectDetailsRouteTarget) => void;
  onCreatePublicLinkForObject?: (target: BrowserObjectDetailsRouteTarget) => void;
  deletedObjectsOptions?: BrowserDeletedObjectsOptions;
  refreshToken?: number;
  transferReporter?: BrowserTransferReporter;
};

export default function BrowserEmbed({
  accountIdForApi,
  executionContextKind,
  hasContext,
  workspaceSurface,
  functionalProfile,
  layoutMode,
  density,
  capabilityFacts,
  lockedBucketName,
  lockedBucketLabel,
  storageEndpointCapabilities,
  endpointProvider,
  quotaMaxSizeGb,
  quotaMaxObjects,
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
      executionContextKind={executionContextKind}
      hasContext={hasContext}
      workspaceSurface={workspaceSurface}
      functionalProfile={functionalProfile}
      layoutMode={layoutMode}
      density={density}
      capabilityFacts={capabilityFacts}
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
      onOpenObjectDetailsRoute={onOpenObjectDetailsRoute}
      onCreatePublicLinkForObject={onCreatePublicLinkForObject}
      deletedObjectsOptions={deletedObjectsOptions}
      refreshToken={refreshToken}
      transferReporter={transferReporter}
    />
  );
}
