/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import type { S3AccountSelector } from "../../api/accountParams";
import type { BrowserWorkspaceSurface } from "../../api/browserWorkspace";
import type {
  BrowserCapabilityFacts,
  BrowserDensity,
  BrowserFunctionalProfile,
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
  density: BrowserDensity;
  capabilityFacts: BrowserCapabilityFacts;
  lockedBucketName?: string;
  lockedBucketLabel?: string;
  storageEndpointCapabilities?: Record<string, boolean> | null;
  onSelectedBucketNameChange?: (bucketName: string) => void;
  onOpenObjectDetails?: (target: BrowserObjectDetailsRouteTarget) => void;
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
  density,
  capabilityFacts,
  lockedBucketName,
  lockedBucketLabel,
  storageEndpointCapabilities,
  onSelectedBucketNameChange,
  onOpenObjectDetails,
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
      density={density}
      capabilityFacts={capabilityFacts}
      lockedBucketName={lockedBucketName}
      lockedBucketLabel={lockedBucketLabel}
      storageEndpointCapabilities={storageEndpointCapabilities}
      allowFoldersPanel={false}
      showPanelToggles={false}
      onSelectedBucketNameChange={onSelectedBucketNameChange}
      onOpenObjectDetails={onOpenObjectDetails}
      deletedObjectsOptions={deletedObjectsOptions}
      refreshToken={refreshToken}
      transferReporter={transferReporter}
    />
  );
}
