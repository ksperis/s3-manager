/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import type { S3AccountSelector } from "../../api/accountParams";
import type { BrowserWorkspaceSurface } from "../../api/browser";
import type { ExecutionContextKind } from "../../api/executionContexts";
import type {
  BrowserCapabilityFacts,
  BrowserDensity,
  BrowserFunctionalProfile,
  BrowserLayoutMode,
} from "./browserActions";

export type BrowserExecutionContextKind = ExecutionContextKind | "ceph_admin";

export type BrowserObjectDetailsRouteTarget = {
  bucketName: string;
  key: string;
  name: string;
  initialTab?: "preview" | "properties" | "versions";
  isDeleted?: boolean;
};

export type BrowserDeletedObjectTarget = BrowserObjectDetailsRouteTarget & {
  deletedAt?: string | null;
  deleteMarkerVersionId?: string | null;
};

export type BrowserDeletedObjectsOptions = {
  visible?: boolean;
  showToggle?: boolean;
  canRestore?: boolean;
  onVisibilityChange?: (visible: boolean) => void;
  onRestoreObject?: (target: BrowserDeletedObjectTarget) => void;
  onRestorePrefix?: (target: BrowserObjectDetailsRouteTarget) => void;
};

export type BrowserTransferReporter = {
  start: (transfer: {
    direction: "Upload" | "Download";
    bucketName: string;
    key: string;
    name: string;
    sizeBytes?: number | null;
  }) => string | null | undefined;
  complete: (id: string, name?: string) => void;
  fail: (id: string, message: string) => void;
};

export type BrowserPageProps = {
  accountIdForApi?: S3AccountSelector;
  executionContextKind?: BrowserExecutionContextKind | null;
  hasContext?: boolean;
  workspaceSurface?: BrowserWorkspaceSurface;
  functionalProfile?: BrowserFunctionalProfile;
  layoutMode?: BrowserLayoutMode;
  density?: BrowserDensity;
  capabilityFacts?: BrowserCapabilityFacts;
  lockedBucketName?: string;
  lockedBucketLabel?: string;
  storageEndpointCapabilities?: Record<string, boolean> | null;
  contextEndpointProvider?: "ceph" | "aws" | "other" | null;
  contextQuotaMaxSizeGb?: number | null;
  contextQuotaMaxObjects?: number | null;
  allowFoldersPanel?: boolean;
  allowInspectorPanel?: boolean;
  showPanelToggles?: boolean;
  defaultShowFolders?: boolean;
  defaultShowInspector?: boolean;
  onSelectedBucketNameChange?: (bucketName: string) => void;
  onOpenObjectDetailsRoute?: (target: BrowserObjectDetailsRouteTarget) => void;
  onCreatePublicLinkForObject?: (target: BrowserObjectDetailsRouteTarget) => void;
  deletedObjectsOptions?: BrowserDeletedObjectsOptions;
  refreshToken?: number;
  transferReporter?: BrowserTransferReporter;
};
